import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { submitRender } from "@/lib/shotstack.server";
import { resolveVodAt } from "@/lib/kick-vod.server";
import {
  captureHlsToStorage,
  getKickLivePlaybackUrl,
} from "@/lib/hls-capture.server";

const APP_BASE =
  process.env.APP_BASE_URL ??
  "https://project--f25d50e3-8b88-4a00-abe1-abbf74e02448.lovable.app";

export async function startRenderForClip(clipId: string) {
  const { data: clip } = await supabaseAdmin
    .from("clips")
    .select("*, sources(slug), matched_velocity_id")
    .eq("id", clipId)
    .maybeSingle();
  if (!clip) throw new Error("Clip not found");
  if (clip.rendered_video_url) {
    return { ok: true, alreadyRendered: true };
  }

  // FAST PATH: clip already has a raw video uploaded from the browser
  // recorder. Skip the live/VOD probe entirely — just sign the storage URL
  // and submit straight to Shotstack.
  if ((clip as any).raw_storage_path) {
    const path = (clip as any).raw_storage_path as string;
    const duration = Math.min(60, Math.max(5, clip.duration_seconds ?? 30));

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("clips")
      .createSignedUrl(path, 60 * 60 * 6);
    if (signErr || !signed?.signedUrl) {
      await supabaseAdmin.from("render_jobs").insert({
        clip_id: clipId,
        status: "failed",
        error_message: `sign raw upload failed: ${signErr?.message ?? "unknown"}`,
      });
      return { ok: false, error: "sign failed" };
    }

    const { data: job, error: jobErr } = await supabaseAdmin
      .from("render_jobs")
      .insert({
        clip_id: clipId,
        status: "pending",
        provider: "shotstack",
        vod_url: signed.signedUrl,
        start_offset_sec: 0,
        duration_sec: duration,
      })
      .select()
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message ?? "job insert failed");

    const callback = `${APP_BASE}/api/public/hooks/shotstack?job=${job.id}&secret=${encodeURIComponent(process.env.SHOTSTACK_WEBHOOK_SECRET ?? "")}`;
    const sub = await submitRender({
      sourceUrl: signed.signedUrl,
      trimStart: 0,
      duration,
      caption: clip.hook_caption ?? clip.title ?? "",
      callbackUrl: callback,
    });
    if (!sub.ok || !sub.renderId) {
      await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "failed",
          error_message: sub.error ?? "Shotstack submit failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return { ok: false, error: sub.error };
    }
    await supabaseAdmin
      .from("render_jobs")
      .update({ status: "rendering", provider_render_id: sub.renderId })
      .eq("id", job.id);
    return { ok: true, jobId: job.id, renderId: sub.renderId, mode: "browser" };
  }

  let targetIso = clip.stream_timestamp as string | null;
  if (clip.matched_velocity_id) {
    const { data: vel } = await supabaseAdmin
      .from("chat_velocity")
      .select("created_at")
      .eq("id", clip.matched_velocity_id)
      .maybeSingle();
    if (vel?.created_at) targetIso = vel.created_at;
  }

  const slug = (clip as any).sources?.slug;
  const sourceId = (clip as any).source_id as string | null;
  if (!slug) {
    await supabaseAdmin.from("render_jobs").insert({
      clip_id: clipId,
      status: "failed",
      error_message: "Missing source slug",
    });
    return { ok: false, error: "Missing slug" };
  }

  // Pull the source's last_known_live so we trust the poller over a single
  // (often Cloudflare-blocked) HTTP probe from this Worker.
  let lastKnownLive = false;
  let lastPolledAt: string | null = null;
  if (sourceId) {
    const { data: src } = await supabaseAdmin
      .from("sources")
      .select("last_known_live, last_polled_at")
      .eq("id", sourceId)
      .maybeSingle();
    lastKnownLive = !!src?.last_known_live;
    lastPolledAt = src?.last_polled_at ?? null;
  }
  const polledAgeMin = lastPolledAt
    ? (Date.now() - +new Date(lastPolledAt)) / 60_000
    : Infinity;
  const treatAsLive = lastKnownLive && polledAgeMin < 10;

  // 1) If channel is live RIGHT NOW, capture from the live edge — Kick's
  //    archive playlist for an in-progress session can be hours stale and
  //    `resolveVodAt()` happily returns a 40+ hour offset into it.
  // 2) Only fall back to VOD lookup when the channel is genuinely offline.
  let playlistUrl: string | null = null;
  let startOffsetSec: number | null = null;
  let mode: "vod" | "live" = treatAsLive ? "live" : "vod";

  if (treatAsLive) {
    // Retry the live probe a few times — Kick/Cloudflare often 403's the
    // first call from a Worker IP, then succeeds on retry.
    let live: string | null = null;
    for (let attempt = 0; attempt < 3 && !live; attempt++) {
      live = await getKickLivePlaybackUrl(slug);
      if (!live) await new Promise((r) => setTimeout(r, 400));
    }
    if (live) {
      playlistUrl = live;
      mode = "live";
      startOffsetSec = null; // live edge
    } else {
      // DO NOT fall through to VOD here — last_known_live=true means the
      // archive is still in-progress and `resolveVodAt()` will return a 40h+
      // bogus offset that maps to the start of the VOD on every grab.
      await supabaseAdmin.from("render_jobs").insert({
        clip_id: clipId,
        status: "failed",
        error_message:
          "Channel is live but Kick playback URL was unreachable after 3 attempts (likely Cloudflare block from Worker IP)",
      });
      return { ok: false, error: "live probe failed" };
    }
  } else if (targetIso) {
    const vod = await resolveVodAt(slug, targetIso);
    if (vod) {
      // Validate the VOD actually covers this moment — the in-progress VOD
      // can report a duration far past what's actually archived.
      playlistUrl = vod.vodUrl;
      mode = "vod";
      startOffsetSec = Math.max(0, vod.startOffsetSec - 5);
    }
  }

  if (!playlistUrl) {
    await supabaseAdmin.from("render_jobs").insert({
      clip_id: clipId,
      status: "failed",
      error_message:
        "No VOD or live playback URL available — channel may be offline and not yet archived",
    });
    return { ok: false, error: "No playback URL" };
  }

  const duration = Math.min(45, Math.max(15, clip.duration_seconds ?? 30));

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("render_jobs")
    .insert({
      clip_id: clipId,
      status: "pending",
      provider: "shotstack",
      vod_url: playlistUrl,
      start_offset_sec: startOffsetSec ?? 0,
      duration_sec: duration,
    })
    .select()
    .single();
  if (jobErr || !job) throw new Error(jobErr?.message ?? "job insert failed");

  // Capture the HLS slice to our own Storage so Shotstack can fetch it
  // (Kick blocks Shotstack's render workers directly).
  const cap = await captureHlsToStorage({
    playlistUrl,
    durationSec: duration,
    startOffsetSec,
    storagePath: `raw/${clipId}.mp4`,
  });
  if (!cap.ok || !cap.signedUrl) {
    await supabaseAdmin
      .from("render_jobs")
      .update({
        status: "failed",
        error_message: `HLS capture (${mode}) failed: ${cap.error ?? "unknown"}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { ok: false, error: cap.error };
  }

  console.log(
    `[render-runner] captured ${cap.segments} segs (${cap.bytes} bytes) for clip ${clipId} via ${mode}`,
  );

  const callback = `${APP_BASE}/api/public/hooks/shotstack?job=${job.id}&secret=${encodeURIComponent(process.env.SHOTSTACK_WEBHOOK_SECRET ?? "")}`;

  const sub = await submitRender({
    sourceUrl: cap.signedUrl,
    trimStart: 0, // already trimmed during capture
    duration,
    caption: clip.hook_caption ?? clip.title ?? "",
    callbackUrl: callback,
  });

  if (!sub.ok || !sub.renderId) {
    await supabaseAdmin
      .from("render_jobs")
      .update({
        status: "failed",
        error_message: sub.error ?? "Shotstack submit failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { ok: false, error: sub.error };
  }

  await supabaseAdmin
    .from("render_jobs")
    .update({ status: "rendering", provider_render_id: sub.renderId })
    .eq("id", job.id);

  return { ok: true, jobId: job.id, renderId: sub.renderId, mode };
}
