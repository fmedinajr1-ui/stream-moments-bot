import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { pollSources } from "@/lib/poll-kick.server";

export const Route = createFileRoute("/api/public/cron/poll-kick")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await pollSources();
          return Response.json({ ok: true, ...result });
        } catch (err: any) {
          console.error("[poll-kick] error", err);
          return Response.json(
            { ok: false, error: err?.message ?? String(err) },
            { status: 500 },
          );
        }
      },
      GET: async () => {
        try {
          const result = await pollSources();
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
