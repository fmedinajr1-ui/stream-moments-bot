import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/campaigns")({
  component: CampaignsPage,
});

type Campaign = {
  id: string;
  name: string;
  platform: string;
  payout_rate: string;
  budget_total: number;
  budget_remaining: number;
  earnings: number;
  status: string;
};

function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  useEffect(() => {
    supabase
      .from("campaigns")
      .select("*")
      .then(({ data }) => setItems((data as Campaign[]) ?? []));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b border-blood/40 pb-4">
        <h2 className="font-display text-4xl tracking-wider">ACTIVE CLIPPING CAMPAIGNS</h2>
        <button className="px-4 py-2 text-xs font-mono tracking-widest border border-blood/60 hover:bg-blood/10">
          + CONNECT NEW CAMPAIGN
        </button>
      </div>
      <div className="grid gap-4">
        {items.map((c) => (
          <div key={c.id} className="bg-panel border border-blood/40 p-5 scanlines flex items-center gap-6">
            <div className="flex-1">
              <h3 className="font-display text-2xl tracking-wider">{c.name}</h3>
              <div className="text-xs font-mono text-muted-foreground tracking-widest mt-1">
                {c.platform} • {c.payout_rate}
              </div>
              <div className="text-xs font-mono mt-2">
                <span className="text-muted-foreground">BUDGET </span>
                <span className="text-foreground">${c.budget_remaining.toLocaleString()} / ${c.budget_total.toLocaleString()}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-3xl text-gold">${c.earnings.toLocaleString()}</div>
              <div className="text-[10px] font-mono text-muted-foreground tracking-widest">EARNINGS</div>
            </div>
            <span
              className={`px-2 py-1 text-[10px] font-mono tracking-widest border ${
                c.status === "active"
                  ? "border-live text-live"
                  : "border-muted-foreground text-muted-foreground"
              }`}
            >
              {c.status.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
