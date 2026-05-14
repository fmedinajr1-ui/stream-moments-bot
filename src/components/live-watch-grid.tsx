import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  listLiveSources,
  listLiveChatActivity,
} from "@/lib/clips.functions";
import { markMoment, listMarkedMoments } from "@/lib/marked-moments.functions";
import { KickHlsPlayer } from "@/components/kick-hls-player";

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
  const noSignal = mps === null || mps === 0;
  const tone = noSignal
    ? "bg-background/80 text-muted-foreground border-muted-foreground/40"
    : ratio >= 2
      ? "bg-blood text-blood-foreground border-blood animate-pulse-dot shadow-glow-red"
      : ratio >= 1.2
        ? "bg-gold/90 text-background border-gold"
        : "bg-background/80 text-foreground border-blood/40";
  return (
    <div
      className={`absolute bottom-2 left-2 px-2 py-1 text-[10px] font-mono tracking-widest border ${tone}`}
      title="Chat messages per second / spike ratio"
    >
      {noSignal ? "CHAT —" : `CHAT ${mps!.toFixed(1)}/s`}
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
  const markFn = useServerFn(markMoment);
  const [caption, setCaption] = useState("");
  const [duration, setDuration] = useState(30);
  const [mounted, setMounted] = useState(!forceLight);
  const [lastMark, setLastMark] = useState<number | null>(null);

  const markMut = useMutation({
    mutationFn: () =>
      markFn({
        data: {
          sourceId: source.id,
          durationSec: duration,
          caption: caption.trim() || undefined,
        },
      }),
    onSuccess: (res: any) => {
      if (res?.ok) {
        toast.success(`${source.display_name} · MOMENT MARKED · ${duration}s`);
        setLastMark(Date.now());
        setCaption("");
      } else {
        toast.error(res?.error ?? "Mark failed");
      }
    },
    onError: (err: any) => toast.error(err?.message ?? "Mark failed"),
  });

  return (
    <div className="bg-panel border border-blood/40 flex flex-col">
      <div className="px-2.5 py-2 border-b border-blood/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              source.last_known_live
                ? "bg-blood animate-pulse-dot"
                : "bg-muted-foreground"
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
          <span
            className="px-1.5 py-0.5 text-[9px] font-mono tracking-widest border border-blood/40 text-muted-foreground"
            title="Marked moments are resolved from the VOD after the stream archives."
          >
            VOD CAPTURE
          </span>
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
          maxLength={120}
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
            onClick={() => markMut.mutate()}
            disabled={markMut.isPending}
            className="flex-[2] py-2 text-[10px] font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50 min-h-[36px]"
          >
            {markMut.isPending ? "…" : "● MARK MOMENT"}
          </button>
        </div>
        {lastMark && (
          <p className="text-[10px] font-mono text-muted-foreground tracking-widest">
            LAST MARK · {Math.max(1, Math.round((Date.now() - lastMark) / 1000))}s
            ago — RESOLVES FROM VOD
          </p>
        )}
      </div>
    </div>
  );
}

function MarkedMomentsStrip() {
  const fetchFn = useServerFn(listMarkedMoments);
  const { data } = useQuery({
    queryKey: ["marked-moments"],
    queryFn: () => fetchFn(),
    refetchInterval: 20_000,
  });
  const moments = (data?.moments ?? []) as Array<any>;
  if (!moments.length) return null;
  const recent = moments.slice(0, 10);
  return (
    <div className="px-3 sm:px-4 py-2 border-t border-blood/20 flex items-center gap-2 overflow-x-auto">
      <span className="text-[10px] font-mono text-muted-foreground tracking-widest flex-shrink-0">
        MARKED ·
      </span>
      {recent.map((m) => {
        const ageSec = Math.max(
          0,
          Math.round((Date.now() - +new Date(m.marked_at)) / 1000),
        );
        const tone =
          m.status === "resolved"
            ? "border-blood text-blood"
            : m.status === "failed"
              ? "border-muted-foreground/40 text-muted-foreground line-through"
              : "border-gold/60 text-gold";
        const label =
          m.status === "resolved"
            ? "✓"
            : m.status === "failed"
              ? "✗"
              : "…";
        return (
          <span
            key={m.id}
            className={`px-1.5 py-0.5 text-[10px] font-mono tracking-widest border ${tone} flex-shrink-0`}
            title={
              m.last_error ??
              (m.status === "pending"
                ? "Waiting for VOD to archive"
                : m.status)
            }
          >
            {label} {(m.sources?.display_name ?? "?").slice(0, 10)} · {ageSec}s
          </span>
        );
      })}
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
    typeof window !== "undefined" &&
    window.matchMedia?.("(max-width: 640px)").matches;

  if (!sources.length) return null;

  return (
    <section className="bg-panel/40 border border-blood/40 scanlines">
      <div className="px-3 sm:px-4 py-3 border-b border-blood/40 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-display text-lg sm:text-xl tracking-widest text-foreground">
          LIVE WATCH
        </h3>
        <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest">
          <span
            className="px-2 py-0.5 border border-blood/40 text-muted-foreground"
            title="Press MARK MOMENT during a stream — clip is built from the VOD once Kick archives it."
          >
            CAPTURE · VOD-RESOLVED
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
              onUnmute={() =>
                setUnmutedId((cur) => (cur === s.id ? null : s.id))
              }
              forceLight={isMobile}
            />
          ))}
        </div>
      )}

      <MarkedMomentsStrip />

      {offlineSources.length > 0 && (
        <div className="px-3 sm:px-4 py-2 border-t border-blood/20 text-[10px] font-mono text-muted-foreground tracking-widest">
          OFFLINE · {offlineSources.map((s) => s.display_name).join(" · ")}
        </div>
      )}
    </section>
  );
}
