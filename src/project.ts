import { makeProject } from "@motion-canvas/core";
import { headlessPlugin } from "./headlessExporter";
import "./global.css";
import signal from "./scenes/signal?scene";

// Only one scene is registered on purpose. Scenes are concatenated in order, so
// a second one would push every absolute timing in `signal` later by its
// duration. `scenes/example.tsx` is kept on disk as the harness smoke test —
// swap it in here if the renderer itself ever needs debugging.
export default makeProject({
  scenes: [signal],
  // Registered here rather than in vite.config: editorBootstrap() merges
  // config.plugins, which is what puts the exporter on
  // project.meta.rendering.exporter.exporters where the Renderer looks it up.
  plugins: [headlessPlugin()],
});
