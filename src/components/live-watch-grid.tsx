import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  listLiveSources,
  listLiveChatActivity,
  manualGrabClip,
} from "@/lib/clips.functions";

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

function StreamTile({
  source,
  activity,
  unmuted,
  onUnmute,
  forceLight,
}: {
  source: LiveSource;
  activity: any;
  unmuted: boolean;
  onUnmute: () => void;
  forceLight: boolean;
}) {
  const grab = useServerFn(manualGrabClip);
  const [caption, setCaption] = useState("");
  const [duration, setDuration] = useState(30);
  const [mounted, setMounted] = useState(!forceLight);
  const [lastGrab, setLastGrab] = useState<number | null>(null);

  useEffect(() => {
    setMounted(!forceLight);
  }, [forceLight, source.id]);

  const grabMut = useMutation({
    mutationFn: () =>
      grab({
        data: {
          sourceId: source.id,
          caption: caption.trim() || undefined,
          durationSec: duration,
        },
      }),
    onSuccess: (res: any) => {
      if (res?.ok) {
        toast.success(`${source.display_name} · CLIP QUEUED`);
        setLastGrab(Date.now());
        setCaption("");
      } else {
        toast.error(res?.error ?? "Grab failed");
      }
    },
    onError: (err: any) => toast.error(err?.message ?? "Grab failed"),
  });

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
      <div className="relative aspect-video bg-black">
        {mounted ? (
          <iframe
            key={`${source.slug}-${unmuted ? "on" : "off"}`}
            src={`https://player.kick.com/${source.slug}?muted=${unmuted ? "false" : "true"}&autoplay=true`}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
            title={`${source.display_name} live`}
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
            {grabMut.isPending ? "…" : "▶ GRAB"}
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

  if (!sources.length) return null;

  return (
    <section className="bg-panel/40 border border-blood/40 scanlines">
      <div className="px-3 sm:px-4 py-3 border-b border-blood/40 flex items-center justify-between">
        <h3 className="font-display text-lg sm:text-xl tracking-widest text-foreground">
          LIVE WATCH
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground tracking-widest">
          {liveSources.length} LIVE · {offlineSources.length} OFFLINE
        </span>
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
