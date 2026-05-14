import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listRecentClips } from "@/lib/clips.functions";

const STATUS_COLOR: Record<string, string> = {
  approved: "bg-emerald-500",
  rejected: "bg-muted-foreground",
  processing: "bg-gold animate-pulse-dot",
  pending: "bg-blood",
  downloaded: "bg-blue-500",
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function RecentGrabsTimeline() {
  const fetchRecent = useServerFn(listRecentClips);
  const { data } = useQuery({
    queryKey: ["recent-clips"],
    queryFn: () => fetchRecent(),
    refetchInterval: 30_000,
  });
  const clips = (data?.clips ?? []) as any[];
  if (!clips.length) return null;

  function jumpTo(id: string) {
    const el = document.getElementById(`clip-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-blood");
      setTimeout(() => el.classList.remove("ring-2", "ring-blood"), 1500);
    }
  }

  return (
    <section className="bg-panel border border-blood/40 px-3 sm:px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display text-sm sm:text-base tracking-widest text-foreground">
          RECENT GRABS · 24H
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground tracking-widest">
          {clips.length} CLIPS
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {clips.map((c) => {
          const cap = (c.hook_caption ?? c.title ?? "—").slice(0, 40);
          const src = (c.sources?.display_name ?? c.sources?.slug ?? "KICK").toUpperCase();
          const statusCls = STATUS_COLOR[c.status] ?? "bg-muted-foreground";
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => jumpTo(c.id)}
              className="flex-shrink-0 w-44 bg-background/60 border border-blood/30 hover:border-blood text-left p-2 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`w-2 h-2 rounded-full ${statusCls}`} />
                <span className="text-[10px] font-mono text-muted-foreground tracking-widest">
                  {fmtTime(c.created_at)}
                </span>
              </div>
              <div className="text-[10px] font-mono text-blood tracking-widest truncate">
                {src}
              </div>
              <div className="text-xs font-mono text-foreground line-clamp-2 mt-0.5 leading-tight">
                {cap}
              </div>
              {c.virality_score ? (
                <div className="text-[10px] font-mono text-gold tracking-widest mt-1">
                  ★ {c.virality_score}
                  {c.chat_spike_ratio ? ` · ${Number(c.chat_spike_ratio).toFixed(1)}x` : ""}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
