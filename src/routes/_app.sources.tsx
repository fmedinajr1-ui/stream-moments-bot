import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  addSource,
  deleteSource,
  runPollNow,
} from "@/lib/clips.functions";
import {
  getLatestChatVelocity,
  updateSourceSensitivity,
} from "@/lib/agent.functions";

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
  last_polled_at: string | null;
  spike_sensitivity: number | null;
};

function timeAgo(iso: string | null) {
  if (!iso) return "NEVER";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s AGO`;
  if (s < 3600) return `${Math.round(s / 60)}m AGO`;
  if (s < 86400) return `${Math.round(s / 3600)}h AGO`;
  return `${Math.round(s / 86400)}d AGO`;
}

function SourcesPage() {
  const add = useServerFn(addSource);
  const del = useServerFn(deleteSource);
  const poll = useServerFn(runPollNow);
  const fetchVel = useServerFn(getLatestChatVelocity);
  const setSens = useServerFn(updateSourceSensitivity);

  const { data: vel } = useQuery({
    queryKey: ["chat-velocity"],
    queryFn: () => fetchVel(),
    refetchInterval: 15_000,
  });
  const sensMut = useMutation({
    mutationFn: (v: { id: string; spike_sensitivity: number }) =>
      setSens({ data: v }),
    onSuccess: () => refetch(),
  });

  const { data, refetch } = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Source[]) ?? [];
    },
    refetchInterval: 15_000,
  });
  const sources = data ?? [];

  const [showAdd, setShowAdd] = useState(false);
  const [slug, setSlug] = useState("");
  const [interval, setInterval] = useState(15);

  const addMut = useMutation({
    mutationFn: (v: { slug: string; poll_interval_min: number }) =>
      add({ data: v }),
    onSuccess: () => {
      toast.success(`Added ${slug.toUpperCase()}`);
      setShowAdd(false);
      setSlug("");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to add source"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => refetch(),
  });
  const pollMut = useMutation({
    mutationFn: (sourceId?: string) =>
      poll({ data: sourceId ? { sourceId } : {} }),
    onSuccess: (s: any) => {
      toast.success(`POLLED ${s.polled} • ${s.new_clips} NEW CLIPS`);
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Poll failed"),
  });

  async function toggleMonitor(s: Source) {
    await supabase
      .from("sources")
      .update({ is_monitoring: !s.is_monitoring })
      .eq("id", s.id);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b border-blood/40 pb-4">
        <div>
          <h2 className="font-display text-2xl sm:text-3xl md:text-4xl tracking-wider">MONITORED SOURCES</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1 tracking-widest">
            {sources.length} CHANNELS • {sources.filter((s) => s.last_known_live).length} LIVE
          </p>
        </div>
        <button
          onClick={() => pollMut.mutate(undefined)}
          disabled={pollMut.isPending}
          className="px-4 py-2 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50"
        >
          {pollMut.isPending ? "POLLING…" : "RUN BATCH NOW"}
        </button>
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
              <Row label="LAST POLL" v={timeAgo(s.last_polled_at)} />
              <Row
                label="CHAT MSGS/SEC"
                v={
                  vel?.latest?.[s.id]
                    ? `${Number(vel.latest[s.id].msgs_per_sec).toFixed(1)} (${Number(vel.latest[s.id].spike_ratio).toFixed(1)}x)${vel.latest[s.id].is_spike ? " 🔥" : ""}`
                    : "—"
                }
              />
            </dl>
            <div className="mt-3">
              <div className="flex justify-between text-[10px] font-mono mb-1">
                <span className="text-muted-foreground tracking-widest">SPIKE SENSITIVITY</span>
                <span className="text-gold">{(s.spike_sensitivity ?? 2.0).toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={1.5}
                max={4}
                step={0.1}
                value={s.spike_sensitivity ?? 2.0}
                onChange={(e) =>
                  sensMut.mutate({
                    id: s.id,
                    spike_sensitivity: Number(e.target.value),
                  })
                }
                className="w-full accent-blood"
              />
            </div>
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
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => pollMut.mutate(s.id)}
                disabled={pollMut.isPending}
                className="flex-1 text-[10px] font-mono tracking-widest border border-blood/60 px-2 py-1.5 hover:bg-blood/10 disabled:opacity-50"
              >
                POLL NOW
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${s.display_name}?`)) delMut.mutate(s.id);
                }}
                className="text-[10px] font-mono tracking-widest border border-border px-2 py-1.5 text-muted-foreground hover:text-blood hover:border-blood"
              >
                DEL
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() => setShowAdd(true)}
          className="border-2 border-dashed border-blood/60 bg-background text-blood font-display text-2xl tracking-widest hover:bg-blood/10 min-h-[200px]"
        >
          + ADD SOURCE
        </button>
      </div>

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setShowAdd(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-panel border border-blood p-6 w-[420px] scanlines"
          >
            <h3 className="font-display text-3xl tracking-wider mb-4">ADD KICK SOURCE</h3>
            <label className="text-xs font-mono text-muted-foreground tracking-widest">
              KICK SLUG
            </label>
            <input
              autoFocus
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
              }
              placeholder="e.g. xqc"
              className="mt-1 w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm text-foreground focus:border-blood focus:outline-none"
            />
            <label className="text-xs font-mono text-muted-foreground tracking-widest mt-4 block">
              POLL INTERVAL (MIN)
            </label>
            <input
              type="number"
              min={1}
              max={120}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value) || 15)}
              className="mt-1 w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm text-foreground focus:border-blood focus:outline-none"
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-xs font-mono tracking-widest border border-border text-muted-foreground"
              >
                CANCEL
              </button>
              <button
                disabled={!slug || addMut.isPending}
                onClick={() =>
                  addMut.mutate({ slug, poll_interval_min: interval })
                }
                className="px-4 py-2 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50"
              >
                {addMut.isPending ? "VERIFYING…" : "ADD"}
              </button>
            </div>
          </div>
        </div>
      )}
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
