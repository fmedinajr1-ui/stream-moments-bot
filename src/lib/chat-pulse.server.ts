import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRecentChat } from "@/lib/kick.server";

export type ChatPulseSummary = {
  polled: number;
  spikes: number;
  sources: Array<{
    slug: string;
    msgs_per_sec: number;
    baseline: number;
    spike_ratio: number;
    spike: boolean;
    error?: string;
  }>;
};

const WINDOW_SEC = 30;
const BASELINE_MIN = 10;

export async function runChatPulse(): Promise<ChatPulseSummary> {
  const { data: sources, error } = await supabaseAdmin
    .from("sources")
    .select("id, slug, spike_sensitivity, last_known_live")
    .eq("is_monitoring", true)
    .eq("last_known_live", true);
  if (error) throw error;

  const summary: ChatPulseSummary = { polled: 0, spikes: 0, sources: [] };

  for (const src of sources ?? []) {
    summary.polled++;
    const log: ChatPulseSummary["sources"][number] = {
      slug: src.slug,
      msgs_per_sec: 0,
      baseline: 0,
      spike_ratio: 0,
      spike: false,
    };
    try {
      const msgs = await getRecentChat(src.slug);
      const cutoff = Date.now() - WINDOW_SEC * 1000;
      const recent = msgs.filter((m) => +new Date(m.createdAt) >= cutoff);
      const mps = recent.length / WINDOW_SEC;

      // Rolling baseline: avg msgs_per_sec from last BASELINE_MIN minutes
      const baselineSince = new Date(
        Date.now() - BASELINE_MIN * 60 * 1000,
      ).toISOString();
      const { data: hist } = await supabaseAdmin
        .from("chat_velocity")
        .select("msgs_per_sec")
        .eq("source_id", src.id)
        .gte("created_at", baselineSince);
      const baseline =
        hist && hist.length > 0
          ? hist.reduce((a, r) => a + Number(r.msgs_per_sec), 0) / hist.length
          : Math.max(mps, 0.2); // first reading: assume self
      const ratio = baseline > 0 ? mps / baseline : 0;

      const sensitivity = Number(src.spike_sensitivity ?? 2.0);
      const isSpike = ratio >= sensitivity && mps >= 0.5; // need real activity

      log.msgs_per_sec = +mps.toFixed(2);
      log.baseline = +baseline.toFixed(2);
      log.spike_ratio = +ratio.toFixed(2);
      log.spike = isSpike;

      // Top 5 longest messages as a "loudest" sample
      const sample = recent
        .sort((a, b) => b.content.length - a.content.length)
        .slice(0, 5)
        .map((m) => ({ user: m.username, text: m.content.slice(0, 140) }));

      await supabaseAdmin.from("chat_velocity").insert({
        source_id: src.id,
        msgs_per_sec: mps,
        baseline_msgs_per_sec: baseline,
        spike_ratio: ratio,
        is_spike: isSpike,
        sample_messages: sample,
        peak_window: `${WINDOW_SEC}s`,
      });

      if (isSpike) summary.spikes++;
    } catch (err: any) {
      console.error(`[chat-pulse] ${src.slug} failed`, err);
      log.error = err?.message ?? String(err);
    }
    summary.sources.push(log);
  }

  return summary;
}
