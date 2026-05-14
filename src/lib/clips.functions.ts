import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pollSources } from "@/lib/poll-kick.server";
import { getChannel } from "@/lib/kick.server";
import { startRenderForClip } from "@/lib/render-runner.server";
import { createSpikeClip } from "@/lib/spike-clip.server";

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
      .select("*, sources(slug, display_name), render_jobs(id,status,output_url,error_message,created_at)")
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
        await startRenderForClip(data.id);
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

export const listLiveSources = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("sources")
      .select("id,slug,display_name,last_known_live,avg_viewers,is_monitoring")
      .eq("is_monitoring", true)
      .order("last_known_live", { ascending: false })
      .order("display_name", { ascending: true });
    if (error) throw new Error(error.message);
    return { sources: data ?? [] };
  },
);

export const listRecentClips = createServerFn({ method: "GET" }).handler(
  async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("clips")
      .select(
        "id,created_at,stream_timestamp,hook_caption,title,status,virality_score,thumbnail_url,chat_spike_ratio,sources(slug,display_name)",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);
    return { clips: data ?? [] };
  },
);

export const listLiveChatActivity = createServerFn({ method: "GET" }).handler(
  async () => {
    const nowIso = new Date().toISOString();
    const [{ data: sources, error: srcErr }, { data: settings }] = await Promise.all([
      supabaseAdmin
        .from("sources")
        .select("id,slug,display_name,last_known_live,force_live_until,spike_sensitivity")
        .eq("is_monitoring", true)
        .or(`last_known_live.eq.true,force_live_until.gt.${nowIso}`),
      supabaseAdmin
        .from("agent_settings")
        .select("spike_window_sec,spike_min_mps,auto_grab_cooldown_sec,auto_grab_enabled,is_paused")
        .limit(1)
        .maybeSingle(),
    ]);
    if (srcErr) throw new Error(srcErr.message);

    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const ids = (sources ?? []).map((s) => s.id);
    if (!ids.length) return { sources: [] as any[], settings: settings ?? null };

    const [{ data: vel, error: velErr }, { data: lastGrabs }] = await Promise.all([
      supabaseAdmin
        .from("chat_velocity")
        .select("source_id,created_at,msgs_per_sec,baseline_msgs_per_sec,spike_ratio,is_spike,clip_id,sample_messages")
        .in("source_id", ids)
        .gte("created_at", since)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("clips")
        .select("id,source_id,created_at,hook_caption,status,chat_spike_ratio")
        .in("source_id", ids)
        .eq("auto_grabbed", true)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (velErr) throw new Error(velErr.message);

    const byId = new Map<string, any[]>();
    for (const r of vel ?? []) {
      const arr = byId.get(r.source_id) ?? [];
      arr.push(r);
      byId.set(r.source_id, arr);
    }
    const lastGrabById = new Map<string, any>();
    for (const g of lastGrabs ?? []) {
      if (g.source_id && !lastGrabById.has(g.source_id)) lastGrabById.set(g.source_id, g);
    }
    return {
      sources: (sources ?? []).map((s) => {
        const series = byId.get(s.id) ?? [];
        const latest = series[series.length - 1] ?? null;
        return { ...s, latest, series, lastAutoGrab: lastGrabById.get(s.id) ?? null };
      }),
      settings: settings ?? null,
    };
  },
);

export const getSpikeSettings = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("agent_settings")
      .select("id,spike_window_sec,spike_min_mps,auto_grab_cooldown_sec,auto_grab_enabled,is_paused")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { settings: data };
  },
);

export const updateSpikeSettings = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        spike_window_sec: z.number().int().min(15).max(300).optional(),
        spike_min_mps: z.number().min(0).max(50).optional(),
        auto_grab_cooldown_sec: z.number().int().min(0).max(3600).optional(),
        auto_grab_enabled: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("agent_settings")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!row) throw new Error("no agent_settings row");
    const { error } = await supabaseAdmin
      .from("agent_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testAutoGrab = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ sourceId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    let sourceId = data.sourceId;
    if (!sourceId) {
      const { data: live } = await supabaseAdmin
        .from("sources")
        .select("id")
        .eq("is_monitoring", true)
        .eq("last_known_live", true)
        .limit(1)
        .maybeSingle();
      if (!live) throw new Error("no live source available");
      sourceId = live.id;
    }
    const { data: src } = await supabaseAdmin
      .from("sources")
      .select("id,slug,display_name")
      .eq("id", sourceId)
      .single();
    if (!src) throw new Error("source not found");

    const { data: vel } = await supabaseAdmin
      .from("chat_velocity")
      .insert({
        source_id: src.id,
        msgs_per_sec: 2.0,
        baseline_msgs_per_sec: 0.5,
        spike_ratio: 4.0,
        is_spike: true,
        sample_messages: [{ user: "test", text: "SYNTHETIC SPIKE TEST" }],
        peak_window: "test",
      })
      .select("id")
      .single();

    const result = await createSpikeClip({
      sourceId: src.id,
      slug: src.slug,
      matchedVelocityId: vel?.id ?? null,
      spikeRatio: 4.0,
      msgsPerSec: 2.0,
      sampleMessages: [{ user: "test", text: "SYNTHETIC SPIKE TEST" }],
      autoGrabbed: true,
      hookCaption: `${(src.display_name ?? src.slug).toUpperCase()} TEST AUTO-GRAB`,
    });
    await supabaseAdmin.from("audit_log").insert({
      action: "spike_grab_test",
      clip_id: result.ok ? result.clipId : null,
      details: { source_id: src.id, slug: src.slug, result },
    });
    return result;
  });


export const manualGrabClip = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        sourceId: z.string().uuid(),
        caption: z.string().max(80).optional(),
        durationSec: z.number().int().min(15).max(60).default(30),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: src, error } = await supabaseAdmin
      .from("sources")
      .select("slug,display_name")
      .eq("id", data.sourceId)
      .single();
    if (error || !src) throw new Error("source not found");
    const result = await createSpikeClip({
      sourceId: data.sourceId,
      slug: src.slug,
      hookCaption:
        data.caption?.trim() ||
        `${(src.display_name ?? src.slug).toUpperCase()} MANUAL GRAB`,
    });
    return result;
  });
