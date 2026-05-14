import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-obs-secret",
};

const POLL_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 1500;

async function handle(request: Request) {
  const expected = process.env.OBS_UPLOAD_SECRET;
  if (!expected) {
    return new Response("OBS_UPLOAD_SECRET not configured", { status: 500, headers: CORS });
  }
  const secret = request.headers.get("x-obs-secret");
  if (!secret || secret !== expected) {
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }

  const url = new URL(request.url);
  const slug = (url.searchParams.get("sourceSlug") ?? "").trim().toLowerCase();
  if (!slug) {
    return new Response("Missing sourceSlug", { status: 400, headers: CORS });
  }

  // Heartbeat: register/refresh client.
  await supabaseAdmin
    .from("obs_clients")
    .upsert(
      { source_slug: slug, last_polled_at: new Date().toISOString() },
      { onConflict: "source_slug" },
    );

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data: rows } = await supabaseAdmin
      .from("obs_trigger_queue")
      .select("id, action, payload, created_at")
      .eq("source_slug", slug)
      .is("claimed_at", null)
      .order("created_at", { ascending: true })
      .limit(1);

    const row = rows?.[0];
    if (row) {
      // Claim it (best-effort; race-safe enough for single-watcher setups).
      const { data: claimed } = await supabaseAdmin
        .from("obs_trigger_queue")
        .update({ claimed_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("claimed_at", null)
        .select("id")
        .maybeSingle();
      if (claimed) {
        return new Response(
          JSON.stringify({ ok: true, command: { id: row.id, action: row.action, payload: row.payload } }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return new Response(JSON.stringify({ ok: true, command: null }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/obs-trigger-poll")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    },
  },
});
