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
  if (!slug) {
    await supabaseAdmin.from("render_jobs").insert({
      clip_id: clipId,
      status: "failed",
      error_message: "Missing source slug",
    });
    return { ok: false, error: "Missing slug" };
  }

  // 1) Try VOD lookup. 2) If no VOD yet, fall back to live playback URL
  //    (captures the live edge — useful for active streams).
  let playlistUrl: string | null = null;
  let startOffsetSec: number | null = null;
  let mode: "vod" | "live" = "vod";

  if (targetIso) {
    const vod = await resolveVodAt(slug, targetIso);
    if (vod) {
      playlistUrl = vod.vodUrl;
      // Pull a 5s lead-in so the moment isn't right at the cut
      startOffsetSec = Math.max(0, vod.startOffsetSec - 5);
    }
  }

  if (!playlistUrl) {
    const live = await getKickLivePlaybackUrl(slug);
    if (live) {
      playlistUrl = live;
      mode = "live";
      startOffsetSec = null; // live edge
    }
  }

  if (!playlistUrl) {
    await supabaseAdmin.from("render_jobs").insert({
      clip_id: clipId,
      status: "failed",
      error_message:
        "No VOD or live playback URL available — channel may be offline",
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
