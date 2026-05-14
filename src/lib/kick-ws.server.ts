// Kick chat sampling via REST polling.
//
// Cloudflare Workers' outbound WebSocket-to-Pusher upgrade has been silently
// dropping frames in production (zero msgs/sec across all sources), so we
// poll the REST endpoint instead: snapshot recent messages, sleep for the
// window, snapshot again, and count message ids that appeared in window 2
// but not window 1.

import type { KickChatMessage } from "@/lib/kick.server";

export type ChatSample = {
  messages: KickChatMessage[];
  durationMs: number;
  connected: boolean;
  error?: string;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://kick.com/",
  Origin: "https://kick.com",
};

async function fetchRecentMessages(
  chatroomId: number | string,
): Promise<KickChatMessage[] | null> {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(String(chatroomId))}/messages`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const preview = await res.text().catch(() => "");
      console.warn(
        `[kick-chat] non-OK ${res.status} chatroom=${chatroomId} :: ${preview.slice(0, 120)}`,
      );
      return null;
    }
    const json: any = await res.json();
    const list: any[] = json?.data?.messages ?? json?.messages ?? json?.data ?? [];
    return list
      .map((m): KickChatMessage | null => {
        const id = String(m?.id ?? m?.uuid ?? "");
        const content = String(m?.content ?? "");
        if (!id || !content) return null;
        const username =
          m?.sender?.username ??
          m?.user?.username ??
          m?.username ??
          "anon";
        const createdAt =
          m?.created_at ?? m?.createdAt ?? new Date().toISOString();
        return { id, content, username, createdAt };
      })
      .filter((x): x is KickChatMessage => x !== null);
  } catch (err: any) {
    console.error(`[kick-chat] fetch threw chatroom=${chatroomId}`, err);
    return null;
  }
}

export async function sampleKickChat(
  chatroomId: number | string,
  durationMs = 10_000,
): Promise<ChatSample> {
  const start = Date.now();

  const before = await fetchRecentMessages(chatroomId);
  if (!before) {
    return {
      messages: [],
      durationMs: Date.now() - start,
      connected: false,
      error: "rest snapshot 1 failed",
    };
  }
  const seenIds = new Set(before.map((m) => m.id));
  console.log(
    `[kick-chat] chatroom=${chatroomId} snap1=${before.length} sleeping=${durationMs}ms`,
  );

  await new Promise((r) => setTimeout(r, durationMs));

  const after = await fetchRecentMessages(chatroomId);
  if (!after) {
    return {
      messages: [],
      durationMs: Date.now() - start,
      connected: false,
      error: "rest snapshot 2 failed",
    };
  }

  const newOnes = after.filter((m) => !seenIds.has(m.id));
  console.log(
    `[kick-chat] chatroom=${chatroomId} snap2=${after.length} new=${newOnes.length}`,
  );

  return {
    messages: newOnes,
    durationMs: Date.now() - start,
    connected: true,
  };
}
