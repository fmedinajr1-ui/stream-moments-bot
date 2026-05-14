// Create a clip row from a live moment (no Kick clip object yet) and kick
// off Shotstack rendering against the live VOD.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { startRenderForClip } from "@/lib/render-runner.server";

export type SpikeClipInput = {
  sourceId: string;
  slug: string;
  matchedVelocityId?: string | null;
  spikeRatio?: number | null;
  msgsPerSec?: number | null;
  sampleMessages?: Array<{ user: string; text: string }>;
  // Override the moment's timestamp; defaults to "now".
  timestampIso?: string;
  // Optional override for the hook caption.
  hookCaption?: string;
};

function deriveCaption(
  slug: string,
  spikeRatio: number | null | undefined,
  sample: Array<{ user: string; text: string }> | undefined,
): string {
  const longest = (sample ?? [])
    .map((s) => s.text)
    .sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length >= 12) {
    return longest.slice(0, 60).toUpperCase();
  }
  if (spikeRatio && spikeRatio >= 1.5) {
    return `${slug.toUpperCase()} CHAT WENT CRAZY (${spikeRatio.toFixed(1)}x)`;
  }
  return `${slug.toUpperCase()} LIVE MOMENT`;
}

function deriveScore(
  spikeRatio: number | null | undefined,
  msgsPerSec: number | null | undefined,
): number {
  const base = 60;
  const spikeBoost = spikeRatio ? Math.min(30, Math.round(spikeRatio * 8)) : 0;
  const volBoost = msgsPerSec ? Math.min(10, Math.round(msgsPerSec)) : 0;
  return Math.min(99, base + spikeBoost + volBoost);
}

/**
 * Insert a `clips` row for a live moment and start a Shotstack render against
 * the live VOD. Returns the clip id and render result.
 */
export async function createSpikeClip(input: SpikeClipInput) {
  const ts = input.timestampIso ?? new Date().toISOString();
  const caption =
    input.hookCaption ??
    deriveCaption(input.slug, input.spikeRatio, input.sampleMessages);
  const score = deriveScore(input.spikeRatio, input.msgsPerSec);

  const { data: clip, error } = await supabaseAdmin
    .from("clips")
    .insert({
      source_id: input.sourceId,
      // Synthetic id so the unique-constraint dedupe in pollSources won't
      // collide with future viewer-clip ingest.
      kick_clip_id: `live-${input.sourceId}-${Date.parse(ts)}`,
      title: caption,
      hook_caption: caption,
      virality_score: score,
      score_breakdown: {
        reaction: score,
        chat: input.spikeRatio
          ? Math.min(100, Math.round(input.spikeRatio * 25))
          : score,
        audio: Math.max(40, score - 15),
      },
      score_rationale: input.spikeRatio
        ? `Live spike-triggered: ${input.spikeRatio.toFixed(1)}x baseline at ${input.msgsPerSec?.toFixed(1) ?? "?"} msgs/s.`
        : "Manual live capture.",
      chat_spike_ratio: input.spikeRatio ?? null,
      matched_velocity_id: input.matchedVelocityId ?? null,
      status: "processing",
      stream_timestamp: ts,
      duration_seconds: 30,
    })
    .select("id")
    .single();

  if (error || !clip) {
    return { ok: false, error: error?.message ?? "insert failed" } as const;
  }

  let render: any = null;
  try {
    render = await startRenderForClip(clip.id);
  } catch (err: any) {
    console.error("[spike-clip] render kickoff failed", err);
    render = { ok: false, error: err?.message ?? String(err) };
  }
  return { ok: true, clipId: clip.id, render } as const;
}
