import { startRenderForClip } from "../src/lib/render-runner.server";
const ids = ["f3073ebc-d3a1-457c-a209-2de2b42289c5","bb2eac07-befc-4ba3-a0d2-e7b5d986310e"];
for (const id of ids) {
  console.log(id, JSON.stringify(await startRenderForClip(id)));
}
