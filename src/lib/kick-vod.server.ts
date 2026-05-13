// Resolve a Kick VOD that contains a given timestamp from a stream session.

const UA =
  "Mozilla/5.0 (compatible; GreatsClipper/1.0; +https://greatsclipper.local)";

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export type ResolvedVod = {
  vodUrl: string; // HLS .m3u8 URL
  startOffsetSec: number; // offset from VOD start to the target moment
};

/**
 * Find a Kick VOD that covers `targetIso` and return playback URL + offset.
 * Returns null if no archived VOD covers that moment yet.
 */
export async function resolveVodAt(
  slug: string,
  targetIso: string,
): Promise<ResolvedVod | null> {
  const target = +new Date(targetIso);
  if (!isFinite(target)) return null;

  const data = await fetchJson(
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/videos`,
  );
  const list: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  if (!list.length) return null;

  for (const v of list) {
    const startIso =
      v.created_at ?? v.start_time ?? v.video?.created_at ?? null;
    const durationSec = Number(
      v.duration ?? v.video?.duration ?? v.session_duration ?? 0,
    );
    if (!startIso || !durationSec) continue;
    const start = +new Date(startIso);
    const end = start + durationSec * 1000;
    if (target >= start - 10_000 && target <= end + 10_000) {
      const playbackUrl =
        v.source ?? v.video?.source ?? v.playback_url ?? v.video?.uuid
          ? `https://stream.kick.com/ivs/v1/${v.video?.uuid}/master.m3u8`
          : null;
      const url = v.source ?? v.video?.source ?? playbackUrl;
      if (!url) continue;
      const offset = Math.max(0, Math.round((target - start) / 1000));
      return { vodUrl: url, startOffsetSec: offset };
    }
  }
  return null;
}
