// Kick chat via Pusher WebSocket (public, no auth).
// Uses Cloudflare Workers' fetch-upgrade pattern — the standard
// `new WebSocket(url)` constructor does NOT establish outbound
// connections in Workers; you must do `fetch(url, { headers: { Upgrade } })`
// and read `response.webSocket`.

import type { KickChatMessage } from "@/lib/kick.server";

const PUSHER_URL =
  "wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false";

// HTTPS variant for fetch-upgrade. Workers accept https/wss interchangeably
// here, but http(s) is the documented form for the upgrade fetch.
const PUSHER_FETCH_URL = PUSHER_URL.replace(/^wss:/, "https:");

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
export async function sampleKickChat(
  chatroomId: number | string,
  durationMs = 10_000,
): Promise<ChatSample> {
  const start = Date.now();
  const messages: KickChatMessage[] = [];
  let connected = false;
  let firstMsgLogged = false;

  // 1. Upgrade via fetch — Cloudflare Workers' supported outbound WS path.
  let ws: WebSocket;
  try {
    const resp = await fetch(PUSHER_FETCH_URL, {
      headers: { Upgrade: "websocket" },
    });
    const sock = (resp as unknown as { webSocket: WebSocket | null }).webSocket;
    console.log(
      `[kick-ws] upgrade status=${resp.status} hasSocket=${!!sock}`,
    );
    if (resp.status !== 101 || !sock) {
      const bodyPreview = await resp.text().catch(() => "");
      return {
        messages,
        durationMs: Date.now() - start,
        connected: false,
        error: `upgrade failed status=${resp.status} :: ${bodyPreview.slice(0, 200)}`,
      };
    }
    ws = sock;
    (ws as unknown as { accept: () => void }).accept();
  } catch (err: any) {
    return {
      messages,
      durationMs: Date.now() - start,
      connected: false,
      error: `ws upgrade failed: ${err?.message ?? String(err)}`,
    };
  }

  // 2. Collect for durationMs, then resolve.
  return await new Promise<ChatSample>((resolve) => {
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      resolve({
        messages,
        durationMs: Date.now() - start,
        connected,
        error,
      });
    };

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
          ws.send(
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
          ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
        } catch {}
        return;
      }

      if (event === "pusher:error") {
        finish(`pusher error: ${JSON.stringify(frame?.data ?? {})}`);
        return;
      }

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
          if (!firstMsgLogged) {
            firstMsgLogged = true;
            console.log(`[kick-ws] first msg for chatroom ${chatroomId}`);
          }
        }
      }
    });

    ws.addEventListener("close", () => finish());
    ws.addEventListener("error", () => finish("ws error"));

    setTimeout(() => finish(), durationMs);
  });
}
