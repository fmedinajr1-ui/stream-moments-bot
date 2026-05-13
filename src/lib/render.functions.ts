import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { startRenderForClip } from "@/lib/render-runner.server";

export const queueRender = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ clipId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    return startRenderForClip(data.clipId);
  });

export const retryRender = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ clipId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    return startRenderForClip(data.clipId);
  });

export const getRenderForClip = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ clipId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: job } = await supabaseAdmin
      .from("render_jobs")
      .select("*")
      .eq("clip_id", data.clipId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { job };
  });

export const listRenderJobs = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data } = await supabaseAdmin
      .from("render_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return { jobs: data ?? [] };
  },
);
