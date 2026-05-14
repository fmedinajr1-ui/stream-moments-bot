import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyUploadToken } from "@/lib/browser-capture.functions";
import { startRenderForClip } from "@/lib/render-runner.server";

async function handle(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Expected multipart/form-data", { status: 400 });
  }

  const token = String(form.get("token") ?? "");
  const sourceId = String(form.get("sourceId") ?? "");
  const caption = (form.get("caption") as string | null) ?? "";
  const durationSec = Math.max(
    5,
    Math.min(60, Number(form.get("durationSec") ?? 30)),
  );
  const autoGrabbed = form.get("autoGrabbed") === "true";
  const chatSpikeRatio = form.get("chatSpikeRatio")
    ? Number(form.get("chatSpikeRatio"))
    : null;
  const captureMethod =
    (form.get("captureMethod") as string | null) ?? "browser_record";

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return new Response("Missing file", { status: 400 });
  }

  const verifiedSourceId = await verifyUploadToken(token);
  if (!verifiedSourceId || verifiedSourceId !== sourceId) {
    return new Response("Invalid or expired token", { status: 401 });
  }

  const { data: src, error: srcErr } = await supabaseAdmin
    .from("sources")
    .select("id, slug, display_name")
    .eq("id", sourceId)
    .maybeSingle();
  if (srcErr || !src) {
    return new Response("Source not found", { status: 404 });
  }

  // Insert clip row first so we have an ID for the storage path.
  const { data: clip, error: clipErr } = await supabaseAdmin
    .from("clips")
    .insert({
      source_id: src.id,
      title: caption.trim() || `${src.display_name ?? src.slug} live grab`,
      hook_caption:
        caption.trim() ||
        `${(src.display_name ?? src.slug).toUpperCase()} LIVE GRAB`,
      duration_seconds: durationSec,
      status: "processing",
      auto_grabbed: autoGrabbed,
      chat_spike_ratio: chatSpikeRatio,
      capture_method: captureMethod,
      stream_timestamp: new Date().toISOString(),
    })
    .select()
    .single();
  if (clipErr || !clip) {
    return new Response(`Clip insert failed: ${clipErr?.message}`, {
      status: 500,
    });
  }

  // Upload the WebM blob to Storage.
  const ext = file.type.includes("mp4") ? "mp4" : "webm";
  const storagePath = `raw/${clip.id}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await supabaseAdmin.storage
    .from("clips")
    .upload(storagePath, bytes, {
      contentType: file.type || "video/webm",
      upsert: true,
    });
  if (up.error) {
    await supabaseAdmin
      .from("clips")
      .update({ status: "failed" })
      .eq("id", clip.id);
    return new Response(`Storage upload failed: ${up.error.message}`, {
      status: 500,
    });
  }

  await supabaseAdmin
    .from("clips")
    .update({ raw_storage_path: storagePath })
    .eq("id", clip.id);

  await supabaseAdmin.from("audit_log").insert({
    action: "browser_clip_uploaded",
    clip_id: clip.id,
    details: {
      source_id: src.id,
      slug: src.slug,
      bytes: bytes.byteLength,
      auto_grabbed: autoGrabbed,
      capture_method: captureMethod,
    },
  });

  // Fire the Shotstack render in the background; don't make the browser wait.
  startRenderForClip(clip.id).catch((err) => {
    console.error("[upload-clip] render queue failed", err);
  });

  return Response.json({
    ok: true,
    clipId: clip.id,
    bytes: bytes.byteLength,
    storagePath,
  });
}

export const Route = createFileRoute("/api/public/upload-clip")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
    },
  },
});
