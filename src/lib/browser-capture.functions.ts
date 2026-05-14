import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ---- HMAC helpers (Web Crypto, Worker-safe) ----
async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signUploadToken(sourceId: string, ttlMs = 5 * 60_000) {
  const exp = Date.now() + ttlMs;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sig = await hmacHex(key, `${sourceId}.${exp}`);
  return `${sourceId}.${exp}.${sig}`;
}

export async function verifyUploadToken(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sourceId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return null;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const expected = await hmacHex(key, `${sourceId}.${exp}`);
  if (expected !== sig) return null;
  return sourceId;
}

// ---- Server fns called by browser ----

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
