import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { submitRender } from "@/lib/shotstack.server";
import { resolveVodAt } from "@/lib/kick-vod.server";
import { captureHlsToStorage } from "@/lib/hls-capture.server";

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

  // Pull the source's last_known_live + cached browser-resolved HLS URL.
  // Option A: we trust the dashboard browser tab to keep live_playback_url
  // fresh, and the server NEVER calls Kick's blocked API directly.
  let lastKnownLive = false;
  let lastPolledAt: string | null = null;
  let cachedPlayback: string | null = null;
  let cachedPlaybackAgeMin = Infinity;
  if (sourceId) {
    const { data: src } = await supabaseAdmin
      .from("sources")
      .select("last_known_live, last_polled_at, live_playback_url, live_playback_url_updated_at")
      .eq("id", sourceId)
      .maybeSingle();
    lastKnownLive = !!src?.last_known_live;
    lastPolledAt = src?.last_polled_at ?? null;
    cachedPlayback = src?.live_playback_url ?? null;
    cachedPlaybackAgeMin = src?.live_playback_url_updated_at
      ? (Date.now() - +new Date(src.live_playback_url_updated_at)) / 60_000
      : Infinity;
  }
  const polledAgeMin = lastPolledAt
    ? (Date.now() - +new Date(lastPolledAt)) / 60_000
    : Infinity;
  const treatAsLive = lastKnownLive && polledAgeMin < 10;

  let playlistUrl: string | null = null;
  let startOffsetSec: number | null = null;
  let mode: "vod" | "live" = treatAsLive ? "live" : "vod";

  if (treatAsLive) {
    // Use the browser-cached HLS URL only — no direct Kick probe.
    if (cachedPlayback && cachedPlaybackAgeMin < 30) {
      playlistUrl = cachedPlayback;
      mode = "live";
      startOffsetSec = null;
    } else {
      await supabaseAdmin.from("render_jobs").insert({
        clip_id: clipId,
        status: "failed",
        error_message:
          "No fresh live playback URL — open the dashboard Live Watch tab so the browser can record this stream, then try again.",
      });
      return { ok: false, error: "no cached live URL — open Live Watch tab" };
    }
  } else if (targetIso) {
    const vod = await resolveVodAt(slug, targetIso);
    if (vod) {
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
