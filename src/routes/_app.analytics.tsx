import { createFileRoute } from "@tanstack/react-router";
import { Stub } from "./_app.template";

export const Route = createFileRoute("/_app/analytics")({
  component: () => (
    <Stub
      title="ANALYTICS"
      note="Clips/day, approval rate, avg score by streamer, top approved clips. Wires to real data next pass."
    />
  ),
});
