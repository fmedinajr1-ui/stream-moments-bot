import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pollSources } from "@/lib/poll-kick.server";

export const getAgentSettings = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("agent_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { settings: data };
  },
);

export const updateAgentSettings = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        min_score_threshold: z.number().int().min(0).max(100).optional(),
        max_clips_per_day: z.number().int().min(1).max(100).optional(),
        is_paused: z.boolean().optional(),
        blocked_keywords: z.array(z.string()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin
      .from("agent_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAuditLog = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(error.message);
    return { entries: data ?? [] };
  },
);

export const getCronHealth = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data } = await supabaseAdmin
      .from("audit_log")
      .select("created_at,details")
      .eq("action", "poll_kick")
      .order("created_at", { ascending: false })
      .limit(20);
    return {
      runs: (data ?? []).map((r: any) => ({
        at: r.created_at,
        polled: r.details?.polled ?? 0,
        new_clips: r.details?.new_clips ?? 0,
        errors: (r.details?.sources ?? []).filter((s: any) => s.error).length,
      })),
    };
  },
);

export const getAnalytics = createServerFn({ method: "GET" }).handler(
  async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: clips } = await supabaseAdmin
      .from("clips")
      .select("status, virality_score, source_id, created_at, sources(display_name)")
      .gte("created_at", sevenDaysAgo);

    const list = clips ?? [];
    const total = list.length;
    const approved = list.filter((c: any) => c.status === "approved").length;
    const rejected = list.filter((c: any) => c.status === "rejected").length;
    const pending = list.filter((c: any) =>
      ["pending", "processing"].includes(c.status),
    ).length;
    const avgScore =
      total === 0
        ? 0
        : Math.round(
            list.reduce(
              (s: number, c: any) => s + (c.virality_score ?? 0),
              0,
            ) / total,
          );
    const bySource: Record<string, number> = {};
    for (const c of list as any[]) {
      const k = c.sources?.display_name ?? "?";
      bySource[k] = (bySource[k] ?? 0) + (c.status === "approved" ? 1 : 0);
    }
    const top = Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const spikeMatched = (list as any[]).filter(
      (c) => c.status === "approved" && c.chat_spike_ratio,
    ).length;
    const spikeApprovalRate =
      approved === 0 ? 0 : Math.round((spikeMatched / approved) * 100);
    return {
      total,
      approved,
      rejected,
      pending,
      avgScore,
      topSources: top,
      spikeApprovalRate,
      spikeMatched,
    };
  },
);

export const getLatestChatVelocity = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data } = await supabaseAdmin
      .from("chat_velocity")
      .select("source_id, msgs_per_sec, spike_ratio, is_spike, created_at")
      .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .order("created_at", { ascending: false });
    const bySource: Record<string, any> = {};
    for (const r of data ?? []) {
      if (!bySource[r.source_id]) bySource[r.source_id] = r;
    }
    return { latest: bySource };
  },
);

export const updateSourceSensitivity = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        spike_sensitivity: z.number().min(1.2).max(5),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("sources")
      .update({ spike_sensitivity: data.spike_sensitivity })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getLatestTrainingExportUrl = createServerFn({
  method: "GET",
}).handler(async () => {
  const { data } = await supabaseAdmin.storage
    .from("training-data")
    .list("exports", {
      limit: 1,
      sortBy: { column: "created_at", order: "desc" },
    });
  const file = data?.[0];
  if (!file) return { url: null, name: null };
  const { data: signed } = await supabaseAdmin.storage
    .from("training-data")
    .createSignedUrl(`exports/${file.name}`, 600);
  return { url: signed?.signedUrl ?? null, name: file.name };
});
