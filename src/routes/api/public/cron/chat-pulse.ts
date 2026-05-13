import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { runChatPulse } from "@/lib/chat-pulse.server";

export const Route = createFileRoute("/api/public/cron/chat-pulse")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await runChatPulse();
          return Response.json({ ok: true, ...result });
        } catch (err: any) {
          console.error("[chat-pulse] error", err);
          return Response.json(
            { ok: false, error: err?.message ?? String(err) },
            { status: 500 },
          );
        }
      },
      GET: async () => {
        try {
          const result = await runChatPulse();
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
