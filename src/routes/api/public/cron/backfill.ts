import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { runBackfill } from "@/lib/backfill.server";

export const Route = createFileRoute("/api/public/cron/backfill")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await runBackfill();
          return Response.json({ ok: true, ...result });
        } catch (err: any) {
          console.error("[backfill] error", err);
          return Response.json(
            { ok: false, error: err?.message ?? String(err) },
            { status: 500 },
          );
        }
      },
      GET: async () => {
        try {
          const result = await runBackfill();
          return Response.json({ ok: true, ...result });
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
