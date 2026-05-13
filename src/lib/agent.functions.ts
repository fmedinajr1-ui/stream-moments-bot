import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
    return {
      total,
      approved,
      rejected,
      pending,
      avgScore,
      topSources: top,
    };
  },
);
