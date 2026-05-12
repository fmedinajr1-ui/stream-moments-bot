import type { MockClip } from "@/lib/mock-clips";
import { useRef, useState } from "react";

export function ClipCard({
  clip,
  focused,
  onFocus,
  onApprove,
  onReject,
  onRegenerate,
  batchMode,
  checked,
  onToggleCheck,
}: {
  clip: MockClip;
  focused: boolean;
  onFocus: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  batchMode: boolean;
  checked: boolean;
  onToggleCheck: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(clip.hook_caption);
  const [platforms, setPlatforms] = useState({
    ig: true,
    tiktok: true,
    youtube: true,
  });
  const [showOverlay, setShowOverlay] = useState(false);

  return (
    <article
      onClick={onFocus}
      className={`bg-panel border ${
        focused ? "border-blood shadow-glow-red" : "border-blood/40"
      } scanlines transition-shadow`}
    >
      {/* Video */}
      <div className="relative aspect-[9/16] bg-black overflow-hidden max-h-[480px] mx-auto w-full">
        <video
          ref={videoRef}
          src={clip.video_url}
          muted={muted}
          loop
          playsInline
          onMouseEnter={() => videoRef.current?.play()}
          onMouseLeave={() => {
            videoRef.current?.pause();
            if (videoRef.current) videoRef.current.currentTime = 0;
          }}
          className="w-full h-full object-cover"
        />
        {/* Fight-night overlay preview */}
        {showOverlay && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[8%] left-0 right-0 px-4 text-center">
              <h3 className="font-display text-3xl text-foreground text-glow-red tracking-wider leading-none">
                {caption}
              </h3>
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-blood/90 px-3 py-2 flex items-center justify-between border-t-2 border-gold">
              <span className="font-display text-xs text-foreground tracking-widest">
                {clip.source_streamer}
              </span>
              <span className="font-mono text-xs text-gold">
                @GREATS.CLIPS
              </span>
            </div>
          </div>
        )}
        {/* Top controls */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
          {batchMode && (
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggleCheck}
              onClick={(e) => e.stopPropagation()}
              className="w-5 h-5 accent-blood"
            />
          )}
          <span className="ml-auto bg-black/70 px-2 py-0.5 text-[10px] font-mono text-gold tracking-widest">
            {String(Math.floor(clip.duration_seconds / 60)).padStart(2, "0")}:
            {String(clip.duration_seconds % 60).padStart(2, "0")}
          </span>
        </div>
        {/* Bottom controls */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowOverlay((v) => !v);
            }}
            className="bg-black/70 px-2 py-1 text-[10px] font-mono text-foreground tracking-widest hover:bg-blood"
          >
            {showOverlay ? "RAW" : "PREVIEW"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
              if (videoRef.current) videoRef.current.muted = !muted;
            }}
            className="bg-black/70 px-2 py-1 text-[10px] font-mono text-foreground hover:bg-blood"
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>

      {/* Info panel */}
      <div className="border-t-2 border-blood p-4 space-y-3">
        <div className="text-[10px] font-mono text-muted-foreground tracking-widest">
          {clip.source_streamer} {clip.source_handle} • {clip.date_label} •{" "}
          {clip.stream_timestamp} OF STREAM
        </div>

        <div className="flex items-start gap-4">
          <div>
            <div className="font-mono text-5xl text-gold leading-none">
              {clip.virality_score}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground tracking-widest mt-1">
              VIRALITY
            </div>
          </div>
          <div className="flex-1 space-y-1 pt-1">
            <ScoreLine label="REACTION" v={clip.score_breakdown.reaction} />
            <ScoreLine label="CHAT" v={clip.score_breakdown.chat} />
            <ScoreLine label="AUDIO" v={clip.score_breakdown.audio} />
          </div>
        </div>

        {editing ? (
          <input
            autoFocus
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
            className="w-full bg-background border border-blood font-display text-xl text-foreground px-2 py-1 focus:outline-none focus:shadow-glow-red"
          />
        ) : (
          <h3
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="font-display text-2xl text-foreground tracking-wider leading-tight cursor-text hover:text-blood"
            title="Click to edit"
          >
            {caption}
          </h3>
        )}

        {/* Platforms */}
        <div className="flex gap-2">
          {(["ig", "tiktok", "youtube"] as const).map((p) => (
            <button
              key={p}
              onClick={(e) => {
                e.stopPropagation();
                setPlatforms((pl) => ({ ...pl, [p]: !pl[p] }));
              }}
              className={`px-2 py-1 text-[10px] font-mono tracking-widest border ${
                platforms[p]
                  ? "bg-blood/20 border-blood text-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {p === "youtube" ? "YT-SHORTS" : p.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            className="flex-1 bg-blood text-blood-foreground font-display text-lg tracking-widest py-3 hover:shadow-glow-red transition-shadow"
          >
            APPROVE
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRegenerate();
            }}
            className="bg-background border border-blood text-foreground font-display text-sm tracking-widest px-4 py-3 hover:bg-blood/10"
          >
            REGEN
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
            className="bg-background border border-border text-muted-foreground hover:text-blood hover:border-blood px-3 py-3 text-lg"
            title="Reject"
          >
            💀
          </button>
        </div>
      </div>
    </article>
  );
}

function ScoreLine({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className="w-16 text-muted-foreground tracking-widest">{label}</span>
      <div className="flex-1 h-1 bg-background relative">
        <div
          className="absolute inset-y-0 left-0 bg-blood"
          style={{ width: `${v}%` }}
        />
      </div>
      <span className="w-8 text-right text-gold">{v}</span>
    </div>
  );
}
