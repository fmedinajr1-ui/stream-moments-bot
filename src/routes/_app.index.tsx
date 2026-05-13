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
  const poll = useServerFn(runPollNow);
  const { data, refetch } = useQuery({
    queryKey: ["pending-clips"],
    queryFn: () => fetchClips(),
    refetchInterval: 30_000,
  });
  const mutate = useMutation({
    mutationFn: (v: { id: string; status: "approved" | "rejected" }) =>
      setStatus({ data: v }),
    onSuccess: () => refetch(),
  });
  const batchPoll = useMutation({
    mutationFn: () => poll({ data: {} }),
    onSuccess: (s: any) => {
      toast.success(
        `BATCH COMPLETE — ${s.polled} sources polled, ${s.new_clips} new clips`,
      );
      refetch();
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Batch failed. Check logs."),
  });

  const sourceClips = (data?.clips ?? []).map(dbToCard);

  const [streamer, setStreamer] = useState<string>("ALL");
  const [minScore, setMinScore] = useState(0);
  const [batchMode, setBatchMode] = useState(false);
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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b border-blood/40 pb-4">
        <div>
          <h2 className="font-display text-4xl text-foreground tracking-wider">
            QUEUE
          </h2>
          <p className="text-xs font-mono text-muted-foreground mt-1 tracking-widest">
            {filtered.length} CLIPS PENDING REVIEW
            {batchMode && selected.size > 0 && (
              <> • {selected.size} SELECTED</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => batchPoll.mutate()}
            disabled={batchPoll.isPending}
            className="px-4 py-2 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50"
          >
            {batchPoll.isPending ? "POLLING…" : "RUN BATCH NOW"}
          </button>
          <button
            onClick={() => {
              setBatchMode((b) => !b);
              setSelected(new Set());
            }}
            className={`px-4 py-2 text-xs font-mono tracking-widest border ${
              batchMode
                ? "bg-blood text-blood-foreground border-blood"
                : "border-blood/60 text-foreground hover:bg-blood/10"
            }`}
          >
            {batchMode ? "EXIT BATCH" : "BATCH MODE"}
          </button>
          {batchMode && selected.size > 0 && (
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

        <div className="flex items-center gap-3 flex-1 min-w-[260px]">
          <label className="text-xs font-mono text-muted-foreground tracking-widest">
            SCORE ≥
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="flex-1 accent-blood"
          />
          <span className="text-gold font-mono text-sm w-10 text-right">
            {minScore}
          </span>
        </div>

        <div className="text-xs font-mono text-muted-foreground tracking-widest">
          PRESS <kbd className="text-blood">SPACE</kbd> TO APPROVE FOCUSED
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <h3 className="font-display text-6xl text-foreground tracking-widest">
            NO CLIPS PENDING
          </h3>
          <span className="mt-6 w-3 h-3 rounded-full bg-blood animate-pulse-dot" />
          <p className="mt-6 text-xs font-mono text-muted-foreground tracking-widest max-w-md">
            HIT <span className="text-blood">RUN BATCH NOW</span> TO SCAN KICK
            FOR FRESH CLIPS, OR WAIT FOR THE 5-MIN AUTO POLL.
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
              batchMode={batchMode}
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
