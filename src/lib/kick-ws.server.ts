// Kick chat via Pusher WebSocket (public, no auth).
// Uses Cloudflare Workers' fetch-upgrade pattern.

import type { KickChatMessage } from "@/lib/kick.server";

const PUSHER_FETCH_URL =
  "https://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false";

export type ChatSample = {
  messages: KickChatMessage[];
  durationMs: number;
  connected: boolean;
  error?: string;
};

export async function sampleKickChat(
  chatroomId: number | string,
  durationMs = 10_000,
): Promise<ChatSample> {
  const start = Date.now();
  const messages: KickChatMessage[] = [];
  let connected = false;
  let firstMsgLogged = false;

  let ws: WebSocket;
  try {
    const resp = await fetch(PUSHER_FETCH_URL, {
      headers: {
        Upgrade: "websocket",
        Origin: "https://kick.com",
      },
    });
    const sock = (resp as unknown as { webSocket: WebSocket | null }).webSocket;
    console.log(
      `[kick-ws] upgrade chatroom=${chatroomId} status=${resp.status} hasSocket=${!!sock}`,
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
      error: `ws upgrade fetch failed: ${err?.message ?? String(err)}`,
    };
  }

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

    (ws as any).onmessage = (ev: MessageEvent) => {
      let frame: any;
      const raw = typeof ev.data === "string" ? ev.data : "";
      try {
        frame = JSON.parse(raw);
      } catch {
        return;
      }
      const event: string = frame?.event ?? "";

      if (event === "pusher:connection_established") {
        connected = true;
        console.log(`[kick-ws] connected chatroom=${chatroomId}`);
        try {
          ws.send(
            JSON.stringify({
              event: "pusher:subscribe",
              data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
            }),
          );
        } catch (err: any) {
          finish(`subscribe send failed: ${err?.message ?? String(err)}`);
        }
        return;
      }

      if (event === "pusher_internal:subscription_succeeded") {
        console.log(`[kick-ws] subscribed chatroom=${chatroomId}`);
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
            console.log(`[kick-ws] first msg chatroom=${chatroomId}`);
          }
        }
      }
    };

    (ws as any).onclose = (ev: CloseEvent) => {
      console.log(
        `[kick-ws] close chatroom=${chatroomId} code=${ev?.code} reason=${ev?.reason}`,
      );
      finish();
    };

    (ws as any).onerror = (ev: Event) => {
      const detail = (ev as any)?.message ?? (ev as any)?.error ?? "";
      console.log(
        `[kick-ws] error chatroom=${chatroomId} detail=${String(detail).slice(0, 200)}`,
      );
      finish(`ws error: ${String(detail).slice(0, 200)}`);
    };

    setTimeout(() => finish(), durationMs);
  });
}
