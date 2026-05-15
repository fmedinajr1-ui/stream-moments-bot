import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getAgentSettings,
  updateAgentSettings,
  getLatestTrainingExportUrl,
} from "@/lib/agent.functions";
import {
  getSpikeSettings,
  updateSpikeSettings,
  testAutoGrab,
} from "@/lib/clips.functions";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const fetchSettings = useServerFn(getAgentSettings);
  const update = useServerFn(updateAgentSettings);
  const { data, refetch } = useQuery({
    queryKey: ["agent-settings"],
    queryFn: () => fetchSettings(),
  });
  const s = data?.settings;

  const [threshold, setThreshold] = useState(70);
  const [maxPerDay, setMaxPerDay] = useState(8);
  const [paused, setPaused] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draftKw, setDraftKw] = useState("");

  useEffect(() => {
    if (!s) return;
    setThreshold(s.min_score_threshold);
    setMaxPerDay(s.max_clips_per_day);
    setPaused(s.is_paused);
    setKeywords(s.blocked_keywords ?? []);
  }, [s]);

  const save = useMutation({
    mutationFn: () =>
      update({
        data: {
          id: s!.id,
          min_score_threshold: threshold,
          max_clips_per_day: maxPerDay,
          is_paused: paused,
          blocked_keywords: keywords,
        },
      }),
    onSuccess: () => {
      toast.success("SETTINGS SAVED");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  if (!s) {
    return (
      <div className="text-xs font-mono text-muted-foreground">LOADING…</div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="border-b border-blood/40 pb-4">
        <h2 className="font-display text-2xl sm:text-3xl md:text-4xl tracking-wider">AGENT SETTINGS</h2>
        <p className="text-xs font-mono text-muted-foreground mt-1 tracking-widest">
          CONTROL HOW THE CLIPPER SCORES AND ADMITS NEW CLIPS.
        </p>
      </div>

      <Section title="STATUS">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-xl tracking-wider">
              {paused ? "PAUSED" : "ACTIVE"}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground tracking-widest">
              {paused
                ? "POLLER WILL SKIP ALL SOURCES"
                : "POLLER RUNNING ON SCHEDULE"}
            </div>
          </div>
          <button
            onClick={() => setPaused((p) => !p)}
            className={`px-4 py-2 text-xs font-mono tracking-widest border ${
              paused
                ? "bg-background border-border text-muted-foreground"
                : "bg-blood text-blood-foreground border-blood"
            }`}
          >
            {paused ? "RESUME" : "PAUSE"}
          </button>
        </div>
      </Section>

      <Section title="MIN SCORE THRESHOLD">
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={50}
            max={95}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1 accent-blood"
          />
          <span className="text-gold font-mono text-2xl w-14 text-right">
            {threshold}
          </span>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground tracking-widest mt-2">
          CLIPS BELOW THIS SCORE NEVER ENTER THE QUEUE.
        </p>
      </Section>

      <Section title="MAX CLIPS PER DAY">
        <input
          type="number"
          min={1}
          max={100}
          value={maxPerDay}
          onChange={(e) => setMaxPerDay(Number(e.target.value) || 1)}
          className="w-32 bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
        />
      </Section>

      <Section title="BLOCKED KEYWORDS">
        <div className="flex flex-wrap gap-2 mb-3">
          {keywords.map((kw, i) => (
            <span
              key={i}
              className="text-[10px] font-mono tracking-widest bg-blood/20 border border-blood/40 px-2 py-1"
            >
              {kw}
              <button
                className="ml-2 text-blood"
                onClick={() =>
                  setKeywords((k) => k.filter((_, idx) => idx !== i))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={draftKw}
            onChange={(e) => setDraftKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draftKw.trim()) {
                setKeywords((k) => [...k, draftKw.trim()]);
                setDraftKw("");
              }
            }}
            placeholder="add keyword + enter"
            className="flex-1 bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
          />
        </div>
      </Section>

      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="px-6 py-3 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50"
      >
        {save.isPending ? "SAVING…" : "SAVE SETTINGS"}
      </button>

      <AutoGrabPanel />

      <TrainingExport />
    </div>
  );
}

function AutoGrabPanel() {
  const fetchSpike = useServerFn(getSpikeSettings);
  const updateSpike = useServerFn(updateSpikeSettings);
  const test = useServerFn(testAutoGrab);
  const { data, refetch } = useQuery({
    queryKey: ["spike-settings"],
    queryFn: () => fetchSpike(),
  });
  const s = (data as any)?.settings;
  const [windowSec, setWindowSec] = useState(60);
  const [minMps, setMinMps] = useState(0.5);
  const [cooldown, setCooldown] = useState(180);
  const [enabled, setEnabled] = useState(true);
  const [autoMark, setAutoMark] = useState(true);

  useEffect(() => {
    if (!s) return;
    setWindowSec(s.spike_window_sec);
    setMinMps(Number(s.spike_min_mps));
    setCooldown(s.auto_grab_cooldown_sec);
    setEnabled(s.auto_grab_enabled);
    setAutoMark(s.auto_mark_on_spike !== false);
  }, [s]);

  const save = useMutation({
    mutationFn: () =>
      updateSpike({
        data: {
          spike_window_sec: windowSec,
          spike_min_mps: minMps,
          auto_grab_cooldown_sec: cooldown,
          auto_grab_enabled: enabled,
          auto_mark_on_spike: autoMark,
        },
      }),
    onSuccess: () => {
      toast.success("AUTO-GRAB SETTINGS SAVED");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const testMut = useMutation({
    mutationFn: () => test({ data: {} }),
    onSuccess: (res: any) => {
      if (res?.ok) toast.success(`TEST CLIP QUEUED · ${res.clipId?.slice(0, 8)}`);
      else toast.error(res?.error ?? "Test failed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Test failed"),
  });

  if (!s) return null;

  return (
    <div className="bg-panel border border-blood/40 p-5 scanlines mt-6">
      <h3 className="font-display text-xl tracking-widest text-foreground mb-3">
        AUTO-GRAB ON CHAT SPIKE
      </h3>
      <p className="text-xs font-mono text-muted-foreground mb-4">
        Automatically clip a stream when its chat msgs/sec exceeds the per-source
        sensitivity (default 2.0×) within the look-back window AND clears the floor.
        Cooldown prevents back-to-back clips on the same source.
      </p>

      <div className="flex items-center justify-between mb-4">
        <div className="font-display text-base tracking-wider">
          {enabled ? "● ARMED" : "○ DISABLED"}
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`px-4 py-2 text-xs font-mono tracking-widest border ${
            enabled
              ? "bg-blood text-blood-foreground border-blood"
              : "bg-background border-border text-muted-foreground"
          }`}
        >
          {enabled ? "DISABLE" : "ARM"}
        </button>
      </div>

      <div className="flex items-center justify-between mb-4 pt-3 border-t border-blood/20">
        <div>
          <div className="font-display text-base tracking-wider">
            {autoMark ? "● AUTO-MARK ON" : "○ AUTO-MARK OFF"}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground mt-1 max-w-md">
            On spike, drop a marked moment. Resolver pulls the clip from VOD when the stream ends. No OBS needed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAutoMark((v) => !v)}
          className={`px-4 py-2 text-xs font-mono tracking-widest border ${
            autoMark
              ? "bg-blood text-blood-foreground border-blood"
              : "bg-background border-border text-muted-foreground"
          }`}
        >
          {autoMark ? "DISABLE" : "ENABLE"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <label className="block">
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground">
            WINDOW (s)
          </span>
          <input
            type="number"
            min={15}
            max={300}
            value={windowSec}
            onChange={(e) => setWindowSec(Number(e.target.value) || 15)}
            className="mt-1 w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
          />
          <p className="text-[10px] font-mono text-muted-foreground/80 mt-1">
            Look back N seconds for spike.
          </p>
        </label>
        <label className="block">
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground">
            MIN MSGS/SEC
          </span>
          <input
            type="number"
            min={0}
            max={50}
            step={0.1}
            value={minMps}
            onChange={(e) => setMinMps(Number(e.target.value) || 0)}
            className="mt-1 w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
          />
          <p className="text-[10px] font-mono text-muted-foreground/80 mt-1">
            Floor — quiet streams ignored.
          </p>
        </label>
        <label className="block">
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground">
            COOLDOWN (s)
          </span>
          <input
            type="number"
            min={0}
            max={3600}
            value={cooldown}
            onChange={(e) => setCooldown(Number(e.target.value) || 0)}
            className="mt-1 w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
          />
          <p className="text-[10px] font-mono text-muted-foreground/80 mt-1">
            Min seconds between auto-grabs per source.
          </p>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="px-6 py-3 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50"
        >
          {save.isPending ? "SAVING…" : "SAVE AUTO-GRAB"}
        </button>
        <button
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending}
          className="px-6 py-3 text-xs font-mono tracking-widest border border-gold text-gold hover:bg-gold/10 disabled:opacity-50"
          title="Forces a synthetic spike + clip on the first live source"
        >
          {testMut.isPending ? "TESTING…" : "▶ TEST AUTO-GRAB"}
        </button>
      </div>
    </div>
  );
}

function TrainingExport() {
  const fetchUrl = useServerFn(getLatestTrainingExportUrl);
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      // Trigger fresh export
      await fetch("/api/public/cron/export-training", { method: "POST" });
      const { url, name } = await fetchUrl();
      if (!url) {
        toast.error("Export not available yet — try again in a moment");
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = name ?? "training.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`Downloaded ${name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bg-panel border border-gold/40 p-5 scanlines mt-6">
      <h3 className="font-display text-xl tracking-widest text-foreground mb-2">
        TRAINING DATA EXPORT
      </h3>
      <p className="text-xs font-mono text-muted-foreground mb-4">
        Download a labelled CSV of every clip you've approved or rejected.
        Use this to fine-tune a model later. Auto-runs nightly at 03:00 UTC.
      </p>
      <button
        onClick={download}
        disabled={busy}
        className="px-4 py-2 text-xs font-mono tracking-widest border border-gold text-gold hover:bg-gold/10 disabled:opacity-50"
      >
        {busy ? "EXPORTING…" : "EXPORT + DOWNLOAD CSV"}
      </button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-panel border border-blood/40 p-5 scanlines">
      <h3 className="font-display text-xl tracking-widest text-foreground mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}
