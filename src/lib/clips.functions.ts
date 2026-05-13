import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pollSources } from "@/lib/poll-kick.server";
import { getChannel } from "@/lib/kick.server";

export const listPendingClips = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("clips")
      .select("*, sources(slug, display_name)")
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
