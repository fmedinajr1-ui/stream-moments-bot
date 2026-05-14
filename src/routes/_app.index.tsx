import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ClipCard } from "@/components/clip-card";
import type { MockClip } from "@/lib/mock-clips";
import {
  listPendingClips,
  setClipStatus,
  getAgentStatus,
  setAgentPaused,
  listLiveSources,
  manualGrabClip,
} from "@/lib/clips.functions";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/")({
  component: QueuePage,
});

function dbToCard(c: any): MockClip {
  const sb = c.score_breakdown ?? {};
  return {
    id: c.id,
    source_streamer: (c.sources?.display_name ?? c.sources?.slug ?? "KICK").toUpperCase(),
    source_handle: `@${c.sources?.slug ?? "kick"}`,
    stream_timestamp: (c.stream_timestamp ?? "").slice(11, 19) || "—",
    date_label: new Date(c.created_at).toLocaleDateString(),
    virality_score: c.virality_score ?? 0,
    score_breakdown: {
      reaction: sb.reaction ?? 0,
      chat: sb.chat ?? 0,
      audio: sb.audio ?? 0,
    },
    hook_caption: c.hook_caption ?? c.title ?? "UNTITLED",
    duration_seconds: c.duration_seconds ?? 0,
    video_url: c.video_url ?? "",
    thumbnail_url: c.thumbnail_url ?? "",
    chat_spike_ratio: c.chat_spike_ratio ?? null,
    score_rationale: c.score_rationale ?? null,
  };
}

function QueuePage() {
  const fetchClips = useServerFn(listPendingClips);
  const setStatus = useServerFn(setClipStatus);
  const fetchStatus = useServerFn(getAgentStatus);
  const togglePause = useServerFn(setAgentPaused);
  const { data, refetch } = useQuery({
    queryKey: ["pending-clips"],
    queryFn: () => fetchClips(),
    refetchInterval: 30_000,
  });
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["agent-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 15_000,
  });
  const mutate = useMutation({
    mutationFn: (v: { id: string; status: "approved" | "rejected" }) =>
      setStatus({ data: v }),
    onSuccess: () => refetch(),
  });
  const pauseMut = useMutation({
    mutationFn: (paused: boolean) => togglePause({ data: { paused } }),
    onSuccess: (_d, paused) => {
      toast.success(paused ? "AGENT PAUSED" : "AGENT RESUMED");
      refetchStatus();
    },
  });

  const sourceClips = (data?.clips ?? []).map(dbToCard);

  const [streamer, setStreamer] = useState<string>("ALL");
  const [minScore, setMinScore] = useState(0);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);

  const streamers = useMemo(
    () =>
      Array.from(new Set(sourceClips.map((c) => c.source_streamer))).sort(),
    [sourceClips],
  );

  const filtered = useMemo(
    () =>
      sourceClips.filter(
        (c) =>
          (streamer === "ALL" || c.source_streamer === streamer) &&
          c.virality_score >= minScore,
      ),
    [sourceClips, streamer, minScore],
  );

  function approve(id: string) {
    mutate.mutate({ id, status: "approved" });
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }
  function reject(id: string) {
    mutate.mutate({ id, status: "rejected" });
  }
  function regenerate(_id: string) {}

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space" && filtered[focusIdx]) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        approve(filtered[focusIdx].id);
      }
      if (e.code === "ArrowDown") setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
      if (e.code === "ArrowUp") setFocusIdx((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, focusIdx]);

  const lastPollAgo = status?.lastPollAt
    ? Math.max(0, Math.round((Date.now() - +new Date(status.lastPollAt)) / 1000))
    : null;
  const stale = lastPollAgo !== null && lastPollAgo > 180;
  const isPaused = !!status?.isPaused;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b border-blood/40 pb-4">
        <div>
          <h2 className="font-display text-2xl sm:text-3xl md:text-4xl text-foreground tracking-wider">
            QUEUE
          </h2>
          <p className="text-xs font-mono text-muted-foreground mt-1 tracking-widest">
            {filtered.length} CLIPS PENDING REVIEW
            {multiSelect && selected.size > 0 && (
              <> • {selected.size} SELECTED</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setMultiSelect((b) => !b);
              setSelected(new Set());
            }}
            className={`px-4 py-2 text-xs font-mono tracking-widest border ${
              multiSelect
                ? "bg-blood text-blood-foreground border-blood"
                : "border-blood/60 text-foreground hover:bg-blood/10"
            }`}
          >
            {multiSelect ? "EXIT SELECT" : "SELECT MULTIPLE"}
          </button>
          {multiSelect && selected.size > 0 && (
            <button
              onClick={() => {
                selected.forEach(approve);
                setSelected(new Set());
              }}
              className="px-4 py-2 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red"
            >
              APPROVE SELECTED ({selected.size})
            </button>
          )}
        </div>
      </div>

      {/* Auto-monitoring status panel */}
      <div className="bg-panel border border-blood/40 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isPaused
                ? "bg-muted-foreground"
                : stale
                ? "bg-gold animate-pulse-dot"
                : "bg-blood animate-pulse-dot"
            }`}
          />
          <span className="text-xs font-mono tracking-widest text-foreground">
            {isPaused
              ? "AGENT PAUSED"
              : stale
              ? "AUTO-MONITORING · STALLED"
              : "AUTO-MONITORING · ON"}
          </span>
        </div>
        <div className="text-xs font-mono text-muted-foreground tracking-widest">
          LAST POLL:{" "}
          <span className="text-foreground">
            {lastPollAgo === null ? "—" : `${lastPollAgo}s ago`}
          </span>
        </div>
        <div className="text-xs font-mono text-muted-foreground tracking-widest">
          LIVE SOURCES:{" "}
          <span className="text-foreground">
            {status?.liveCount ?? 0}/{status?.monitoredCount ?? 0}
          </span>
        </div>
        <div className="text-xs font-mono text-muted-foreground tracking-widest">
          NEW CLIPS / HR:{" "}
          <span className="text-foreground">{status?.scoredLastHour ?? 0}</span>
        </div>
        <button
          onClick={() => pauseMut.mutate(!isPaused)}
          disabled={pauseMut.isPending}
          className="ml-auto px-3 py-1.5 text-[10px] font-mono tracking-widest border border-blood/60 text-foreground hover:bg-blood/10 disabled:opacity-50"
        >
          {isPaused ? "RESUME AGENT" : "PAUSE AGENT"}
        </button>
      </div>

      <LiveWatchPanel />

      <div className="flex flex-wrap gap-4 items-center bg-panel border border-blood/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-mono text-muted-foreground tracking-widest">
            STREAMER
          </label>
          <select
            value={streamer}
            onChange={(e) => setStreamer(e.target.value)}
            className="bg-background border border-blood/40 text-foreground text-xs font-mono px-2 py-1.5 tracking-wider focus:border-blood focus:outline-none"
          >
            <option value="ALL">ALL</option>
            {streamers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2 flex-1 min-w-full sm:min-w-[280px]">
          <div className="flex items-center justify-between">
            <label className="text-xs font-mono text-muted-foreground tracking-widest">
              MIN SCORE
            </label>
            <span className="text-gold font-mono text-base tabular-nums">
              {minScore === 0 ? "ALL" : `≥ ${minScore}`}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { label: "ALL", value: 0 },
              { label: "60+", value: 60 },
              { label: "75+", value: 75 },
              { label: "90+", value: 90 },
            ].map((p) => {
              const active = minScore === p.value;
              return (
                <button
                  key={p.label}
                  onClick={() => setMinScore(p.value)}
                  className={`py-2 text-xs font-mono tracking-widest border transition-colors ${
                    active
                      ? "bg-blood text-blood-foreground border-blood"
                      : "border-blood/40 text-foreground hover:bg-blood/10"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-full accent-blood h-3 touch-manipulation"
          />
        </div>

        <div className="hidden md:block text-xs font-mono text-muted-foreground tracking-widest">
          PRESS <kbd className="text-blood">SPACE</kbd> TO APPROVE FOCUSED
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <h3 className="font-display text-3xl sm:text-5xl md:text-6xl text-foreground tracking-widest">
            NO CLIPS PENDING
          </h3>
          <span className="mt-6 w-3 h-3 rounded-full bg-blood animate-pulse-dot" />
          <p className="mt-6 text-xs font-mono text-muted-foreground tracking-widest max-w-md">
            AGENT IS WATCHING YOUR HANDLES 24/7. NEW CLIPS APPEAR HERE WITHIN
            ~60 SECONDS OF KICK GENERATING THEM.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filtered.map((clip, i) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              focused={i === focusIdx}
              onFocus={() => setFocusIdx(i)}
              onApprove={() => approve(clip.id)}
              onReject={() => reject(clip.id)}
              onRegenerate={() => regenerate(clip.id)}
              batchMode={multiSelect}
              checked={selected.has(clip.id)}
              onToggleCheck={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  n.has(clip.id) ? n.delete(clip.id) : n.add(clip.id);
                  return n;
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveWatchPanel() {
  const fetchLive = useServerFn(listLiveSources);
  const grab = useServerFn(manualGrabClip);
  const { data } = useQuery({
    queryKey: ["live-sources"],
    queryFn: () => fetchLive(),
    refetchInterval: 30_000,
  });
  const sources = (data?.sources ?? []) as Array<{
    id: string;
    slug: string;
    display_name: string;
    last_known_live: boolean;
    avg_viewers: number | null;
  }>;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [duration, setDuration] = useState(30);
  const [lastGrab, setLastGrab] = useState<{ at: number; caption: string } | null>(null);

  // Default to first live source, else first source
  useEffect(() => {
    if (selectedId || !sources.length) return;
    const live = sources.find((s) => s.last_known_live);
    setSelectedId((live ?? sources[0]).id);
  }, [sources, selectedId]);

  const selected = sources.find((s) => s.id === selectedId) ?? null;

  const grabMut = useMutation({
    mutationFn: () =>
      grab({
        data: {
          sourceId: selected!.id,
          caption: caption.trim() || undefined,
          durationSec: duration,
        },
      }),
    onSuccess: (res: any) => {
      if (res?.ok) {
        toast.success("CLIP QUEUED — RENDERING");
        setLastGrab({
          at: Date.now(),
          caption: caption.trim() || `${selected!.display_name} grab`,
        });
        setCaption("");
      } else {
        toast.error(res?.error ?? "Grab failed");
      }
    },
    onError: (err: any) => toast.error(err?.message ?? "Grab failed"),
  });

  if (!sources.length) return null;

  return (
    <section className="bg-panel border border-blood/40 scanlines">
      <div className="px-4 py-3 border-b border-blood/40 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-lg sm:text-xl tracking-widest text-foreground">
            LIVE WATCH
          </h3>
          {selected && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono tracking-widest">
              <span
                className={`w-2 h-2 rounded-full ${
                  selected.last_known_live
                    ? "bg-blood animate-pulse-dot"
                    : "bg-muted-foreground"
                }`}
              />
              <span className={selected.last_known_live ? "text-blood" : "text-muted-foreground"}>
                {selected.last_known_live ? "LIVE" : "OFFLINE"}
              </span>
              {selected.avg_viewers ? (
                <span className="text-muted-foreground">
                  • {selected.avg_viewers.toLocaleString()} viewers
                </span>
              ) : null}
            </span>
          )}
        </div>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          className="bg-background border border-blood/40 text-foreground text-xs font-mono px-2 py-1.5 tracking-wider focus:border-blood focus:outline-none"
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.last_known_live ? "● " : "○ "}
              {s.display_name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-0">
        <div className="aspect-video bg-black border-r border-blood/20">
          {selected ? (
            <iframe
              key={selected.slug}
              src={`https://player.kick.com/${selected.slug}?muted=true&autoplay=true`}
              allow="autoplay; fullscreen"
              allowFullScreen
              className="w-full h-full"
              title={`${selected.display_name} live`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center font-display text-2xl text-blood/40">
              SELECT A STREAMER
            </div>
          )}
        </div>

        <div className="p-4 flex flex-col gap-3">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">
            CAPTION (OPTIONAL)
          </label>
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={80}
            placeholder="e.g. NEAR-MISS ON HIGHWAY"
            className="bg-background border border-blood/40 text-foreground text-xs font-mono px-2 py-2 tracking-wider focus:border-blood focus:outline-none"
          />

          <label className="text-[10px] font-mono tracking-widest text-muted-foreground mt-1">
            DURATION
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {[15, 30, 45].map((d) => {
              const active = duration === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={`py-2 text-xs font-mono tracking-widest border transition-colors ${
                    active
                      ? "bg-blood text-blood-foreground border-blood"
                      : "border-blood/40 text-foreground hover:bg-blood/10"
                  }`}
                >
                  {d}s
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => grabMut.mutate()}
            disabled={!selected || grabMut.isPending}
            className="mt-auto py-3 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {grabMut.isPending ? "GRABBING…" : "▶ GRAB CLIP NOW"}
          </button>

          {lastGrab && (
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest line-clamp-2">
              LAST GRAB: {Math.max(1, Math.round((Date.now() - lastGrab.at) / 1000))}s ago
              <br />
              <span className="text-foreground">{lastGrab.caption}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
