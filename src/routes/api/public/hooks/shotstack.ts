import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function handle(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job");
  const secret = url.searchParams.get("secret");
  if (!jobId) return new Response("Missing job", { status: 400 });
  if (!secret || secret !== process.env.SHOTSTACK_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any = {};
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const status: string = payload?.status ?? payload?.response?.status ?? "";
  const outputUrl: string | null =
    payload?.url ?? payload?.response?.url ?? null;
  const errorMsg: string | null =
    payload?.error ?? payload?.response?.error ?? null;

  const { data: job } = await supabaseAdmin
    .from("render_jobs")
    .select("id, clip_id, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return new Response("Job not found", { status: 404 });

  if (status === "done" && outputUrl) {
    // Download the rendered MP4 and copy into our private bucket.
    let storedUrl: string | null = null;
    try {
      const dl = await fetch(outputUrl);
      if (!dl.ok) throw new Error(`download ${dl.status}`);
      const buf = new Uint8Array(await dl.arrayBuffer());
      const path = `${job.clip_id}.mp4`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("clips")
        .upload(path, buf, {
          contentType: "video/mp4",
          upsert: true,
        });
      if (upErr) throw upErr;
      const { data: signed } = await supabaseAdmin.storage
        .from("clips")
        .createSignedUrl(path, 60 * 60 * 24 * 30); // 30 days
      storedUrl = signed?.signedUrl ?? null;
    } catch (err: any) {
      console.error("[shotstack hook] storage upload failed", err);
      await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "failed",
          error_message: `Upload failed: ${err?.message ?? err}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return new Response("Upload failed", { status: 500 });
    }

    await supabaseAdmin
      .from("render_jobs")
      .update({
        status: "done",
        output_url: storedUrl,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await supabaseAdmin
      .from("clips")
      .update({ rendered_video_url: storedUrl })
      .eq("id", job.clip_id);
    return Response.json({ ok: true });
  }

  if (status === "failed") {
    await supabaseAdmin
      .from("render_jobs")
      .update({
        status: "failed",
        error_message: errorMsg ?? "Shotstack render failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return Response.json({ ok: true });
  }

  // Intermediate states: queued, fetching, rendering, saving — keep as 'rendering'.
  await supabaseAdmin
    .from("render_jobs")
    .update({ status: "rendering" })
    .eq("id", jobId);
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/public/hooks/shotstack")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
