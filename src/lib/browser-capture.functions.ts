import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { signUploadToken } from "@/lib/browser-capture.server";

/** Issue a short-lived HMAC token the browser can use to upload a clip blob. */
export const issueUploadToken = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ sourceId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const token = await signUploadToken(data.sourceId);
    return { token, expiresAt: Date.now() + 5 * 60_000 };
  });

/** Browser found the m3u8 itself — cache it on the source row. */
export const setLivePlaybackUrl = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        sourceId: z.string().uuid(),
        playbackUrl: z.string().url().max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!/\.m3u8/i.test(data.playbackUrl)) {
      return { ok: false, error: "not an m3u8" };
    }
    const { error } = await supabaseAdmin
      .from("sources")
      .update({
        live_playback_url: data.playbackUrl,
        live_playback_url_updated_at: new Date().toISOString(),
      })
      .eq("id", data.sourceId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });

/** Return the cached playback URL for a source if recent enough. */
export const getCachedPlayback = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ sourceId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: src } = await supabaseAdmin
      .from("sources")
      .select("live_playback_url, live_playback_url_updated_at, slug")
      .eq("id", data.sourceId)
      .maybeSingle();
    if (!src) return { url: null, slug: null };
    const ageMs = src.live_playback_url_updated_at
      ? Date.now() - +new Date(src.live_playback_url_updated_at)
      : Infinity;
    return {
      url: ageMs < 30 * 60_000 ? src.live_playback_url : null,
      slug: src.slug,
    };
  });
