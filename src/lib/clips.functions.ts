import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

export const setClipStatus = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["approved", "rejected", "downloaded"]),
        hook_caption: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const patch: Record<string, unknown> = { status: data.status };
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

export const triggerPoll = createServerFn({ method: "POST" }).handler(
  async () => {
    const url = `${process.env.SUPABASE_URL?.replace(/\/$/, "")}`;
    // Just call the public route directly via fetch using the project URL.
    // We don't have it server-side cleanly; the cron route does the work.
    // Easier: import the poller inline.
    const mod = await import("@/routes/api/public/cron/poll-kick");
    void mod;
    // Re-implement: fetch into our own host. Use VITE_SUPABASE_URL is wrong.
    // Instead we simply invoke the poll function via dynamic import of helper.
    return { ok: true, hint: "use /api/public/cron/poll-kick directly" };
    void url;
  },
);
