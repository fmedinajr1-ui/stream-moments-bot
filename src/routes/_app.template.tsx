import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/template")({
  component: () => (
    <Stub title="OVERLAY TEMPLATE — FIGHT NIGHT" note="Live preview + control panel comes online next pass." />
  ),
});

export function Stub({ title, note }: { title: string; note: string }) {
  return (
    <div className="space-y-6">
      <div className="border-b border-blood/40 pb-4">
        <h2 className="font-display text-2xl sm:text-3xl md:text-4xl tracking-wider">{title}</h2>
      </div>
      <div className="bg-panel border border-blood/40 p-12 text-center scanlines">
        <p className="font-mono text-sm text-muted-foreground tracking-widest">{note}</p>
      </div>
    </div>
  );
}
