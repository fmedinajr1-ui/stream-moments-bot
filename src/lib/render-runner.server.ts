import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { submitRender } from "@/lib/shotstack.server";
import { resolveVodAt } from "@/lib/kick-vod.server";

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
  if (!slug || !targetIso) {
    await supabaseAdmin.from("render_jobs").insert({
      clip_id: clipId,
      status: "failed",
      error_message: "Missing source slug or timestamp for VOD lookup",
    });
    return { ok: false, error: "Missing slug/timestamp" };
  }

  const vod = await resolveVodAt(slug, targetIso);
  if (!vod) {
    await supabaseAdmin.from("render_jobs").insert({
      clip_id: clipId,
      status: "failed",
      error_message:
        "VOD not yet available — try again in ~10 min after stream ends",
    });
    return { ok: false, error: "VOD not available" };
  }

  const duration = 45;
  const start = Math.max(0, vod.startOffsetSec - 25);

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("render_jobs")
    .insert({
      clip_id: clipId,
      status: "pending",
      provider: "shotstack",
      vod_url: vod.vodUrl,
      start_offset_sec: start,
      duration_sec: duration,
    })
    .select()
    .single();
  if (jobErr || !job) throw new Error(jobErr?.message ?? "job insert failed");

  const callback = `${APP_BASE}/api/public/hooks/shotstack?job=${job.id}&secret=${encodeURIComponent(process.env.SHOTSTACK_WEBHOOK_SECRET ?? "")}`;

  const sub = await submitRender({
    sourceUrl: vod.vodUrl,
    trimStart: start,
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

  return { ok: true, jobId: job.id, renderId: sub.renderId };
}
