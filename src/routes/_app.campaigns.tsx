import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteCampaign,
  listCampaigns,
  upsertCampaign,
} from "@/lib/campaigns.functions";

export const Route = createFileRoute("/_app/campaigns")({
  component: CampaignsPage,
});

type Campaign = {
  id: string;
  name: string;
  platform: string | null;
  payout_rate: string | null;
  budget_total: number | null;
  budget_remaining: number | null;
  earnings: number | null;
  requirements: string | null;
  status: string;
};

function CampaignsPage() {
  const fetchAll = useServerFn(listCampaigns);
  const upsert = useServerFn(upsertCampaign);
  const del = useServerFn(deleteCampaign);
  const { data, refetch } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => fetchAll(),
  });
  const campaigns: Campaign[] = (data?.campaigns ?? []) as any;

  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState<Partial<Campaign>>({
    status: "active",
  });

  const save = useMutation({
    mutationFn: (v: any) => upsert({ data: v }),
    onSuccess: () => {
      toast.success("CAMPAIGN SAVED");
      setShow(false);
      setDraft({ status: "active" });
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => refetch(),
  });

  function openEdit(c: Campaign) {
    setDraft(c);
    setShow(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b border-blood/40 pb-4">
        <div>
          <h2 className="font-display text-2xl sm:text-3xl md:text-4xl tracking-wider">CAMPAIGNS</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1 tracking-widest">
            {campaigns.length} CAMPAIGNS TRACKED
          </p>
        </div>
        <button
          onClick={() => {
            setDraft({ status: "active" });
            setShow(true);
          }}
          className="px-4 py-2 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red"
        >
          + NEW CAMPAIGN
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {campaigns.map((c) => (
          <div key={c.id} className="bg-panel border border-blood/60 p-5 scanlines">
            <div className="flex items-start justify-between">
              <h3 className="font-display text-2xl tracking-wider">{c.name}</h3>
              <span
                className={`text-[10px] font-mono tracking-widest px-2 py-0.5 ${
                  c.status === "active"
                    ? "bg-blood text-blood-foreground"
                    : "bg-background border border-border text-muted-foreground"
                }`}
              >
                {c.status.toUpperCase()}
              </span>
            </div>
            <dl className="mt-4 space-y-1 text-xs font-mono">
              <Row label="PLATFORM" v={c.platform ?? "—"} />
              <Row label="PAYOUT" v={c.payout_rate ?? "—"} />
              <Row
                label="BUDGET"
                v={
                  c.budget_total != null
                    ? `$${c.budget_remaining ?? c.budget_total} / $${c.budget_total}`
                    : "—"
                }
              />
              <Row label="EARNED" v={`$${c.earnings ?? 0}`} />
            </dl>
            {c.requirements && (
              <p className="mt-3 text-[10px] font-mono text-muted-foreground line-clamp-3">
                {c.requirements}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => openEdit(c)}
                className="flex-1 text-[10px] font-mono tracking-widest border border-blood/60 px-2 py-1.5 hover:bg-blood/10"
              >
                EDIT
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${c.name}?`)) delMut.mutate(c.id);
                }}
                className="text-[10px] font-mono tracking-widest border border-border px-2 py-1.5 text-muted-foreground hover:text-blood hover:border-blood"
              >
                DEL
              </button>
            </div>
          </div>
        ))}
        {campaigns.length === 0 && (
          <div className="col-span-full text-center py-20 font-mono text-xs text-muted-foreground tracking-widest">
            NO CAMPAIGNS YET. HIT NEW CAMPAIGN.
          </div>
        )}
      </div>

      {show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setShow(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-panel border border-blood p-6 w-[480px] scanlines space-y-3 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="font-display text-3xl tracking-wider">
              {draft.id ? "EDIT" : "NEW"} CAMPAIGN
            </h3>
            <Field label="NAME">
              <input
                value={draft.name ?? ""}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PLATFORM">
                <input
                  value={draft.platform ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, platform: e.target.value })
                  }
                  className="w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
                />
              </Field>
              <Field label="PAYOUT RATE">
                <input
                  value={draft.payout_rate ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, payout_rate: e.target.value })
                  }
                  className="w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
                />
              </Field>
              <Field label="BUDGET TOTAL">
                <input
                  type="number"
                  value={draft.budget_total ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      budget_total: Number(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
                />
              </Field>
              <Field label="BUDGET REMAINING">
                <input
                  type="number"
                  value={draft.budget_remaining ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      budget_remaining: Number(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
                />
              </Field>
            </div>
            <Field label="REQUIREMENTS">
              <textarea
                value={draft.requirements ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, requirements: e.target.value })
                }
                rows={3}
                className="w-full bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
              />
            </Field>
            <Field label="STATUS">
              <select
                value={draft.status ?? "active"}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value })
                }
                className="bg-background border border-blood/60 px-3 py-2 font-mono text-sm focus:border-blood focus:outline-none"
              >
                <option value="active">ACTIVE</option>
                <option value="paused">PAUSED</option>
                <option value="complete">COMPLETE</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShow(false)}
                className="px-4 py-2 text-xs font-mono tracking-widest border border-border text-muted-foreground"
              >
                CANCEL
              </button>
              <button
                disabled={!draft.name || save.isPending}
                onClick={() => save.mutate(draft)}
                className="px-4 py-2 text-xs font-mono tracking-widest bg-blood text-blood-foreground hover:shadow-glow-red disabled:opacity-50"
              >
                {save.isPending ? "SAVING…" : "SAVE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground tracking-widest">{label}</span>
      <span className="text-gold">{v}</span>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] font-mono text-muted-foreground tracking-widest">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
