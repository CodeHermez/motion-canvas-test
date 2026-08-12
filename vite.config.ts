import ffmpegPkg from "@motion-canvas/ffmpeg";
import motionCanvasPkg from "@motion-canvas/vite-plugin";
import { defineConfig } from "vite";

// Both plugins are CommonJS with `exports.default`. Node's ESM loader hands
// back the whole module.exports object (it does not honour __esModule), so a
// plain default import yields `{default: fn}` instead of `fn`.
const motionCanvas =
  (motionCanvasPkg as unknown as { default?: typeof motionCanvasPkg }).default ??
  motionCanvasPkg;
const ffmpeg =
  (ffmpegPkg as unknown as { default?: typeof ffmpegPkg }).default ?? ffmpegPkg;

export default defineConfig({
  plugins: [motionCanvas(), ffmpeg()],
  server: { port: 9000 },
});
