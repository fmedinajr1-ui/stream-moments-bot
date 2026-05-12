import { createFileRoute } from "@tanstack/react-router";
import { Stub } from "./_app.template";

export const Route = createFileRoute("/_app/library")({
  component: () => (
    <Stub
      title="LIBRARY"
      note="Approved clips with download buttons (MP4, metadata.json, CapCut manifest). Builds in Step 6."
    />
  ),
});
