import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pollSources } from "@/lib/poll-kick.server";
import { getChannel } from "@/lib/kick.server";
import { _internalStartRender } from "@/lib/render.functions";

export const listPendingClips = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("clips")
      .select("*, sources(slug, display_name), render_jobs(id,status,output_url,error_message,created_at)")
      .in("status", ["pending", "processing"])
      .order("virality_score", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);
    return { clips: data ?? [] };
  },
);

export const listApprovedClips = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("clips")
      .select("*, sources(slug, display_name)")
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(120);
    if (error) throw new Error(error.message);
    return { clips: data ?? [] };
  },
);

export const setClipStatus = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["approved", "rejected", "downloaded", "pending"]),
        hook_caption: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const patch: {
      status: string;
      approved_at?: string;
      hook_caption?: string;
    } = { status: data.status };
    if (data.status === "approved")
      patch.approved_at = new Date().toISOString();
    if (data.hook_caption) patch.hook_caption = data.hook_caption;
    const { error } = await supabaseAdmin
      .from("clips")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("audit_log")
      .insert({ action: data.status, clip_id: data.id });

    // Fire-and-forget: when a clip is approved, kick off the highlight render.
    if (data.status === "approved") {
      try {
        await _internalStartRender(data.id);
      } catch (err) {
        console.error("[setClipStatus] render queue failed", err);
      }
    }
    return { ok: true };
  });

export const runPollNow = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ sourceId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const summary = await pollSources({ sourceId: data.sourceId });
    return summary;
  });

export const getAgentStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const [{ data: sources }, { data: settings }, { data: recentPolls }, { count: scoredLastHour }] = await Promise.all([
      supabaseAdmin.from("sources").select("id,slug,display_name,last_polled_at,last_known_live,is_monitoring"),
      supabaseAdmin.from("agent_settings").select("is_paused").limit(1).maybeSingle(),
      supabaseAdmin
        .from("audit_log")
        .select("created_at,details")
        .eq("action", "poll_kick")
        .order("created_at", { ascending: false })
        .limit(1),
      supabaseAdmin
        .from("clips")
        .select("id", { count: "exact", head: true })
        .gte("created_at", oneHourAgo),
    ]);
    const lastPoll = recentPolls?.[0];
    return {
      isPaused: !!settings?.is_paused,
      sources: sources ?? [],
      liveCount: (sources ?? []).filter((s: any) => s.last_known_live).length,
      monitoredCount: (sources ?? []).filter((s: any) => s.is_monitoring).length,
      lastPollAt: lastPoll?.created_at ?? null,
      lastPollSummary: (lastPoll?.details as any) ?? null,
      scoredLastHour: scoredLastHour ?? 0,
    };
  },
);

export const setAgentPaused = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ paused: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("agent_settings")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!row) throw new Error("No agent_settings row");
    const { error } = await supabaseAdmin
      .from("agent_settings")
      .update({ is_paused: data.paused, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addSource = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        slug: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-zA-Z0-9_]+$/),
        poll_interval_min: z.number().int().min(1).max(120).default(15),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const slug = data.slug.toLowerCase();
    const channel = await getChannel(slug);
    if (!channel) {
      throw new Error(`Kick channel "${slug}" not found`);
    }
    const { data: row, error } = await supabaseAdmin
      .from("sources")
      .insert({
        slug,
        display_name: slug.toUpperCase(),
        is_monitoring: true,
        poll_interval_min: data.poll_interval_min,
        last_known_live: channel.isLive,
        follower_count: channel.followers,
        avg_viewers: channel.viewers,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { source: row };
  });

export const deleteSource = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("sources")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const recordDownload = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        clip_id: z.string().uuid(),
        format: z.enum(["mp4", "metadata", "capcut"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await supabaseAdmin.from("download_history").insert({
      clip_id: data.clip_id,
      format: data.format,
    });
    return { ok: true };
  });
