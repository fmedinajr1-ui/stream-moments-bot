import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sampleKickChat } from "@/lib/kick-ws.server";
import { createSpikeClip } from "@/lib/spike-clip.server";

export type ChatPulseSummary = {
  polled: number;
  spikes: number;
  sources: Array<{
    slug: string;
    msgs_per_sec: number;
    baseline: number;
    spike_ratio: number;
    spike: boolean;
    sampled_ms?: number;
    msg_count?: number;
    error?: string;
  }>;
};

const SAMPLE_MS = 10_000;
const BASELINE_MIN = 10;

async function resolveChatroomId(slug: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Referer: `https://kick.com/${slug}`,
        },
      },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.chatroom?.id ?? null;
  } catch {
    return null;
  }
}

export async function runChatPulse(): Promise<ChatPulseSummary> {
  const nowIso = new Date().toISOString();
  const { data: sources, error } = await supabaseAdmin
    .from("sources")
    .select("id, slug, spike_sensitivity, last_known_live, force_live_until")
    .eq("is_monitoring", true)
    .or(`last_known_live.eq.true,force_live_until.gt.${nowIso}`);
  if (error) throw error;

  const summary: ChatPulseSummary = { polled: 0, spikes: 0, sources: [] };

  // Sample all live sources in parallel — each opens its own WS for SAMPLE_MS.
  const results = await Promise.allSettled(
    (sources ?? []).map(async (src) => {
      const log: ChatPulseSummary["sources"][number] = {
        slug: src.slug,
        msgs_per_sec: 0,
        baseline: 0,
        spike_ratio: 0,
        spike: false,
      };

      const chatroomId = await resolveChatroomId(src.slug);
      if (!chatroomId) {
        log.error = "no chatroom id";
        return { src, log };
      }

      const sample = await sampleKickChat(chatroomId, SAMPLE_MS);
      const seconds = Math.max(sample.durationMs / 1000, 1);
      const mps = sample.messages.length / seconds;

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
          : Math.max(mps, 0.2);
      const ratio = baseline > 0 ? mps / baseline : 0;

      const sensitivity = Number(src.spike_sensitivity ?? 2.0);
      const isSpike = ratio >= sensitivity && mps >= 0.5;

      log.msgs_per_sec = +mps.toFixed(2);
      log.baseline = +baseline.toFixed(2);
      log.spike_ratio = +ratio.toFixed(2);
      log.spike = isSpike;
      log.sampled_ms = sample.durationMs;
      log.msg_count = sample.messages.length;
      if (sample.error) log.error = sample.error;

      const sampleMessages = sample.messages
        .sort((a, b) => b.content.length - a.content.length)
        .slice(0, 5)
        .map((m) => ({ user: m.username, text: m.content.slice(0, 140) }));

      const { data: velRow } = await supabaseAdmin
        .from("chat_velocity")
        .insert({
          source_id: src.id,
          msgs_per_sec: mps,
          baseline_msgs_per_sec: baseline,
          spike_ratio: ratio,
          is_spike: isSpike,
          sample_messages: sampleMessages,
          peak_window: `${Math.round(seconds)}s`,
        })
        .select("id")
        .single();

      if (isSpike && velRow) {
        try {
          const clipRes = await createSpikeClip({
            sourceId: src.id,
            slug: src.slug,
            matchedVelocityId: velRow.id,
            spikeRatio: ratio,
            msgsPerSec: mps,
            sampleMessages,
          });
          console.log(
            `[chat-pulse] spike clip for ${src.slug}:`,
            JSON.stringify(clipRes),
          );
        } catch (err) {
          console.error(`[chat-pulse] spike clip failed for ${src.slug}`, err);
        }
      }

      return { src, log, isSpike };
    }),
  );

  for (const r of results) {
    summary.polled++;
    if (r.status === "fulfilled") {
      summary.sources.push(r.value.log);
      if (r.value.isSpike) summary.spikes++;
    } else {
      summary.sources.push({
        slug: "?",
        msgs_per_sec: 0,
        baseline: 0,
        spike_ratio: 0,
        spike: false,
        error: String(r.reason),
      });
    }
  }

  return summary;
}
