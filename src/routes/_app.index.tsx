import { createFileRoute } from "@tanstack/react-router";
import { ClipCard } from "@/components/clip-card";
import { MOCK_CLIPS } from "@/lib/mock-clips";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/_app/")({
  component: QueuePage,
});

function QueuePage() {
  const [streamer, setStreamer] = useState<string>("ALL");
  const [minScore, setMinScore] = useState(0);
  const [clips, setClips] = useState(MOCK_CLIPS);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);

  const filtered = useMemo(
    () =>
      clips.filter(
        (c) =>
          (streamer === "ALL" || c.source_streamer === streamer) &&
          c.virality_score >= minScore,
      ),
    [clips, streamer, minScore],
  );

  function approve(id: string) {
    setClips((cs) => cs.filter((c) => c.id !== id));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }
  function reject(id: string) {
    setClips((cs) => cs.filter((c) => c.id !== id));
  }
  function regenerate(id: string) {
    setClips((cs) =>
      cs.map((c) =>
        c.id === id
          ? { ...c, hook_caption: c.hook_caption + " (V2)" }
          : c,
      ),
    );
  }

  // Spacebar approves focused card
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
      {/* Header */}
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

      {/* Filter bar */}
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
            <option value="DEEN">DEEN</option>
            <option value="RAMPAGE">RAMPAGE</option>
            <option value="AB">AB</option>
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

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32">
          <h3 className="font-display text-6xl text-foreground tracking-widest">
            NO CLIPS PENDING
          </h3>
          <span className="mt-6 w-3 h-3 rounded-full bg-blood animate-pulse-dot" />
          <p className="mt-6 text-xs font-mono text-muted-foreground tracking-widest">
            AGENT IS WATCHING. CHECK BACK WHEN STREAMS GO LIVE.
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
