import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { startRenderForClip } from "@/lib/render-runner.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-obs-secret",
};

async function handle(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  const expected = process.env.OBS_UPLOAD_SECRET;
  if (!expected) {
    return new Response("OBS_UPLOAD_SECRET not configured", { status: 500, headers: CORS });
  }
  const secret = request.headers.get("x-obs-secret");
  if (!secret || secret !== expected) {
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Expected multipart/form-data", { status: 400, headers: CORS });
  }

  const sourceSlug = String(form.get("sourceSlug") ?? "").trim().toLowerCase();
  const caption = (form.get("caption") as string | null) ?? "";
  const autoGrabbed = form.get("autoGrabbed") === "true";
  const reason = (form.get("reason") as string | null) ?? "manual";
  const file = form.get("file");
  if (!sourceSlug) return new Response("Missing sourceSlug", { status: 400, headers: CORS });
  if (!(file instanceof Blob)) return new Response("Missing file", { status: 400, headers: CORS });

  const { data: src } = await supabaseAdmin
    .from("sources")
    .select("id, slug, display_name")
    .eq("slug", sourceSlug)
    .maybeSingle();
  if (!src) return new Response("Source not found", { status: 404, headers: CORS });

  const filename = (file as File).name ?? "clip.mkv";
  const lower = filename.toLowerCase();
  const ext = lower.endsWith(".mp4")
    ? "mp4"
    : lower.endsWith(".webm")
      ? "webm"
      : lower.endsWith(".mov")
        ? "mov"
        : "mkv";

  const { data: clip, error: clipErr } = await supabaseAdmin
    .from("clips")
    .insert({
      source_id: src.id,
      title: caption.trim() || `${src.display_name ?? src.slug} OBS clip`,
      hook_caption:
        caption.trim() ||
        `${(src.display_name ?? src.slug).toUpperCase()} REPLAY`,
      status: "processing",
      auto_grabbed: autoGrabbed,
      capture_method: "obs_replay",
      stream_timestamp: new Date().toISOString(),
    })
    .select()
    .single();
  if (clipErr || !clip) {
    return new Response(`Clip insert failed: ${clipErr?.message}`, {
      status: 500,
      headers: CORS,
    });
  }

  const storagePath = `raw/${clip.id}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType =
    ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : "video/x-matroska";

  const up = await supabaseAdmin.storage
    .from("clips")
    .upload(storagePath, bytes, { contentType, upsert: true });
  if (up.error) {
    await supabaseAdmin.from("clips").update({ status: "failed" }).eq("id", clip.id);
    return new Response(`Storage upload failed: ${up.error.message}`, {
      status: 500,
      headers: CORS,
    });
  }

  await supabaseAdmin
    .from("clips")
    .update({ raw_storage_path: storagePath })
    .eq("id", clip.id);

  await supabaseAdmin.from("audit_log").insert({
    action: "obs_clip_uploaded",
    clip_id: clip.id,
    details: {
      source_id: src.id,
      slug: src.slug,
      bytes: bytes.byteLength,
      reason,
      ext,
    },
  });

  // Mark client as having saved.
  await supabaseAdmin
    .from("obs_clients")
    .upsert(
      { source_slug: sourceSlug, last_save_at: new Date().toISOString() },
      { onConflict: "source_slug" },
    );

  startRenderForClip(clip.id).catch((err) => {
    console.error("[obs-upload] render queue failed", err);
  });

  return new Response(
    JSON.stringify({ ok: true, clipId: clip.id, bytes: bytes.byteLength, storagePath }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  );
}

export const Route = createFileRoute("/api/public/obs-upload")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    },
  },
});
