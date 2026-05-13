import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listCampaigns = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { campaigns: data ?? [] };
  },
);

export const upsertCampaign = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1),
        platform: z.string().optional(),
        payout_rate: z.string().optional(),
        budget_total: z.number().optional(),
        budget_remaining: z.number().optional(),
        requirements: z.string().optional(),
        status: z.enum(["active", "paused", "complete"]).default("active"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (data.id) {
      const { id, ...patch } = data;
      const { error } = await supabaseAdmin
        .from("campaigns")
        .update(patch)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("campaigns").insert(data);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("campaigns")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
