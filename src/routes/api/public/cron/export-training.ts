import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function runExport() {
  const { data: clips, error } = await supabaseAdmin
    .from("clips")
    .select(
      "id, title, hook_caption, virality_score, score_breakdown, chat_spike_ratio, kick_view_count, duration_seconds, status, created_at, source_id, sources(slug)",
    )
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;

  const header = [
    "clip_id",
    "created_at",
    "source_slug",
    "title",
    "hook_caption",
    "duration_seconds",
    "kick_view_count",
    "chat_spike_ratio",
    "score_predicted",
    "score_reaction",
    "score_chat",
    "score_audio",
    "label",
  ];
  const rows = (clips ?? []).map((c: any) => [
    c.id,
    c.created_at,
    c.sources?.slug ?? "",
    c.title,
    c.hook_caption,
    c.duration_seconds,
    c.kick_view_count,
    c.chat_spike_ratio,
    c.virality_score,
    c.score_breakdown?.reaction,
    c.score_breakdown?.chat,
    c.score_breakdown?.audio,
    c.status === "approved" ? 1 : c.status === "rejected" ? 0 : "",
  ]);
  const csv =
    header.join(",") +
    "\n" +
    rows.map((r) => r.map(csvEscape).join(",")).join("\n");

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `exports/training-${ts}.csv`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("training-data")
    .upload(path, new Blob([csv], { type: "text/csv" }), { upsert: false });
  if (upErr) throw upErr;

  await supabaseAdmin
    .from("audit_log")
    .insert({ action: "training_export", details: { path, rows: rows.length } as any });

  return { path, rows: rows.length };
}

export const Route = createFileRoute("/api/public/cron/export-training")({
  server: {
    handlers: {
      POST: async () => {
        try {
          return Response.json({ ok: true, ...(await runExport()) });
        } catch (err: any) {
          console.error("[export-training] error", err);
          return Response.json(
            { ok: false, error: err?.message ?? String(err) },
            { status: 500 },
          );
        }
      },
      GET: async () => {
        try {
          return Response.json({ ok: true, ...(await runExport()) });
        } catch (err: any) {
          return Response.json(
            { ok: false, error: err?.message ?? String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
