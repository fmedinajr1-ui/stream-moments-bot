import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAuditLog } from "@/lib/agent.functions";

export const Route = createFileRoute("/_app/pipeline")({
  component: PipelinePage,
});

const ACTION_COLOR: Record<string, string> = {
  poll_kick: "text-gold",
  approved: "text-foreground",
  rejected: "text-muted-foreground",
  downloaded: "text-blood",
};

function PipelinePage() {
  const fetchLog = useServerFn(getAuditLog);
  const { data } = useQuery({
    queryKey: ["audit-log"],
    queryFn: () => fetchLog(),
    refetchInterval: 15_000,
  });
  const entries = data?.entries ?? [];

  return (
    <div className="space-y-6">
      <div className="border-b border-blood/40 pb-4">
        <h2 className="font-display text-2xl sm:text-3xl md:text-4xl tracking-wider">PIPELINE</h2>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-widest">
          REAL-TIME AGENT ACTIVITY • LAST {entries.length} EVENTS
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-32 font-mono text-xs text-muted-foreground tracking-widest">
          NO ACTIVITY YET. RUN A BATCH FROM THE QUEUE.
        </div>
      ) : (
        <div className="bg-panel border border-blood/40 scanlines divide-y divide-blood/20">
          {entries.map((e: any) => (
            <div
              key={e.id}
              className="px-4 py-3 grid grid-cols-[120px_140px_1fr] gap-4 items-start text-xs font-mono"
            >
              <span className="text-muted-foreground tracking-widest">
                {new Date(e.created_at).toLocaleTimeString()}
              </span>
              <span
                className={`uppercase tracking-widest ${
                  ACTION_COLOR[e.action] ?? "text-foreground"
                }`}
              >
                {e.action}
              </span>
              <span className="text-muted-foreground break-all">
                {summarize(e)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarize(e: any) {
  if (e.action === "poll_kick") {
    const d = e.details ?? {};
    return `polled ${d.polled ?? 0} sources • ${d.new_clips ?? 0} new clips`;
  }
  if (e.clip_id) return `clip ${String(e.clip_id).slice(0, 8)}…`;
  return JSON.stringify(e.details ?? {});
}
