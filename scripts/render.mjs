// Headless renderer for Motion Canvas.
//
//   node scripts/render.mjs                      full range -> output/shot/*.png
//   node scripts/render.mjs --still 1.2          one frame at t=1.2s
//   node scripts/render.mjs --to 4 --fps 30      override defaults
//   node scripts/render.mjs --mp4                stitch the PNGs into an mp4
//
// Spawns Vite, drives Chrome via puppeteer-core, shuts both down. One command,
// no editor, no clicking.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9000;
const URL = `http://localhost:${PORT}/render.html`;

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

if (!CHROME) {
  console.error("No Chrome or Edge found. Set CHROME manually in this script.");
  process.exit(1);
}

/* ---------------- args ---------------- */
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const opts = {
  width: Number(flag("width", 1920)),
  height: Number(flag("height", 1080)),
  fps: Number(flag("fps", 60)),
  from: Number(flag("from", 0)),
  // Duration lives on a private PlaybackManager, so there is no clean way to
  // ask the project how long it is. Pass --to; the default is just a fallback.
  to: Number(flag("to", 3)),
  background: flag("bg", "#09090B"),
  scale: Number(flag("scale", 1)),
};
const stillAt = has("still") ? Number(flag("still", 0)) : null;

/* ---------------- vite ---------------- */
// Spawn Vite's JS entry through Node rather than the npx shim: Node on Windows
// refuses to spawn .cmd files without shell:true, and shell:true brings its own
// quoting problems.
const viteBin = join(ROOT, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(
  process.execPath,
  [viteBin, "--port", String(PORT), "--strictPort"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);

// Poll the port rather than scraping stdout — Vite colours the port number
// separately, so ANSI escapes land inside "localhost:9000" and substring
// matching silently never fires.
let viteLog = "";
vite.stdout.on("data", (b) => (viteLog += b));
vite.stderr.on("data", (b) => (viteLog += b));

let viteDead = null;
vite.on("exit", (c) => (viteDead = c));

const waitForServer = async () => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (viteDead !== null) {
      throw new Error(`vite exited early (${viteDead})\n${viteLog}`);
    }
    try {
      const res = await fetch(`http://localhost:${PORT}/render.html`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not start in 60s\n${viteLog}`);
};

const shutdown = () => {
  if (!vite.killed) vite.kill();
};

/* ---------------- run ---------------- */
let browser;
try {
  await waitForServer();

  // Clear previous frames so a short render can't leave a long one's tail behind.
  const outDir = join(ROOT, "output", "shot");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader", // some 2D nodes touch WebGL
      "--disable-dev-shm-usage",
      `--window-size=${opts.width},${opts.height}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on("pageerror", (e) => console.error("[page]", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("[console]", m.text());
  });
  page.on("response", (r) => {
    if (r.status() === 404) console.warn("[404]", r.url());
  });

  // The exporter in src/headlessExporter.ts calls this. Must be registered
  // before navigation so it exists by the time the page's module runs.
  let written = 0;
  await page.exposeFunction("__saveFrame", async (name, dataUrl) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    await writeFile(join(outDir, `${name}.png`), Buffer.from(base64, "base64"));
    written++;
  });

  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.waitForFunction("window.mcReady === true", { timeout: 60_000 });

  const started = Date.now();
  if (stillAt === null) {
    console.log(
      `rendering ${opts.from}s -> ${opts.to}s @ ${opts.fps}fps  ${opts.width}x${opts.height}`,
    );
    await page.evaluate((o) => window.mc.renderRange(o), opts);
  } else {
    console.log(`still at t=${stillAt}s  ${opts.width}x${opts.height}`);
    await page.evaluate(
      (o, t) => window.mc.renderStill(o, t),
      opts,
      stillAt,
    );
  }

  const frames = existsSync(outDir) ? readdirSync(outDir).length : 0;
  console.log(
    `done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${frames} frame(s) in output/shot (${written} written)`,
  );
  if (frames === 0) {
    throw new Error("no frames were exported — the exporter never fired");
  }

  if (has("mp4")) {
    await browser.close();
    browser = null;
    shutdown();
    const { default: ffmpegPath } = await import("@ffmpeg-installer/ffmpeg")
      .then((m) => ({ default: m.default?.path ?? m.path }))
      .catch(() => ({ default: "ffmpeg" }));
    await new Promise((ok, fail) => {
      const ff = spawn(
        ffmpegPath,
        [
          "-y", "-framerate", String(opts.fps),
          "-i", join(outDir, "%06d.png"),
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
          join(ROOT, "output", "shot.mp4"),
        ],
        { stdio: "inherit" },
      );
      ff.on("exit", (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`))));
    });
    console.log("wrote output/shot.mp4");
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  shutdown();
}
