// Capture a slice of an HLS stream (live or VOD), concat the .ts segments,
// upload to Supabase Storage, and return a long-lived signed URL that
// Shotstack can fetch directly.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://kick.com/" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://kick.com/" },
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function resolveUrl(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  return new URL(ref, base).toString();
}

type Variant = { url: string; bandwidth: number };

function parseMaster(playlist: string, baseUrl: string): Variant[] {
  const lines = playlist.split(/\r?\n/);
  const variants: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      const bwMatch = line.match(/BANDWIDTH=(\d+)/);
      const bandwidth = bwMatch ? Number(bwMatch[1]) : 0;
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("#")) {
        variants.push({ url: resolveUrl(baseUrl, next), bandwidth });
      }
    }
  }
  return variants;
}

type Segment = { url: string; duration: number };

function parseMedia(
  playlist: string,
  baseUrl: string,
): { segments: Segment[] } {
  const lines = playlist.split(/\r?\n/);
  const segments: Segment[] = [];
  let pendingDuration = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const m = line.match(/#EXTINF:([\d.]+)/);
      pendingDuration = m ? Number(m[1]) : 0;
    } else if (line && !line.startsWith("#")) {
      segments.push({
        url: resolveUrl(baseUrl, line),
        duration: pendingDuration,
      });
      pendingDuration = 0;
    }
  }
  return { segments };
}

export type HlsCaptureResult = {
  ok: boolean;
  signedUrl?: string;
  storagePath?: string;
  bytes?: number;
  segments?: number;
  error?: string;
};

/**
 * Capture `durationSec` of an HLS stream and stash it in Supabase Storage.
 * - If `startOffsetSec` is provided, treats the playlist as a VOD and seeks
 *   that many seconds in.
 * - Otherwise grabs the live edge (last N seconds available).
 */
export async function captureHlsToStorage(opts: {
  playlistUrl: string;
  durationSec: number;
  startOffsetSec?: number | null;
  storagePath: string; // e.g. "raw/{clipId}.mp4"
}): Promise<HlsCaptureResult> {
  const playlist = await fetchText(opts.playlistUrl);
  if (!playlist) {
    return { ok: false, error: `master playlist fetch failed` };
  }

  // Resolve master → media playlist
  let mediaUrl = opts.playlistUrl;
  let mediaText = playlist;
  if (playlist.includes("#EXT-X-STREAM-INF")) {
    const variants = parseMaster(playlist, opts.playlistUrl);
    if (!variants.length) return { ok: false, error: "no variants in master" };
    // pick the highest bandwidth ≤ 5 Mbps to keep capture fast
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    const pick =
      variants.find((v) => v.bandwidth > 0 && v.bandwidth <= 5_000_000) ??
      variants[variants.length - 1];
    mediaUrl = pick.url;
    const m = await fetchText(mediaUrl);
    if (!m) return { ok: false, error: "media playlist fetch failed" };
    mediaText = m;
  }

  const { segments } = parseMedia(mediaText, mediaUrl);
  if (!segments.length) return { ok: false, error: "no segments" };

  // Pick the slice
  let startIdx = 0;
  if (opts.startOffsetSec && opts.startOffsetSec > 0) {
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      if (acc + segments[i].duration >= opts.startOffsetSec) {
        startIdx = i;
        break;
      }
      acc += segments[i].duration;
    }
  } else {
    // Live edge: walk back from the end until we cover durationSec
    let acc = 0;
    startIdx = segments.length - 1;
    while (startIdx > 0 && acc < opts.durationSec) {
      acc += segments[startIdx].duration;
      startIdx--;
    }
  }

  const picked: Segment[] = [];
  let total = 0;
  for (let i = startIdx; i < segments.length && total < opts.durationSec; i++) {
    picked.push(segments[i]);
    total += segments[i].duration;
  }
  if (!picked.length) return { ok: false, error: "no segments picked" };

  // Download in parallel (cap concurrency to be polite)
  const chunks: Uint8Array[] = new Array(picked.length);
  const CONC = 4;
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= picked.length) return;
      const buf = await fetchBytes(picked[i].url);
      if (!buf) throw new Error(`segment fetch failed: ${picked[i].url}`);
      chunks[i] = buf;
    }
  }
  try {
    await Promise.all(Array.from({ length: CONC }, worker));
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }

  const totalBytes = chunks.reduce((n, c) => n + c.byteLength, 0);
  const concat = new Uint8Array(totalBytes);
  let off = 0;
  for (const c of chunks) {
    concat.set(c, off);
    off += c.byteLength;
  }

  // Upload to Storage
  const { error: upErr } = await supabaseAdmin.storage
    .from("clips")
    .upload(opts.storagePath, concat, {
      // Shotstack rejects .ts URLs at validation time, but it can ingest this
      // transport-stream payload when it is handed over as a transcodable video.
      contentType: opts.storagePath.endsWith(".mp4")
        ? "video/mp4"
        : "video/mp2t",
      upsert: true,
    });
  if (upErr) {
    return { ok: false, error: `upload: ${upErr.message}` };
  }

  // Long-lived signed URL Shotstack can fetch
  const { data: signed, error: sErr } = await supabaseAdmin.storage
    .from("clips")
    .createSignedUrl(opts.storagePath, 60 * 60 * 24); // 24h
  if (sErr || !signed?.signedUrl) {
    return { ok: false, error: `sign: ${sErr?.message ?? "no url"}` };
  }

  return {
    ok: true,
    signedUrl: signed.signedUrl,
    storagePath: opts.storagePath,
    bytes: totalBytes,
    segments: picked.length,
  };
}

/**
 * Fetch a Kick channel's live playback URL (master m3u8) if currently live.
 * Kick sits behind Cloudflare; a single naive fetch often returns a 403
 * "Request blocked by security policy". We try a few endpoint/header combos
 * before giving up.
 */
export async function getKickLivePlaybackUrl(
  slug: string,
): Promise<string | null> {
  const headers = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: `https://kick.com/${slug}`,
    Origin: "https://kick.com",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Cache-Control": "no-cache",
  };

  const endpoints = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/livestream`,
  ];

  for (const url of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          console.warn(
            `[kick-live] ${url} attempt ${attempt + 1} → ${res.status}`,
          );
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        const data: any = await res.json();
        const playback =
          data?.playback_url ??
          data?.livestream?.playback_url ??
          data?.data?.playback_url ??
          data?.data?.livestream?.playback_url ??
          null;
        if (playback && /\.m3u8/i.test(playback)) {
          return playback;
        }
        // If the channel is offline, the response is well-formed but has no
        // playback URL — short-circuit and don't retry.
        if (data && (data.id || data.slug || data.user_id)) {
          return null;
        }
      } catch (err) {
        console.warn(`[kick-live] ${url} threw`, err);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return null;
}
