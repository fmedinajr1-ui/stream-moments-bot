import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Returns last_polled_at + last_save_at per source slug. */
export const listObsClients = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("obs_clients")
    .select("source_slug, last_polled_at, last_save_at");
  if (error) throw new Error(error.message);
  const now = Date.now();
  const clients = (data ?? []).map((c) => ({
    slug: c.source_slug,
    last_polled_at: c.last_polled_at,
    last_save_at: c.last_save_at,
    online:
      !!c.last_polled_at &&
      now - new Date(c.last_polled_at).getTime() < 60_000,
  }));
  return { clients };
});
