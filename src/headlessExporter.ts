import { ObjectMetaField } from "@motion-canvas/core";
import type {
  Exporter,
  ExporterClass,
  Plugin,
  Project,
  RendererSettings,
} from "@motion-canvas/core";

/**
 * A frame exporter that hands PNGs straight to Node.
 *
 * The stock `ImageExporter` ships frames over Vite's HMR socket, guarded by
 * `if (import.meta.hot)`. That guard is never true inside `@motion-canvas/core`
 * because Vite pre-bundles dependencies and does not inject an HMR context into
 * them — so frames are dropped silently, with no error and no output. The same
 * dead branch exists in `Renderer.renderFrame`, which is why single-frame
 * export can't be used either.
 *
 * This exporter sidesteps all of it: `handleFrame` calls a function that
 * Puppeteer exposed on `window`, and Node writes the file. No HMR, no sockets.
 */
class BridgeExporter implements Exporter {
  public static readonly id = "headless/bridge";
  public static readonly displayName = "Headless bridge";

  public static meta(_project: Project) {
    return new ObjectMetaField("Headless bridge", {});
  }

  public static async create(_project: Project, _settings: RendererSettings) {
    return new BridgeExporter();
  }

  public async handleFrame(canvas: HTMLCanvasElement, frame: number) {
    const name = frame.toString().padStart(6, "0");
    // Awaited, so frames land on disk in order and stop() can't outrun them.
    await window.__saveFrame?.(name, canvas.toDataURL("image/png"));
  }
}

export const BRIDGE_EXPORTER_ID = BridgeExporter.id;

export function headlessPlugin(): Plugin {
  return {
    name: "headless-bridge",
    exporters: () => [BridgeExporter as unknown as ExporterClass],
  };
}
