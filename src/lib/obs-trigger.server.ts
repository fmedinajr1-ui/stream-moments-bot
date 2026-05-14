import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Enqueue a SaveReplayBuffer command for a source's OBS watcher to pick up. */
export async function enqueueObsSave(opts: {
  sourceId?: string | null;
  sourceSlug: string;
  reason: string;
  payload?: Record<string, unknown>;
}) {
  const { error } = await supabaseAdmin.from("obs_trigger_queue").insert({
    source_id: opts.sourceId ?? null,
    source_slug: opts.sourceSlug,
    action: "save_replay",
    payload: { reason: opts.reason, ...(opts.payload ?? {}) },
  });
  if (error) {
    console.error("[obs-trigger] enqueue failed", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** True if a watcher polled within the last `withinSec` seconds. */
export async function isObsClientOnline(slug: string, withinSec = 60) {
  const since = new Date(Date.now() - withinSec * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("obs_clients")
    .select("last_polled_at")
    .eq("source_slug", slug)
    .gte("last_polled_at", since)
    .maybeSingle();
  return !!data;
}
