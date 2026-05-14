// Kick chat via Pusher WebSocket (public, no auth).
// Cloudflare Workers support the standard WebSocket client API.

import type { KickChatMessage } from "@/lib/kick.server";

const PUSHER_URL =
  "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=7.6.0&flash=false";

export type ChatSample = {
  messages: KickChatMessage[];
  durationMs: number;
  connected: boolean;
  error?: string;
};

/**
 * Open a Pusher WebSocket to Kick's chatroom and collect messages for
 * `durationMs` milliseconds. Resolves with what was collected.
 */
export function sampleKickChat(
  chatroomId: number | string,
  durationMs = 10_000,
): Promise<ChatSample> {
  return new Promise((resolve) => {
    const start = Date.now();
    const messages: KickChatMessage[] = [];
    let connected = false;
    let settled = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      resolve({
        messages,
        durationMs: Date.now() - start,
        connected,
        error,
      });
    };

    try {
      ws = new WebSocket(PUSHER_URL);
    } catch (err: any) {
      return finish(`ws ctor failed: ${err?.message ?? String(err)}`);
    }

    ws.addEventListener("open", () => {
      // Subscribe is fine to send before connection_established on Pusher;
      // it'll be queued. But wait for it to be safe.
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let frame: any;
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      const event: string = frame?.event ?? "";

      if (event === "pusher:connection_established") {
        connected = true;
        try {
          ws?.send(
            JSON.stringify({
              event: "pusher:subscribe",
              data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
            }),
          );
        } catch (err: any) {
          finish(`subscribe failed: ${err?.message ?? String(err)}`);
        }
        return;
      }

      if (event === "pusher:ping") {
        try {
          ws?.send(JSON.stringify({ event: "pusher:pong", data: {} }));
        } catch {}
        return;
      }

      if (event === "pusher:error") {
        finish(`pusher error: ${JSON.stringify(frame?.data ?? {})}`);
        return;
      }

      // Chat message event — Kick wraps the payload as a JSON string in `data`.
      if (
        event === "App\\Events\\ChatMessageEvent" ||
        event.endsWith("ChatMessageEvent")
      ) {
        let payload: any = frame.data;
        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch {
            return;
          }
        }
        const id = String(payload?.id ?? payload?.uuid ?? "");
        const content = String(payload?.content ?? "");
        const username =
          payload?.sender?.username ??
          payload?.user?.username ??
          payload?.username ??
          "anon";
        const createdAt =
          payload?.created_at ?? payload?.createdAt ?? new Date().toISOString();
        if (id && content) {
          messages.push({ id, content, username, createdAt });
        }
      }
    });

    ws.addEventListener("close", () => {
      finish();
    });
    ws.addEventListener("error", () => {
      finish("ws error");
    });

    timer = setTimeout(() => finish(), durationMs);
  });
}
