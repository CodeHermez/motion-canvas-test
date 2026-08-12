import { Renderer, Vector2 } from "@motion-canvas/core";
import type { RendererSettings } from "@motion-canvas/core";
import { BRIDGE_EXPORTER_ID } from "./headlessExporter";
// NOT "./project" — the plugin only runs bootstrap() on the `?project` query,
// and Renderer needs a bootstrapped Project, not the raw settings object.
import project from "./project?project";

/**
 * Headless render bridge.
 *
 * Motion Canvas ships rendering as a button in its browser editor; there is no
 * CLI (upstream issues #415 / #1218). `Renderer` is public though, so driving
 * it from a page we control — paired with the custom exporter in
 * ./headlessExporter — gives a real headless pipeline.
 *
 * scripts/render.mjs loads this page in Chrome and calls window.mc.
 */

export type ShotOptions = {
  width: number;
  height: number;
  fps: number;
  from: number;
  to: number;
  background: string | null;
  scale: number;
};

const renderer = new Renderer(project);

const toSettings = (o: ShotOptions): RendererSettings => ({
  name: "shot",
  size: new Vector2(o.width, o.height),
  resolutionScale: o.scale,
  colorSpace: "srgb",
  background: o.background,
  range: [o.from, o.to],
  fps: o.fps,
  exporter: { name: BRIDGE_EXPORTER_ID, options: {} },
});

declare global {
  interface Window {
    __saveFrame?: (name: string, dataUrl: string) => Promise<void>;
    mc: {
      renderRange(o: ShotOptions): Promise<void>;
      renderStill(o: ShotOptions, time: number): Promise<void>;
    };
    mcReady: boolean;
  }
}

window.mc = {
  async renderRange(o) {
    await renderer.render(toSettings(o));
  },
  async renderStill(o, time) {
    // Renderer.renderFrame() is unusable here — it hardcodes the same dead
    // `import.meta.hot` branch. A one-frame range through the normal render
    // path gets the same result and actually writes a file.
    await renderer.render(
      toSettings({ ...o, from: time, to: time + 1 / o.fps }),
    );
  },
};

// Gate readiness on the webfont. Canvas fillText() silently falls back to a
// system font if the face hasn't loaded yet, so without this the opening frames
// render in the wrong typeface and nothing errors.
Promise.all([
  document.fonts.load('700 128px "Space Grotesk"'),
  document.fonts.load('400 128px "Space Grotesk"'),
])
  .then(() => document.fonts.ready)
  .catch(() => undefined)
  .then(() => {
    window.mcReady = true;
  });
