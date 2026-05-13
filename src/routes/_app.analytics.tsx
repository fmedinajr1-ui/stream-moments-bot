import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAnalytics, getCronHealth } from "@/lib/agent.functions";

export const Route = createFileRoute("/_app/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const fetchA = useServerFn(getAnalytics);
  const fetchCron = useServerFn(getCronHealth);
  const { data } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => fetchA(),
    refetchInterval: 60_000,
  });
  const { data: cron } = useQuery({
    queryKey: ["cron-health"],
    queryFn: () => fetchCron(),
    refetchInterval: 30_000,
  });
  const a = data ?? {
    total: 0,
    approved: 0,
    rejected: 0,
    pending: 0,
    avgScore: 0,
    topSources: [] as [string, number][],
    spikeApprovalRate: 0,
    spikeMatched: 0,
  };

  const max = Math.max(1, ...a.topSources.map(([, v]) => v));

  return (
    <div className="space-y-6">
      <div className="border-b border-blood/40 pb-4">
        <h2 className="font-display text-4xl tracking-wider">ANALYTICS</h2>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-widest">
          LAST 7 DAYS
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="TOTAL" value={a.total} />
        <Stat label="APPROVED" value={a.approved} accent />
        <Stat label="REJECTED" value={a.rejected} />
        <Stat label="PENDING" value={a.pending} />
        <Stat label="AVG SCORE" value={a.avgScore} accent />
      </div>

      <div className="bg-panel border border-gold/40 p-5 scanlines">
        <h3 className="font-display text-xl tracking-widest mb-2">
          🔥 CHAT SPIKE LEARNING
        </h3>
        <p className="text-xs font-mono text-muted-foreground mb-3">
          {a.spikeMatched} of {a.approved} approved clips landed during a chat spike
          ({a.spikeApprovalRate}%). Higher = the agent's spike detection matches your taste.
        </p>
        <div className="h-2 bg-background border border-gold/40">
          <div
            className="h-full bg-gold"
            style={{ width: `${a.spikeApprovalRate}%` }}
          />
        </div>
      </div>

      <div className="bg-panel border border-blood/40 p-5 scanlines">
        <h3 className="font-display text-xl tracking-widest mb-2">
          CRON HEALTH — LAST 20 RUNS
        </h3>
        <p className="text-xs font-mono text-muted-foreground mb-3">
          Auto-poll runs every minute. Each bar = one run. Gold = had errors.
        </p>
        {!cron?.runs?.length ? (
          <div className="text-xs font-mono text-muted-foreground tracking-widest">
            NO RUNS YET — waiting for next cron tick…
          </div>
        ) : (
          <div className="flex items-end gap-1 h-16">
            {cron.runs.slice().reverse().map((r, i) => {
              const h = Math.max(8, Math.min(64, 8 + r.new_clips * 12));
              const errored = r.errors > 0;
              return (
                <div
                  key={i}
                  title={`${new Date(r.at).toLocaleTimeString()} • ${r.polled} sources • ${r.new_clips} new • ${r.errors} errors`}
                  className={`flex-1 ${errored ? "bg-gold" : "bg-blood"} opacity-80 hover:opacity-100`}
                  style={{ height: `${h}px` }}
                />
              );
            })}
          </div>
        )}
        <div className="mt-3 text-[10px] font-mono text-muted-foreground tracking-widest">
          LAST RUN:{" "}
          {cron?.runs?.[0]
            ? new Date(cron.runs[0].at).toLocaleTimeString()
            : "—"}
        </div>
      </div>

      <div className="bg-panel border border-blood/40 p-5 scanlines">
        <h3 className="font-display text-xl tracking-widest mb-4">
          TOP SOURCES (APPROVED)
        </h3>
        {a.topSources.length === 0 ? (
          <div className="text-xs font-mono text-muted-foreground tracking-widest">
            NO DATA YET
          </div>
        ) : (
          <div className="space-y-2">
            {a.topSources.map(([name, v]) => (
              <div key={name} className="flex items-center gap-3">
                <span className="w-24 text-xs font-mono tracking-widest">
                  {name}
                </span>
                <div className="flex-1 bg-background h-6 border border-blood/30">
                  <div
                    className="h-full bg-blood"
                    style={{ width: `${(v / max) * 100}%` }}
                  />
                </div>
                <span className="text-gold font-mono text-sm w-8 text-right">
                  {v}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="bg-panel border border-blood/40 p-5 scanlines">
      <div className="text-[10px] font-mono text-muted-foreground tracking-widest">
        {label}
      </div>
      <div
        className={`font-display text-5xl tracking-wider mt-2 ${
          accent ? "text-blood" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
