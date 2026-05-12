import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

type AgentSettings = {
  id: string;
  is_paused: boolean;
  min_score_threshold: number;
  max_clips_per_day: number;
  blocked_keywords: string[];
};

function SettingsPage() {
  const [s, setS] = useState<AgentSettings | null>(null);

  useEffect(() => {
    supabase
      .from("agent_settings")
      .select("*")
      .limit(1)
      .single()
      .then(({ data }) => setS(data as AgentSettings));
  }, []);

  async function patch(p: Partial<AgentSettings>) {
    if (!s) return;
    const next = { ...s, ...p };
    setS(next);
    await supabase.from("agent_settings").update(p).eq("id", s.id);
  }

  if (!s) return <div className="font-mono text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="border-b border-blood/40 pb-4">
        <h2 className="font-display text-4xl tracking-wider">SETTINGS</h2>
      </div>

      <Section title="AGENT BEHAVIOR">
        <Field label={`MIN VIRALITY SCORE TO AUTO-QUEUE — ${s.min_score_threshold}`}>
          <input
            type="range"
            min={0}
            max={100}
            value={s.min_score_threshold}
            onChange={(e) => patch({ min_score_threshold: Number(e.target.value) })}
            className="w-full accent-blood"
          />
        </Field>
        <Field label="MAX CLIPS PER DAY">
          <input
            type="number"
            value={s.max_clips_per_day}
            onChange={(e) => patch({ max_clips_per_day: Number(e.target.value) })}
            className="bg-background border border-blood/40 px-3 py-2 font-mono text-foreground w-32 focus:outline-none focus:border-blood"
          />
        </Field>
        <Field label="APPROVAL REQUIRED BEFORE POSTING">
          <span className="text-gold font-mono text-xs tracking-widest">
            ALWAYS ON — DOWNLOAD-ONLY MODE
          </span>
        </Field>
        <Field label="AUTO-REJECT KEYWORDS (comma-separated)">
          <textarea
            value={s.blocked_keywords.join(", ")}
            onChange={(e) =>
              patch({
                blocked_keywords: e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
            className="w-full bg-background border border-blood/40 px-3 py-2 font-mono text-foreground text-sm focus:outline-none focus:border-blood"
            rows={2}
          />
        </Field>
      </Section>

      <Section title="API & CRON">
        <Field label="LOVABLE AI">
          <span className="font-mono text-xs text-live tracking-widest">CONNECTED ✓ (managed)</span>
        </Field>
        <Field label="KICK ADAPTER">
          <span className="font-mono text-xs text-muted-foreground tracking-widest">
            UNOFFICIAL — wired in Step 4
          </span>
        </Field>
        <Field label="CRON ENDPOINT (configure in Step 4)">
          <code className="font-mono text-xs text-gold">/api/cron/poll-kick</code>
        </Field>
      </Section>

      <Section title="DANGER ZONE">
        <button
          onClick={() => patch({ is_paused: !s.is_paused })}
          className={`px-4 py-2 font-display text-sm tracking-widest border ${
            s.is_paused
              ? "bg-live/20 border-live text-live"
              : "bg-blood text-foreground border-blood"
          }`}
        >
          {s.is_paused ? "RESUME AGENT" : "PAUSE AGENT"}
        </button>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-panel border border-blood/40 p-5 scanlines space-y-4">
      <h3 className="font-display text-xl text-blood tracking-widest">{title}</h3>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-mono text-muted-foreground tracking-widest block">
        {label}
      </label>
      {children}
    </div>
  );
}
