import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listLiveChatActivity } from "@/lib/clips.functions";

type VRow = {
  created_at: string;
  msgs_per_sec: number;
  spike_ratio: number | null;
  is_spike: boolean;
  clip_id: string | null;
  sample_messages: any;
};

function Sparkline({ series }: { series: VRow[] }) {
  if (!series.length) {
    return (
      <div className="text-[10px] font-mono text-muted-foreground/60 tracking-widest">
        NO CHAT DATA YET
      </div>
    );
  }
  const W = 320;
  const H = 36;
  const max = Math.max(1, ...series.map((r) => Number(r.msgs_per_sec)));
  const t0 = +new Date(series[0].created_at);
  const tN = +new Date(series[series.length - 1].created_at);
  const span = Math.max(1, tN - t0);
  const pts = series.map((r) => {
    const x = ((+new Date(r.created_at) - t0) / span) * W;
    const y = H - (Number(r.msgs_per_sec) / max) * (H - 4) - 2;
    return [x, y, r] as const;
  });
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-9 overflow-visible">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1} className="text-foreground/60" />
      {pts.map(([x, y, r], i) =>
        r.is_spike ? (
          <g key={i}>
            <circle cx={x} cy={y} r={3} className="fill-blood">
              <title>
                {new Date(r.created_at).toLocaleTimeString()} · {Number(r.spike_ratio ?? 0).toFixed(1)}x · {Number(r.msgs_per_sec).toFixed(1)} msg/s
              </title>
            </circle>
          </g>
        ) : null,
      )}
    </svg>
  );
}

export function SpikeTrackerPanel() {
  const fetchActivity = useServerFn(listLiveChatActivity);
  const [trackAll, setTrackAll] = useState(true);
  const { data } = useQuery({
    queryKey: ["live-chat-activity"],
    queryFn: () => fetchActivity(),
    refetchInterval: trackAll ? 10_000 : false,
  });
  const sources = (data?.sources ?? []) as Array<any>;
  if (!sources.length) return null;

  const totalSpikes = sources.reduce(
    (a, s) => a + (s.series ?? []).filter((r: VRow) => r.is_spike).length,
    0,
  );

  return (
    <section className="bg-panel border border-blood/40 px-3 sm:px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-display text-sm sm:text-base tracking-widest text-foreground">
            SPIKE TRACKER · 30M
          </h3>
          <span className="text-[10px] font-mono text-muted-foreground tracking-widest">
            {totalSpikes} SPIKE{totalSpikes === 1 ? "" : "S"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setTrackAll((v) => !v)}
          className={`px-3 py-1.5 text-[10px] font-mono tracking-widest border min-h-[32px] ${
            trackAll ? "bg-blood text-blood-foreground border-blood" : "border-blood/40 text-foreground hover:bg-blood/10"
          }`}
        >
          {trackAll ? "● TRACKING" : "○ PAUSED"}
        </button>
      </div>
      <div className="space-y-2">
        {sources.map((s) => {
          const latest = s.latest as VRow | null;
          const ratio = Number(latest?.spike_ratio ?? 0);
          const ratioColor =
            ratio >= 2
              ? "text-blood animate-pulse-dot"
              : ratio >= 1.2
                ? "text-gold"
                : "text-muted-foreground";
          return (
            <div
              key={s.id}
              className="grid grid-cols-[120px_1fr_72px] gap-3 items-center border-t border-blood/20 pt-2 first:border-t-0 first:pt-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full ${s.last_known_live ? "bg-blood animate-pulse-dot" : "bg-muted-foreground"}`} />
                <span className="text-xs font-mono tracking-widest text-foreground truncate">
                  {s.display_name}
                </span>
              </div>
              <Sparkline series={(s.series ?? []) as VRow[]} />
              <div className={`text-right text-xs font-mono tracking-widest ${ratioColor}`}>
                {latest ? `${Number(latest.msgs_per_sec).toFixed(1)}/s` : "—"}
                <div className="text-[10px] text-muted-foreground">
                  {latest?.spike_ratio ? `${ratio.toFixed(1)}x` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
