import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { resolvePendingMoments } from "@/lib/marked-moments.server";

export const Route = createFileRoute("/api/public/cron/resolve-moments")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await resolvePendingMoments();
          return Response.json({ ok: true, ...result });
        } catch (err: any) {
          console.error("[resolve-moments] error", err);
          return Response.json(
            { ok: false, error: err?.message ?? String(err) },
            { status: 500 },
          );
        }
      },
      GET: async () => {
        try {
          const result = await resolvePendingMoments();
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
