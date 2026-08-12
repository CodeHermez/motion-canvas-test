# motion-canvas-test

Motion Canvas 3.17.2 — **with headless CLI rendering**, which upstream does not
have. Current scene: `src/scenes/signal.tsx`, a 12s 1920×1080 piece at 120 BPM.

## Commands

```bash
npm run render:signal                         # 12s @ 60fps -> output/shot.mp4
npm run preview                               # 12s @ 20fps, half scale, PNGs only
npm run render -- --still 6.5                 # one frame at t = 6.5s
npm run typecheck
npm start                                     # the normal browser editor
```

Flags: `--width --height --fps --from --to --scale --bg --still --mp4`.
There is no `--to` auto-detect — duration lives on a private `PlaybackManager`,
so pass it explicitly.

## Why there is a custom renderer

Motion Canvas renders from a **button in its browser editor**. There is no CLI
(upstream [#415](https://github.com/motion-canvas/motion-canvas/issues/415),
[#1218](https://github.com/motion-canvas/motion-canvas/issues/1218)). That is
fine for a human and useless for automation.

`scripts/render.mjs` spawns Vite, drives Chrome through `puppeteer-core`, renders,
and shuts everything down. One command, no clicking.

Four things had to be solved, each of which fails **silently**:

1. **`import.meta.hot` is the whole problem.** The stock `ImageExporter` ships
   frames over Vite's HMR socket behind `if (import.meta.hot)`. That guard is
   never true inside `@motion-canvas/core`, because Vite pre-bundles dependencies
   and doesn't give them an HMR context. Result: rendering "succeeds" in 0.1s and
   writes zero files, with no error. `Renderer.renderFrame()` has the same dead
   branch, so single-frame export is unusable too.
   → `src/headlessExporter.ts` implements the public `Exporter` interface and
   calls a Puppeteer-exposed `window.__saveFrame`. Node writes the PNG. No HMR.

2. **Exporters resolve from project plugins.** `Renderer.run()` looks in
   `project.meta.rendering.exporter.exporters`, populated from plugins. Crucially
   only `editorBootstrap()` merges `config.plugins` — the production `bootstrap()`
   overwrites them. Dev server = `editorBootstrap`, so registering the plugin in
   `makeProject({plugins: [...]})` works.

3. **`?project`, not `./project`.** The Vite plugin only runs bootstrap on the
   `?project` query. Importing `./project` gives raw `ProjectSettings`, and
   `new Renderer()` needs a bootstrapped `Project`.

4. **Both Vite plugins are CJS with `exports.default`.** Node's ESM loader hands
   back the whole `module.exports`, so a plain default import yields `{default: fn}`
   and Vite dies with "motionCanvas is not a function". `vite.config.ts` unwraps it.

Smaller ones: Node on Windows won't `spawn` a `.cmd`, so Vite is launched via
`node node_modules/vite/bin/vite.js`; and the server-ready check polls the port
rather than scraping stdout, because Vite colours the port number and ANSI escapes
land inside the string you'd match on.

A `404 /favicon.ico` in the log is expected and harmless.

## Performance

169 frames at 1920×1080/60fps in **~6s** — roughly 2× realtime, and noticeably
faster than the equivalent SVG-based Remotion scene.

## The scene: `signal.tsx`

Noise → scan → breakout → outro, 12s at 120 BPM (beat 0.5s, eighth 0.25s).
Everything is drawn from math; the only external asset is a self-hosted woff2.

Four things in it are worth reusing:

**Absolute-time acts.** Each act is spawned at its exact second with
`yield delay(t, act())`, and the main thread just holds 12s. Chaining acts with
`yield*` instead makes every duration error downstream of it shift every
remaining beat. With `delay`, a mistake stays local.

**Threads cancel their children.** `yield someGen()` inside a generator that
then returns will *kill* `someGen` mid-flight — its cleanup never runs. The
whip-pan streaks froze on screen for exactly this reason. If a spawned thread
owns cleanup, `yield*` it.

**tabular-nums does not exist here.** Motion Canvas draws text with
`fillText()`, and `context.font` is a CSS font shorthand — it cannot carry
`font-variant-numeric`. So the counter reimplements it: one fixed-width cell per
glyph, blanks collapsed to zero width, row right-anchored. Digits then cannot
shift as the value climbs.

**Fonts must be gated.** `fillText` silently falls back to a system font if the
face has not loaded, and nothing errors — the frames are just wrong. The
harness now waits on `document.fonts` before setting `mcReady`.

Simulated motion blur, since Motion Canvas has no equivalent of
`@remotion/motion-blur`: `easeInExpo` into `easeOutExpo` over 0.1s + 0.1s (both
curves are at maximum velocity where they meet, which is the shape of a real
whip) plus a burst of procedural streak bars travelling the same direction.

## Why the authoring model is good

`src/scenes/example.tsx` is the smoke test. The point is that time reads
top-to-bottom:

```tsx
yield* all(                       // concurrently
  label().fontSize(96, 0.6, easeOutCubic),
  bar().width(620, 0.6, easeOutCubic),
);
yield* dot().position.x(560, 0.9);  // then this
yield* waitFor(0.3);                // then wait
```

Compare with computing every property from a frame number. Sequencing bugs mostly
stop being possible.
