// Unofficial Kick adapter. Endpoints are not stable; we wrap with retry + tolerant parsing.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function kickFetch(url: string, init?: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://kick.com/",
          Origin: "https://kick.com",
          ...(init?.headers ?? {}),
        },
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        let preview = "";
        try {
          preview = (await res.text()).slice(0, 200);
        } catch {}
        console.warn(`[kick] non-OK ${res.status} ${url} :: ${preview}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error(`[kick] fetch failed (${attempt + 1}/3) ${url}`, err);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

export type KickChannel = {
  slug: string;
  isLive: boolean;
  followers: number | null;
  viewers: number | null;
  sessionTitle: string | null;
};

export async function getChannel(slug: string): Promise<KickChannel | null> {
  const data = await kickFetch(
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
  );
  if (!data) return null;
  const livestream = data.livestream ?? null;
  return {
    slug: data.slug ?? slug,
    isLive: !!livestream,
    followers: data.followers_count ?? null,
    viewers: livestream?.viewer_count ?? null,
    sessionTitle: livestream?.session_title ?? null,
  };
}

export type KickClip = {
  id: string;
  url: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  title: string;
  durationSeconds: number;
  viewCount: number;
  createdAt: string;
  streamerName: string;
};

export async function getRecentClips(slug: string): Promise<KickClip[]> {
  // Try channel-scoped clips endpoint variants. Kick has shifted these; we try a few.
  const candidates = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/clips?sort=date&time=day`,
    `https://kick.com/api/v2/clips?channel=${encodeURIComponent(slug)}&sort=date&time=day`,
  ];
  let raw: any = null;
  for (const url of candidates) {
    raw = await kickFetch(url);
    if (raw) break;
  }
  if (!raw) return [];
  const list: any[] = raw.clips ?? raw.data ?? raw ?? [];
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => ({
      id: String(c.id ?? c.clip_id ?? ""),
      url: c.clip_url ?? `https://kick.com/${slug}?clip=${c.id}`,
      videoUrl: c.video_url ?? c.clip_url ?? null,
      thumbnailUrl: c.thumbnail_url ?? c.thumbnail?.src ?? null,
      title: c.title ?? "",
      durationSeconds: Number(c.duration ?? 0) | 0,
      viewCount: Number(c.views ?? c.view_count ?? 0) | 0,
      createdAt: c.created_at ?? new Date().toISOString(),
      streamerName: c.channel?.username ?? slug,
    }))
    .filter((c) => c.id);
}

export type KickChatMessage = {
  id: string;
  content: string;
  username: string;
  createdAt: string; // ISO
};

export async function getRecentChat(slug: string): Promise<KickChatMessage[]> {
  // Resolve chatroom id once
  const ch = await kickFetch(
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
  );
  const chatroomId = ch?.chatroom?.id;
  if (!chatroomId) {
    console.warn(`[kick] no chatroom id for ${slug}`);
    return [];
  }

  const endpoints = [
    `https://kick.com/api/v2/chatrooms/${chatroomId}/messages`,
    `https://kick.com/api/v1/chatrooms/${chatroomId}/messages`,
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/messages`,
  ];

  for (const url of endpoints) {
    const data = await kickFetch(url, {
      headers: { Referer: `https://kick.com/${slug}` },
    });
    if (!data) continue;
    const list: any[] =
      data?.data?.messages ??
      data?.messages ??
      (Array.isArray(data?.data) ? data.data : null) ??
      (Array.isArray(data) ? data : []);
    if (!Array.isArray(list) || list.length === 0) continue;
    const parsed = list
      .map((m) => ({
        id: String(m.id ?? m.uuid ?? ""),
        content: String(m.content ?? m.message ?? ""),
        username:
          m.sender?.username ?? m.user?.username ?? m.username ?? "anon",
        createdAt: m.created_at ?? m.createdAt ?? new Date().toISOString(),
      }))
      .filter((m) => m.id && m.content)
      .slice(0, 50);
    console.log(
      `[kick] chat for ${slug} via ${url} → ${parsed.length} messages`,
    );
    if (parsed.length > 0) return parsed;
  }

  console.warn(
    `[kick] all chat endpoints empty for ${slug} (chatroomId=${chatroomId})`,
  );
  return [];
}
