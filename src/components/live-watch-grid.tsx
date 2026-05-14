import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  listLiveSources,
  listLiveChatActivity,
  manualGrabClip,
} from "@/lib/clips.functions";
import { issueUploadToken } from "@/lib/browser-capture.functions";
import { KickHlsPlayer } from "@/components/kick-hls-player";
import { useRollingRecorder } from "@/components/use-rolling-recorder";

type LiveSource = {
  id: string;
  slug: string;
  display_name: string;
  last_known_live: boolean;
  avg_viewers: number | null;
};

function ChatSpikeBadge({ activity }: { activity: any }) {
  const latest = activity?.latest;
  const mps = latest ? Number(latest.msgs_per_sec) : null;
  const ratio = latest ? Number(latest.spike_ratio ?? 0) : 0;
  const tone =
    ratio >= 2
      ? "bg-blood text-blood-foreground border-blood animate-pulse-dot shadow-glow-red"
      : ratio >= 1.2
        ? "bg-gold/90 text-background border-gold"
        : "bg-background/80 text-foreground border-blood/40";
  return (
    <div
      className={`absolute bottom-2 left-2 px-2 py-1 text-[10px] font-mono tracking-widest border ${tone}`}
      title="Chat messages per second / spike ratio"
    >
      {mps === null ? "CHAT —" : `CHAT ${mps.toFixed(1)}/s`}
      {ratio >= 1.2 ? ` · ${ratio.toFixed(1)}x` : ""}
    </div>
  );
}

function ArmedBadge({
  ready,
  bufferedSec,
  failed,
}: {
  ready: boolean;
  bufferedSec: number;
  failed: boolean;
}) {
  if (failed) {
    return (
      <span
        className="px-1.5 py-0.5 text-[9px] font-mono tracking-widest border border-muted-foreground/40 text-muted-foreground"
        title="Falling back to embedded player — browser recording unavailable"
      >
        FALLBACK
      </span>
    );
  }
  if (!ready) {
    return (
      <span
        className="px-1.5 py-0.5 text-[9px] font-mono tracking-widest border border-blood/30 text-muted-foreground"
        title="Buffer warming up"
      >
        ARMING…
      </span>
    );
  }
  return (
    <span
      className="px-1.5 py-0.5 text-[9px] font-mono tracking-widest border border-blood text-blood animate-pulse-dot"
      title={`Rolling buffer: ${Math.round(bufferedSec)}s captured`}
    >
      ARMED · {Math.round(bufferedSec)}s
    </span>
  );
}

function StreamTile({
  source,
  activity,
  unmuted,
  onUnmute,
  forceLight,
  reportStatus,
}: {
  source: LiveSource;
  activity: any;
  unmuted: boolean;
  onUnmute: () => void;
  forceLight: boolean;
  reportStatus: (
    sourceId: string,
    status: { ready: boolean; failed: boolean; buffered: number },
  ) => void;
}) {
  const grabFallback = useServerFn(manualGrabClip);
  const issueToken = useServerFn(issueUploadToken);
  const [caption, setCaption] = useState("");
  const [duration, setDuration] = useState(30);
  const [mounted, setMounted] = useState(!forceLight);
  const [lastGrab, setLastGrab] = useState<number | null>(null);
  const [playerStatus, setPlayerStatus] = useState<
    "loading" | "playing" | "failed"
  >("loading");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorder = useRollingRecorder(videoRef, {
    bufferSec: 60,
    enabled: mounted && playerStatus === "playing",
  });

  useEffect(() => {
    setMounted(!forceLight);
  }, [forceLight, source.id]);

  useEffect(() => {
    reportStatus(source.id, {
      ready: recorder.ready,
      failed: playerStatus === "failed",
      buffered: recorder.bufferedSec,
    });
  }, [
    recorder.ready,
    recorder.bufferedSec,
    playerStatus,
    source.id,
    reportStatus,
  ]);

  const grabMut = useMutation({
    mutationFn: async () => {
      // 1) If browser-recorder is armed → upload directly.
      if (recorder.ready) {
        const blob = await recorder.grab(duration);
        if (!blob || blob.size < 1024) {
          throw new Error("Empty buffer — try again in a few seconds");
        }
        const tok = await issueToken({ data: { sourceId: source.id } });
        const fd = new FormData();
        fd.set("token", tok.token);
        fd.set("sourceId", source.id);
        fd.set("durationSec", String(duration));
        fd.set("caption", caption.trim());
        fd.set("autoGrabbed", "false");
        fd.set("captureMethod", "browser_record");
        fd.set("file", blob, `clip-${Date.now()}.webm`);
        const res = await fetch("/api/public/upload-clip", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Upload failed: ${txt}`);
        }
        return await res.json();
      }
      // 2) Fallback to server-side HLS pipeline.
      return await grabFallback({
        data: {
          sourceId: source.id,
          caption: caption.trim() || undefined,
          durationSec: duration,
        },
      });
    },
    onSuccess: (res: any) => {
      if (res?.ok) {
        const via = recorder.ready ? "BROWSER" : "SERVER";
        toast.success(`${source.display_name} · CLIP QUEUED (${via})`);
        setLastGrab(Date.now());
        setCaption("");
      } else {
        toast.error(res?.error ?? "Grab failed");
      }
    },
    onError: (err: any) => toast.error(err?.message ?? "Grab failed"),
  });

  // ===== Browser-side AUTO-GRAB on chat spike =====
  // When this tile is armed and the latest velocity row for its source is a
  // spike (and cooldown elapsed), slice the rolling buffer and upload it.
  const autoGrabbingRef = useRef(false);
  const lastAutoAtRef = useRef(0);
  useEffect(() => {
    const latest = activity?.latest;
    if (!latest?.is_spike) return;
    if (!recorder.ready) return;
    if (autoGrabbingRef.current) return;
    // 3 minute cooldown per tile (server cooldown still recorded separately)
    if (Date.now() - lastAutoAtRef.current < 180_000) return;
    // Only react to fresh spikes (within last 30s)
    const ageSec = (Date.now() - +new Date(latest.created_at)) / 1000;
    if (ageSec > 30) return;

    autoGrabbingRef.current = true;
    lastAutoAtRef.current = Date.now();
    (async () => {
      try {
        const blob = await recorder.grab(30);
        if (!blob || blob.size < 1024) return;
        const tok = await issueToken({ data: { sourceId: source.id } });
        const fd = new FormData();
        fd.set("token", tok.token);
        fd.set("sourceId", source.id);
        fd.set("durationSec", "30");
        fd.set("autoGrabbed", "true");
        fd.set("captureMethod", "browser_record");
        fd.set("chatSpikeRatio", String(latest.spike_ratio ?? ""));
        fd.set(
          "caption",
          `${source.display_name.toUpperCase()} CHAT SPIKE ${Number(latest.spike_ratio ?? 0).toFixed(1)}x`,
        );
        fd.set("file", blob, `auto-${Date.now()}.webm`);
        const res = await fetch("/api/public/upload-clip", {
          method: "POST",
          body: fd,
        });
        if (res.ok) {
          toast.success(
            `${source.display_name} · AUTO-GRAB (${Number(latest.spike_ratio ?? 0).toFixed(1)}x)`,
          );
          setLastGrab(Date.now());
        } else {
          console.warn("[auto-grab] upload failed", await res.text());
        }
      } catch (err) {
        console.warn("[auto-grab] failed", err);
      } finally {
        autoGrabbingRef.current = false;
      }
    })();
  }, [activity?.latest, recorder.ready, source.id, source.display_name, issueToken, recorder]);

  return (
    <div className="bg-panel border border-blood/40 flex flex-col">
      <div className="px-2.5 py-2 border-b border-blood/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              source.last_known_live ? "bg-blood animate-pulse-dot" : "bg-muted-foreground"
            }`}
          />
          <span className="text-xs font-mono tracking-widest text-foreground truncate">
            {source.display_name}
          </span>
          {source.avg_viewers ? (
            <span className="text-[10px] font-mono text-muted-foreground tracking-widest hidden sm:inline">
              · {source.avg_viewers.toLocaleString()}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <ArmedBadge
            ready={recorder.ready}
            bufferedSec={recorder.bufferedSec}
            failed={playerStatus === "failed"}
          />
          <button
            type="button"
            onClick={onUnmute}
            className={`px-2 py-1 text-[10px] font-mono tracking-widest border min-h-[28px] ${
              unmuted
                ? "bg-blood text-blood-foreground border-blood"
                : "border-blood/40 text-foreground hover:bg-blood/10"
            }`}
          >
            {unmuted ? "🔊" : "🔇"}
          </button>
        </div>
      </div>
      <div className="relative aspect-video bg-black">
        {mounted ? (
          <KickHlsPlayer
            sourceId={source.id}
            slug={source.slug}
            muted={!unmuted}
            onVideoReady={(v) => {
              videoRef.current = v;
            }}
            onResolveStatus={setPlayerStatus}
          />
        ) : (
          <button
            type="button"
            onClick={() => setMounted(true)}
            className="w-full h-full flex flex-col items-center justify-center gap-2 hover:bg-blood/10"
          >
            <span className="font-display text-3xl text-blood">▶</span>
            <span className="text-[10px] font-mono tracking-widest text-muted-foreground">
              TAP TO LOAD STREAM
            </span>
          </button>
        )}
        <ChatSpikeBadge activity={activity} />
      </div>
      <div className="p-2 flex flex-col gap-2">
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={80}
          placeholder="caption (optional)"
          className="bg-background border border-blood/40 text-foreground text-xs font-mono px-2 py-2 tracking-wider focus:border-blood focus:outline-none"
        />
        <div className="flex gap-1.5">
          {[15, 30, 45].map((d) => {
            const active = duration === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`flex-1 py-2 text-[10px] font-mono tracking-widest border min-h-[36px] ${
                  active
                    ? "bg-blood text-blood-foreground border-blood"
                    : "border-blood/40 text-foreground hover:bg-blood/10"
                }`}
              >
                {d}s
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => grabMut.mutate()}
            disabled={grabMut.isPending}
            className="flex-[2] py-2 text-[10px] font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50 min-h-[36px]"
          >
            {grabMut.isPending ? "…" : recorder.ready ? "▶ GRAB (LIVE)" : "▶ GRAB"}
          </button>
        </div>
        {lastGrab && (
          <p className="text-[10px] font-mono text-muted-foreground tracking-widest">
            LAST GRAB · {Math.max(1, Math.round((Date.now() - lastGrab) / 1000))}s ago
          </p>
        )}
      </div>
    </div>
  );
}

export function LiveWatchGrid() {
  const fetchLive = useServerFn(listLiveSources);
  const fetchActivity = useServerFn(listLiveChatActivity);
  const { data } = useQuery({
    queryKey: ["live-sources"],
    queryFn: () => fetchLive(),
    refetchInterval: 30_000,
  });
  const { data: act } = useQuery({
    queryKey: ["live-chat-activity"],
    queryFn: () => fetchActivity(),
    refetchInterval: 15_000,
  });

  const sources = (data?.sources ?? []) as LiveSource[];
  const liveSources = sources.filter((s) => s.last_known_live);
  const offlineSources = sources.filter((s) => !s.last_known_live);

  const activityById = new Map<string, any>();
  for (const s of (act?.sources ?? []) as any[]) activityById.set(s.id, s);

  const [unmutedId, setUnmutedId] = useState<string | null>(null);
  const isMobile =
    typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches;

  // Watchdog status: track which sources have an armed browser recorder.
  const [watchdog, setWatchdog] = useState<
    Record<string, { ready: boolean; failed: boolean; buffered: number }>
  >({});
  const reportStatus = (
    sourceId: string,
    status: { ready: boolean; failed: boolean; buffered: number },
  ) => {
    setWatchdog((prev) => {
      const cur = prev[sourceId];
      if (
        cur &&
        cur.ready === status.ready &&
        cur.failed === status.failed &&
        Math.round(cur.buffered) === Math.round(status.buffered)
      )
        return prev;
      return { ...prev, [sourceId]: status };
    });
  };

  if (!sources.length) return null;

  const armedCount = Object.values(watchdog).filter((s) => s.ready).length;
  const fallbackCount = Object.values(watchdog).filter((s) => s.failed).length;

  return (
    <section className="bg-panel/40 border border-blood/40 scanlines">
      <div className="px-3 sm:px-4 py-3 border-b border-blood/40 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-display text-lg sm:text-xl tracking-widest text-foreground">
          LIVE WATCH
        </h3>
        <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest">
          <span
            className={`px-2 py-0.5 border ${
              armedCount > 0
                ? "border-blood text-blood"
                : "border-muted-foreground/40 text-muted-foreground"
            }`}
            title="Streams with an armed browser recorder ready to slice clips"
          >
            WATCHDOG · {armedCount}/{liveSources.length} ARMED
            {fallbackCount > 0 ? ` · ${fallbackCount} FALLBACK` : ""}
          </span>
          <span className="text-muted-foreground">
            {liveSources.length} LIVE · {offlineSources.length} OFFLINE
          </span>
        </div>
      </div>

      {liveSources.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="font-display text-2xl text-blood/40 tracking-widest">
            NO STREAMS LIVE
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
          {liveSources.map((s) => (
            <StreamTile
              key={s.id}
              source={s}
              activity={activityById.get(s.id)}
              unmuted={unmutedId === s.id}
              onUnmute={() => setUnmutedId((cur) => (cur === s.id ? null : s.id))}
              forceLight={isMobile}
              reportStatus={reportStatus}
            />
          ))}
        </div>
      )}

      {offlineSources.length > 0 && (
        <div className="px-3 sm:px-4 py-2 border-t border-blood/20 text-[10px] font-mono text-muted-foreground tracking-widest">
          OFFLINE · {offlineSources.map((s) => s.display_name).join(" · ")}
        </div>
      )}
    </section>
  );
}
