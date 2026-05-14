import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getCachedPlayback,
  setLivePlaybackUrl,
} from "@/lib/browser-capture.functions";

type Props = {
  sourceId: string;
  slug: string;
  muted: boolean;
  onVideoReady?: (video: HTMLVideoElement) => void;
  onResolveStatus?: (status: "loading" | "playing" | "failed") => void;
};

/**
 * Same-origin Kick player. Tries to get the m3u8 from the server cache, then
 * from a direct browser fetch (browser CORS sometimes succeeds where the
 * Worker IP is blocked). Falls back to the official iframe if everything
 * fails — but in that fallback browser-side recording is not available.
 */
export function KickHlsPlayer({
  sourceId,
  slug,
  muted,
  onVideoReady,
  onResolveStatus,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const getCached = useServerFn(getCachedPlayback);
  const cacheUrl = useServerFn(setLivePlaybackUrl);

  // Resolve playback URL.
  useEffect(() => {
    let alive = true;
    onResolveStatus?.("loading");

    (async () => {
      try {
        const cached = await getCached({ data: { sourceId } });
        if (!alive) return;
        if (cached?.url) {
          setPlaybackUrl(cached.url);
          return;
        }

        // Try to fetch from kick.com directly in the browser.
        const endpoints = [
          `https://kick.com/api/v2/channels/${slug}`,
          `https://kick.com/api/v1/channels/${slug}`,
        ];
        for (const ep of endpoints) {
          try {
            const r = await fetch(ep, { credentials: "omit" });
            if (!r.ok) continue;
            const j: any = await r.json();
            const url =
              j?.playback_url ??
              j?.livestream?.playback_url ??
              j?.data?.playback_url ??
              null;
            if (url && /\.m3u8/i.test(url)) {
              if (!alive) return;
              setPlaybackUrl(url);
              cacheUrl({ data: { sourceId, playbackUrl: url } }).catch(
                () => undefined,
              );
              return;
            }
          } catch {
            // CORS or network — try next.
          }
        }

        if (!alive) return;
        setFailed(true);
        onResolveStatus?.("failed");
      } catch {
        if (alive) {
          setFailed(true);
          onResolveStatus?.("failed");
        }
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, slug]);

  // Attach hls.js when we have a URL.
  useEffect(() => {
    if (!playbackUrl) return;
    const video = videoRef.current;
    if (!video) return;

    let hls: any = null;
    let cancelled = false;

    (async () => {
      // Safari has native HLS.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playbackUrl;
        try {
          await video.play();
        } catch {
          /* autoplay block ok */
        }
        if (!cancelled) {
          onVideoReady?.(video);
          onResolveStatus?.("playing");
        }
        return;
      }
      // hls.js for everyone else.
      const mod = await import("hls.js");
      if (cancelled) return;
      const Hls = mod.default;
      if (!Hls.isSupported()) {
        setFailed(true);
        onResolveStatus?.("failed");
        return;
      }
      hls = new Hls({
        liveDurationInfinity: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => undefined);
        onVideoReady?.(video);
        onResolveStatus?.("playing");
      });
      hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
        if (data?.fatal) {
          console.warn("[kick-hls-player] fatal", data);
          setFailed(true);
          onResolveStatus?.("failed");
        }
      });
    })();

    return () => {
      cancelled = true;
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackUrl]);

  if (failed) {
    // Iframe fallback (no browser-record capability here).
    return (
      <iframe
        src={`https://player.kick.com/${slug}?muted=${muted ? "true" : "false"}&autoplay=true`}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
        title={`${slug} live (fallback)`}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      className="w-full h-full bg-black"
      autoPlay
      muted={muted}
      playsInline
      // crossOrigin not needed — same-origin via fetch through hls.js.
    />
  );
}
