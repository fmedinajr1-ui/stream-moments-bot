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
