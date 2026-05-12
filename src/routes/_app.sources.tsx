import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/sources")({
  component: SourcesPage,
});

type Source = {
  id: string;
  slug: string;
  display_name: string;
  is_monitoring: boolean;
  poll_interval_min: number;
  follower_count: number | null;
  avg_viewers: number | null;
  last_known_live: boolean;
};

function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);

  useEffect(() => {
    supabase
      .from("sources")
      .select("*")
      .then(({ data }) => setSources((data as Source[]) ?? []));
  }, []);

  async function toggleMonitor(s: Source) {
    await supabase
      .from("sources")
      .update({ is_monitoring: !s.is_monitoring })
      .eq("id", s.id);
    setSources((src) =>
      src.map((x) => (x.id === s.id ? { ...x, is_monitoring: !x.is_monitoring } : x)),
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-blood/40 pb-4">
        <h2 className="font-display text-4xl tracking-wider">MONITORED SOURCES</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sources.map((s) => (
          <div key={s.id} className="bg-panel border border-blood/60 p-5 scanlines">
            <div className="flex items-start justify-between">
              <h3 className="font-display text-3xl text-foreground tracking-wider">
                {s.display_name}
              </h3>
              {s.last_known_live && (
                <span className="flex items-center gap-1 text-[10px] font-mono text-blood">
                  <span className="w-1.5 h-1.5 rounded-full bg-blood animate-pulse-dot" />
                  LIVE
                </span>
              )}
            </div>
            <div className="text-xs font-mono text-muted-foreground mt-1">
              @{s.slug}
            </div>
            <dl className="mt-4 space-y-1 text-xs font-mono">
              <Row label="FOLLOWERS" v={s.follower_count?.toLocaleString() ?? "—"} />
              <Row label="AVG VIEWERS" v={s.avg_viewers?.toLocaleString() ?? "—"} />
              <Row label="LAST STREAM" v={s.last_known_live ? "NOW" : "—"} />
            </dl>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[10px] font-mono text-muted-foreground tracking-widest">
                MONITORING
              </span>
              <button
                onClick={() => toggleMonitor(s)}
                className={`px-3 py-1 text-[10px] font-mono tracking-widest border ${
                  s.is_monitoring
                    ? "bg-blood text-foreground border-blood"
                    : "bg-background text-muted-foreground border-border"
                }`}
              >
                {s.is_monitoring ? "ON" : "OFF"}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] font-mono">
              <span className="text-muted-foreground tracking-widest">POLL EVERY</span>
              <span className="text-gold">{s.poll_interval_min} MIN</span>
            </div>
          </div>
        ))}
        <button className="border-2 border-dashed border-blood/60 bg-background text-blood font-display text-2xl tracking-widest hover:bg-blood/10 min-h-[200px]">
          + ADD SOURCE
        </button>
      </div>
    </div>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground tracking-widest">{label}</span>
      <span className="text-gold">{v}</span>
    </div>
  );
}
