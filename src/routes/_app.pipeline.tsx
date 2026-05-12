import { createFileRoute } from "@tanstack/react-router";
import { Stub } from "./_app.template";

export const Route = createFileRoute("/_app/pipeline")({
  component: () => (
    <Stub
      title="PIPELINE"
      note="Clip flow processing → pending → approved → downloaded. Visual board ships next pass."
    />
  ),
});
