// Resolver for marked moments → clips.
// Looks for an archived VOD that covers the moment and creates a clip row
// that the existing render-runner will render via Shotstack.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveVodAt } from "@/lib/kick-vod.server";
import { startRenderForClip } from "@/lib/render-runner.server";

const MAX_ATTEMPTS = 12; // ~1h with 5min cron
const MIN_AGE_MS = 60_000; // wait at least 1min after marking before first try

export type ResolveSummary = {
  scanned: number;
  resolved: number;
  stillPending: number;
  failed: number;
  details: Array<{
    id: string;
    slug: string;
    status: string;
    error?: string;
    clipId?: string;
  }>;
};

export async function resolvePendingMoments(): Promise<ResolveSummary> {
  const summary: ResolveSummary = {
    scanned: 0,
    resolved: 0,
    stillPending: 0,
    failed: 0,
    details: [],
  };

  const { data: rows, error } = await supabaseAdmin
    .from("marked_moments")
    .select(
      "id, source_id, marked_at, duration_sec, caption, attempts, sources(slug, display_name)",
    )
    .eq("status", "pending")
    .order("marked_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);

  for (const row of rows ?? []) {
    summary.scanned++;
    const slug = (row as any).sources?.slug as string | undefined;
    const displayName =
      ((row as any).sources?.display_name as string | undefined) ?? slug ?? "";
    if (!slug) {
      await markFailed(row.id, "missing source slug");
      summary.failed++;
      summary.details.push({
        id: row.id,
        slug: "?",
        status: "failed",
        error: "missing slug",
      });
      continue;
    }

    const ageMs = Date.now() - +new Date(row.marked_at);
    if (ageMs < MIN_AGE_MS) {
      summary.stillPending++;
      summary.details.push({ id: row.id, slug, status: "waiting" });
      continue;
    }

    let vod: { vodUrl: string; startOffsetSec: number } | null = null;
    try {
      vod = await resolveVodAt(slug, row.marked_at);
    } catch (err: any) {
      // network/parse error — keep retrying until attempts exhausted
    }

    if (!vod) {
      const attempts = (row.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await markFailed(row.id, "no VOD covers this moment after retries");
        summary.failed++;
        summary.details.push({
          id: row.id,
          slug,
          status: "failed",
          error: "no VOD",
        });
      } else {
        await supabaseAdmin
          .from("marked_moments")
          .update({
            attempts,
            last_error: "VOD not yet available",
          })
          .eq("id", row.id);
        summary.stillPending++;
        summary.details.push({ id: row.id, slug, status: "retry" });
      }
      continue;
    }

    // Found a VOD — create a clip row and let render-runner pick it up.
    const captionText =
      row.caption?.trim() ||
      `${displayName.toUpperCase()} MARKED MOMENT`;
    const duration = Math.min(60, Math.max(5, row.duration_sec));

    const { data: clip, error: clipErr } = await supabaseAdmin
      .from("clips")
      .insert({
        source_id: row.source_id,
        kick_clip_id: `marked-${row.id}`,
        title: captionText,
        hook_caption: captionText,
        status: "processing",
        auto_grabbed: false,
        capture_method: "marked_vod",
        stream_timestamp: row.marked_at,
        duration_seconds: duration,
        virality_score: 70,
        score_breakdown: { reaction: 70, chat: 60, audio: 60 },
        score_rationale: "User-marked moment, resolved from VOD",
      })
      .select("id")
      .single();
    if (clipErr || !clip) {
      const attempts = (row.attempts ?? 0) + 1;
      await supabaseAdmin
        .from("marked_moments")
        .update({
          attempts,
          last_error: `clip insert: ${clipErr?.message ?? "unknown"}`,
        })
        .eq("id", row.id);
      summary.stillPending++;
      summary.details.push({
        id: row.id,
        slug,
        status: "retry",
        error: clipErr?.message,
      });
      continue;
    }

    // Mark resolved BEFORE kicking the render so we never double-render.
    await supabaseAdmin
      .from("marked_moments")
      .update({
        status: "resolved",
        resolved_clip_id: clip.id,
        resolved_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", row.id);

    try {
      await startRenderForClip(clip.id);
    } catch (err: any) {
      console.error("[resolve-moments] render kickoff failed", err);
    }

    summary.resolved++;
    summary.details.push({
      id: row.id,
      slug,
      status: "resolved",
      clipId: clip.id,
    });
  }

  await supabaseAdmin.from("audit_log").insert({
    action: "resolve_moments_tick",
    details: summary as any,
  });

  return summary;
}

async function markFailed(id: string, reason: string) {
  await supabaseAdmin
    .from("marked_moments")
    .update({
      status: "failed",
      last_error: reason,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);
}
