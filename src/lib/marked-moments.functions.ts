import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolvePendingMoments } from "@/lib/marked-moments.server";

/** Mark a live moment from the dashboard. Resolved later from the VOD. */
export const markMoment = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        sourceId: z.string().uuid(),
        durationSec: z.number().int().min(5).max(120).default(30),
        caption: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("marked_moments")
      .insert({
        source_id: data.sourceId,
        duration_sec: data.durationSec,
        caption: data.caption ?? null,
        marked_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id, marked_at")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id, markedAt: row.marked_at };
  });

/** List recent marked moments for the dashboard. */
export const listMarkedMoments = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("marked_moments")
      .select(
        "id, source_id, marked_at, duration_sec, caption, status, attempts, last_error, resolved_clip_id, resolved_at, sources(slug, display_name)",
      )
      .order("marked_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);
    return { moments: data ?? [] };
  },
);

/** Manually retry the resolver (also runs on a cron). */
export const retryResolveMoments = createServerFn({ method: "POST" }).handler(
  async () => {
    const summary = await resolvePendingMoments();
    return summary;
  },
);
