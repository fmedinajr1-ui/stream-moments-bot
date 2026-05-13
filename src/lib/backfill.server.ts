// Backfill: scan recent chat-velocity spikes that never produced a clip,
// resolve their moment in the streamer's VOD, and create + render a clip.
//
// Designed to run on a cron (hourly). Idempotent: every spike row is processed
// at most once, and we mark its clip_id once a clip row is created.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveVodAt } from "@/lib/kick-vod.server";
import { startRenderForClip } from "@/lib/render-runner.server";

export type BackfillSummary = {
  scanned: number;
  candidates: number;
  vod_missing: number;
  duplicates: number;
  below_threshold: number;
  created: number;
  rendered: number;
  errors: Array<{ velocity_id: string; error: string }>;
};

const LOOKBACK_HOURS = 4;
const COLLAPSE_WINDOW_SEC = 90; // dedupe spikes within ±90s of an existing clip
const MAX_PER_RUN = 10;

function spikeToScore(ratio: number, mps: number): number {
  // Map spike strength → 0-100 virality.
  // 2x baseline ≈ 70, 4x ≈ 85, 8x+ ≈ 95. Boosted slightly by raw msgs/sec.
  const ratioScore = Math.min(95, 50 + Math.log2(Math.max(ratio, 1)) * 12);
  const activityBoost = Math.min(8, Math.log10(mps + 1) * 6);
  return Math.round(Math.min(98, ratioScore + activityBoost));
}

export async function runBackfill(): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    scanned: 0,
    candidates: 0,
    vod_missing: 0,
    duplicates: 0,
    below_threshold: 0,
    created: 0,
    rendered: 0,
    errors: [],
  };

  const { data: settings } = await supabaseAdmin
    .from("agent_settings")
    .select("min_score_threshold,is_paused")
    .limit(1)
    .maybeSingle();
  if (settings?.is_paused) return summary;
  const threshold = settings?.min_score_threshold ?? 70;

  const since = new Date(
    Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: spikes, error } = await supabaseAdmin
    .from("chat_velocity")
    .select(
      "id, source_id, created_at, spike_ratio, msgs_per_sec, sample_messages, clip_id",
    )
    .eq("is_spike", true)
    .is("clip_id", null)
    .gte("created_at", since)
    .order("spike_ratio", { ascending: false })
    .limit(MAX_PER_RUN * 4);
  if (error) throw error;

  summary.scanned = spikes?.length ?? 0;

  // Cache source slugs
  const sourceIds = Array.from(new Set((spikes ?? []).map((s) => s.source_id)));
  const { data: srcs } = await supabaseAdmin
    .from("sources")
    .select("id, slug")
    .in("id", sourceIds.length ? sourceIds : ["00000000-0000-0000-0000-000000000000"]);
  const slugById = new Map((srcs ?? []).map((s) => [s.id, s.slug]));

  let processed = 0;
  for (const sp of spikes ?? []) {
    if (processed >= MAX_PER_RUN) break;
    summary.candidates++;
    const slug = slugById.get(sp.source_id);
    if (!slug) continue;

    // Skip if a clip already exists near this moment for this source
    const t = +new Date(sp.created_at);
    const lo = new Date(t - COLLAPSE_WINDOW_SEC * 1000).toISOString();
    const hi = new Date(t + COLLAPSE_WINDOW_SEC * 1000).toISOString();
    const { data: nearby } = await supabaseAdmin
      .from("clips")
      .select("id")
      .eq("source_id", sp.source_id)
      .gte("created_at", lo)
      .lte("created_at", hi)
      .limit(1);
    if (nearby && nearby.length > 0) {
      summary.duplicates++;
      await supabaseAdmin
        .from("chat_velocity")
        .update({ clip_id: nearby[0].id })
        .eq("id", sp.id);
      continue;
    }

    const ratio = Number(sp.spike_ratio ?? 0);
    const mps = Number(sp.msgs_per_sec ?? 0);
    const score = spikeToScore(ratio, mps);
    if (score < threshold) {
      summary.below_threshold++;
      continue;
    }

    let vod;
    try {
      vod = await resolveVodAt(slug, sp.created_at);
    } catch (err: any) {
      summary.errors.push({ velocity_id: sp.id, error: err?.message ?? String(err) });
      continue;
    }
    if (!vod) {
      summary.vod_missing++;
      continue;
    }

    const sample =
      Array.isArray(sp.sample_messages) && sp.sample_messages.length > 0
        ? (sp.sample_messages as Array<{ user: string; text: string }>)
        : [];
    const hookSeed = sample[0]?.text?.toUpperCase().slice(0, 60) ?? "CHAT WENT NUCLEAR";
    const title = `Backfill: ${ratio.toFixed(1)}x chat spike`;

    const { data: clip, error: insErr } = await supabaseAdmin
      .from("clips")
      .insert({
        source_id: sp.source_id,
        kick_clip_id: `spike:${sp.id}`,
        title,
        duration_seconds: 45,
        kick_view_count: 0,
        virality_score: score,
        score_breakdown: {
          reaction: Math.round(score * 0.95),
          chat: Math.min(100, Math.round(50 + ratio * 8)),
          audio: Math.round(score * 0.7),
        },
        hook_caption: hookSeed,
        score_rationale: `Backfilled from chat spike ${ratio.toFixed(1)}x baseline (${mps.toFixed(1)} msgs/sec).`,
        chat_spike_ratio: ratio,
        matched_velocity_id: sp.id,
        status: "pending",
        stream_timestamp: sp.created_at,
      })
      .select("id")
      .single();

    if (insErr || !clip) {
      summary.errors.push({
        velocity_id: sp.id,
        error: insErr?.message ?? "insert failed",
      });
      continue;
    }
    summary.created++;
    processed++;

    await supabaseAdmin
      .from("chat_velocity")
      .update({ clip_id: clip.id })
      .eq("id", sp.id);

    try {
      const r = await startRenderForClip(clip.id);
      if (r.ok) summary.rendered++;
    } catch (err: any) {
      summary.errors.push({
        velocity_id: sp.id,
        error: `render: ${err?.message ?? String(err)}`,
      });
    }
  }

  await supabaseAdmin
    .from("audit_log")
    .insert({ action: "backfill", details: summary as any });

  return summary;
}
