import { Circle, Line, Node, Rect, Txt, makeScene2D } from "@motion-canvas/2d";
import {
  Vector2,
  all,
  chain,
  createRef,
  createSignal,
  delay,
  easeInExpo,
  easeInOutCubic,
  easeInOutQuad,
  easeOutCubic,
  easeOutExpo,
  linear,
  range,
  useRandom,
  waitFor,
} from "@motion-canvas/core";
import type { ThreadGenerator } from "@motion-canvas/core";

/**
 * "Signal in the noise" — 12s, 1920x1080, 120 BPM.
 *
 * Everything on screen is drawn from math: no images, no SVG paths, no
 * external assets beyond one self-hosted woff2.
 *
 * Timing architecture: each act is spawned as a background thread at its exact
 * absolute second via `yield delay(t, ...)`, and the main thread just holds for
 * 12s. That means a duration mistake inside one act cannot shift the ones after
 * it — the alternative (a long chain of `yield*`) accumulates drift and every
 * beat downstream drifts with it.
 */

/* ------------------------------------------------------------------ tokens */

const BEAT = 0.5; // 120 BPM
const HALF = BEAT / 2; // 0.25s — the scan grid

const BG = "#0A0A0A";
const GREEN = "#00FF88";
const BLUE = "#0088FF";
const GRAY = "#444444";
const CYAN = "#00FFFF";
const WHITE = "#FFFFFF";
const FONT = 'Space Grotesk, "Segoe UI", sans-serif';

/* ------------------------------------------------------------------ layout */

const N = 220; // waveform samples
const X0 = -880;
const X1 = 880;
const BASE_Y = 170; // the horizontal baseline
const PEAK_Y = -400; // where the breakout curve tops out

const COLS = 4;
const ROWS = 3;
const GAP_X = 190;
const GAP_Y = 140;
const GRID_HOME = new Vector2(0, -150);
const GRID_PARK = new Vector2(-640, -70);
const WIN_ROW = 1;
const WIN_COL = 2;
const WIN = WIN_ROW * COLS + WIN_COL;

const nodeAt = (r: number, c: number) =>
  new Vector2((c - (COLS - 1) / 2) * GAP_X, (r - (ROWS - 1) / 2) * GAP_Y);

const COUNT_FS = 128;
const DIGIT_W = COUNT_FS * 0.62;
const SLOTS = 6; // "$1,200" — widest state before the '+'

const WORDS = ["DETECT.", "ANIMATE.", "PROFIT."];
const WORD_FS = 128;

export default makeScene2D(function* (view) {
  view.fill(BG);

  /* ---------------------------------------------------------- procedural */

  // Fixed seed: the noise must be identical on every render, otherwise the
  // waveform is literal static rather than a signal.
  const rnd = useRandom(20260812);
  const TABLE = rnd.floatArray(1024, -1, 1);
  const tbl = (i: number) => TABLE[((i % 1024) + 1024) % 1024];

  /** Value noise — hashed lattice with smoothstep between samples. */
  const vnoise = (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return tbl(i) * (1 - u) + tbl(i + 1) * u;
  };

  const clock = createSignal(0); // drives the idle oscillation
  const rise = createSignal(0); // 0 = noise, 1 = breakout curve

  /** Chaotic ticker: three sines plus two octaves of value noise. */
  const wobble = (u: number, t: number) => {
    const x = X0 + u * (X1 - X0);
    return (
      0.95 *
      (26 * Math.sin(x * 0.011 + t * 1.25) +
        15 * Math.sin(x * 0.037 - t * 2.05) +
        9 * Math.sin(x * 0.089 + t * 3.4) +
        36 * vnoise(u * 78 + t * 2.2) +
        // Deliberately undersampled — 300 lattice cells across 220 points, so
        // consecutive samples land in different cells and the trace spikes
        // instead of undulating. That is what makes it read as a ticker.
        16 * vnoise(u * 300 - t * 5.0))
    );
  };

  /** The signal: pow(u, 3.1) so it stays flat then goes near-vertical. */
  const climb = (u: number, t: number) =>
    -Math.pow(u, 3.1) * (BASE_Y - PEAK_Y) + 9 * u * vnoise(u * 120 + t * 1.1);

  /**
   * Blend noise -> curve. The `-u * 0.55` term makes the transformation sweep
   * left to right instead of the whole line lifting at once, so it reads as
   * the signal propagating rather than a crossfade.
   */
  const shape = (u: number, t: number, r: number) => {
    const sweep = Math.min(1, Math.max(0, r * 1.9 - u * 0.55));
    const s = sweep * sweep * (3 - 2 * sweep);
    return BASE_Y + wobble(u, t) * (1 - s) + climb(u, t) * s;
  };

  const points = createSignal(() => {
    const t = clock();
    const r = rise();
    return range(N).map((k) => {
      const u = k / (N - 1);
      return new Vector2(X0 + u * (X1 - X0), shape(u, t, r));
    });
  });

  /* -------------------------------------------------------------- counter */

  const amount = createSignal(100);
  const padded = createSignal(() =>
    ("$" + Math.round(amount()).toLocaleString("en-US")).padStart(SLOTS, " "),
  );

  // Motion Canvas draws text with fillText(), and context.font cannot carry
  // font-variant-numeric — so `tabular-nums` is simply unavailable here. This
  // reimplements it: every glyph sits in its own fixed-width cell, blanks
  // collapse to zero, and the whole row is right-anchored. Digits therefore
  // cannot shift horizontally as the value climbs.
  const slotW = (i: number) => () => {
    const ch = padded()[i];
    if (ch === " ") return 0;
    if (ch === ",") return DIGIT_W * 0.42;
    return DIGIT_W;
  };

  /* ----------------------------------------------------------------- refs */

  const world = createRef<Node>();
  const streaks = createRef<Node>();
  const baseline = createRef<Line>();
  const ticks = createRef<Node>();
  const rules = createRef<Node>();
  const wave = createRef<Line>();
  const tip = createRef<Circle>();
  const grid = createRef<Node>();
  const scanBar = createRef<Line>();
  const counter = createRef<Node>();
  const plus = createRef<Txt>();

  const nodes: Circle[] = [];
  const links: Line[] = [];

  /* ------------------------------------------------------------ the scene */

  view.add(
    <Node ref={world}>
      {/* dashboard rules — faint, full height */}
      <Node ref={rules} opacity={0}>
        {range(13).map((i) => {
          const x = -900 + i * 150;
          return (
            <Line
              points={[
                [x, -540],
                [x, 540],
              ]}
              stroke={GRAY}
              lineWidth={1}
            />
          );
        })}
      </Node>

      <Line
        ref={baseline}
        points={[
          [-940, BASE_Y],
          [940, BASE_Y],
        ]}
        stroke={GRAY}
        lineWidth={2}
        opacity={0.55}
        end={0}
      />

      <Node ref={ticks} opacity={0}>
        {range(23).map((i) => {
          const x = -880 + i * 80;
          const tall = i % 4 === 0;
          return (
            <Line
              points={[
                [x, BASE_Y - (tall ? 16 : 8)],
                [x, BASE_Y + (tall ? 16 : 8)],
              ]}
              stroke={GRAY}
              lineWidth={2}
            />
          );
        })}
      </Node>

      <Line
        ref={wave}
        points={points}
        stroke={GRAY}
        lineWidth={3}
        lineCap="round"
        lineJoin="round"
        opacity={0.85}
        shadowColor={GRAY}
        shadowBlur={0}
        end={0}
      />

      <Circle
        ref={tip}
        size={22}
        fill={GREEN}
        shadowColor={GREEN}
        shadowBlur={40}
        opacity={0}
        position={() => new Vector2(X1, shape(1, clock(), rise()))}
      />

      {/* neural grid */}
      <Node ref={grid} position={GRID_HOME}>
        {/* links first so they sit behind the nodes */}
        {(() => {
          const link = (a: Vector2, b: Vector2, weak: boolean) => {
            const l = (
              <Line
                points={[a, b]}
                stroke={BLUE}
                lineWidth={weak ? 1 : 2}
                opacity={0}
                end={0}
              />
            ) as Line;
            links.push(l);
            return l;
          };
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              if (c < COLS - 1) link(nodeAt(r, c), nodeAt(r, c + 1), false);
              if (r < ROWS - 1) link(nodeAt(r, c), nodeAt(r + 1, c), false);
              if (c < COLS - 1 && r < ROWS - 1) {
                link(nodeAt(r, c), nodeAt(r + 1, c + 1), true);
                link(nodeAt(r + 1, c), nodeAt(r, c + 1), true);
              }
            }
          }
          return links;
        })()}

        {range(ROWS * COLS).map((i) => {
          const c = (
            <Circle
              size={26}
              fill={BLUE}
              shadowColor={BLUE}
              shadowBlur={22}
              position={nodeAt(Math.floor(i / COLS), i % COLS)}
              opacity={0}
              scale={0.2}
            />
          ) as Circle;
          nodes.push(c);
          return c;
        })}

        <Line
          ref={scanBar}
          points={[
            [0, -GAP_Y * 1.15],
            [0, GAP_Y * 1.15],
          ]}
          stroke={WHITE}
          lineWidth={2}
          shadowColor={WHITE}
          shadowBlur={20}
          opacity={0}
          x={nodeAt(0, 0).x}
        />
      </Node>

      {/* counter — right-anchored so the digits never move */}
      <Node ref={counter} x={880} y={398} opacity={0}>
        <Rect layout direction="row" alignItems="center" offsetX={1}>
          {range(SLOTS).map((i) => (
            <Rect
              width={slotW(i)}
              height={COUNT_FS * 1.3}
              justifyContent="center"
              alignItems="center"
            >
              <Txt
                text={() => padded()[i] ?? " "}
                fontFamily={FONT}
                fontWeight={700}
                fontSize={COUNT_FS}
                fill={WHITE}
              />
            </Rect>
          ))}
          <Rect
            width={DIGIT_W * 0.78}
            height={COUNT_FS * 1.3}
            justifyContent="center"
            alignItems="center"
          >
            <Txt
              ref={plus}
              text="+"
              fontFamily={FONT}
              fontWeight={700}
              fontSize={COUNT_FS}
              fill={GREEN}
              shadowColor={GREEN}
              shadowBlur={0}
              opacity={0}
            />
          </Rect>
        </Rect>
      </Node>
    </Node>,
  );

  view.add(<Node ref={streaks} />);

  /* --------------------------------------------------------------- outro */

  // Measure the words first. Motion Canvas resolves a Txt's size from a real
  // DOM element, so this is the actual rendered width — no guessing at advance
  // widths, and the phrase centres exactly.
  const holder = (<Node opacity={0} />) as Node;
  view.add(holder);
  const words = WORDS.map((w) => {
    const t = (
      <Txt
        text={w}
        fontFamily={FONT}
        fontWeight={700}
        fontSize={WORD_FS}
        letterSpacing={-4}
        fill={WHITE}
        shadowColor={WHITE}
        shadowBlur={0}
      />
    ) as Txt;
    holder.add(t);
    return t;
  });
  const wdt = words.map((t) => t.width());
  const hgt = Math.max(...words.map((t) => t.height()));

  const WORD_GAP = 38;
  const outro = (<Node />) as Node;
  view.add(outro);
  const masks: Rect[] = [];
  const maskH = hgt + 30;

  let cx = -(wdt.reduce((a, b) => a + b, 0) + WORD_GAP * (WORDS.length - 1)) / 2;
  words.forEach((t, i) => {
    const m = (
      <Rect
        layout={false}
        clip
        width={wdt[i] + WORD_GAP}
        height={maskH}
        x={cx + wdt[i] / 2}
        y={0}
      />
    ) as Rect;
    t.position([0, maskH]); // parked below the clip edge
    m.add(t);
    outro.add(m);
    masks.push(m);
    cx += wdt[i] + WORD_GAP;
  });
  holder.remove();

  /* ------------------------------------------------------------- helpers */

  /**
   * Hand-rolled speed cue. Motion Canvas has no motion-blur node, so a fast
   * move gets sold two ways: easeInExpo into easeOutExpo (both curves are at
   * maximum velocity where they meet, which is what a whip actually looks
   * like), plus a burst of streaks travelling the same direction.
   */
  function* streakBurst(dir: number, dur: number, count: number) {
    const layer = streaks();
    const bars = range(count).map(() => {
      const h = rnd.nextFloat(2, 6);
      const w = rnd.nextFloat(240, 820);
      const y = rnd.nextFloat(-520, 520);
      const jitter = rnd.nextFloat(-300, 300);
      const hot = rnd.nextFloat() > 0.68;
      const peak = rnd.nextFloat(0.22, 0.6);
      const r = (
        <Rect
          width={w}
          height={h}
          radius={h / 2}
          y={y}
          x={-dir * 1500 + jitter}
          fill={hot ? BLUE : GRAY}
          opacity={0}
        />
      ) as Rect;
      layer.add(r);
      return { r, jitter, peak };
    });

    yield* all(
      ...bars.map(({ r, jitter, peak }) =>
        all(
          r.position.x(dir * 1500 + jitter, dur, easeInOutQuad),
          chain(
            r.opacity(peak, dur * 0.35),
            r.opacity(0, dur * 0.65),
          ),
        ),
      ),
    );
    layer.removeChildren();
  }

  function* whip(dist: number) {
    yield* all(
      chain(
        world().position.x(dist, 0.1, easeInExpo),
        world().position.x(0, 0.1, easeOutExpo),
      ),
      chain(
        world().scale(1.045, 0.1, easeInExpo),
        world().scale(1, 0.1, easeOutExpo),
      ),
      streakBurst(Math.sign(dist), 0.2, 20),
    );
  }

  /** One 0.25s scan pulse — white flash, scale kick, glow bloom. */
  function flashSet(idx: number[]): ThreadGenerator {
    return all(
      ...idx.map((i) => {
        const n = nodes[i];
        return all(
          chain(n.fill(WHITE, 0.06), n.fill(BLUE, 0.19)),
          chain(
            n.scale(1.5, 0.06, easeOutCubic),
            n.scale(1, 0.19, easeInOutCubic),
          ),
          chain(n.shadowBlur(64, 0.06), n.shadowBlur(22, 0.19)),
        );
      }),
    );
  }

  /* ------------------------------------------------------------- act one */
  /* 0.0 - 3.0   market noise                                              */

  function* actNoise() {
    yield* all(
      baseline().end(1, 0.6, easeOutCubic),
      delay(0.15, wave().end(1, 1.0, easeOutCubic)),
      delay(0.2, rules().opacity(0.11, 0.9)),
      delay(0.35, ticks().opacity(0.5, 0.7)),
    );
  }

  /* ------------------------------------------------------------- act two */
  /* 3.0 - 5.0   neural network scan                                       */

  function* popNodes() {
    yield* all(
      ...nodes.map((n, i) =>
        delay(
          i * 0.012,
          all(n.opacity(1, 0.18), n.scale(1, 0.24, easeOutCubic)),
        ),
      ),
    );
  }

  function* drawLinks() {
    yield* all(
      ...links.map((l, i) =>
        delay(
          (i % 7) * 0.03,
          all(
            l.end(1, 0.45, easeOutCubic),
            l.opacity(l.lineWidth() > 1 ? 0.32 : 0.14, 0.45),
          ),
        ),
      ),
    );
  }

  function* scanSweep() {
    // Six pulses, one every 0.25s (an eighth note at 120 BPM), running
    // 3.50 -> 5.00 absolute. Four column sweeps cover all twelve nodes, then
    // two narrowing pulses land the last flash exactly on 5.0.
    yield scanBar().opacity(0.7, 0.12);
    yield delay(
      0.02,
      scanBar().position.x(nodeAt(0, COLS - 1).x, 4 * HALF - 0.04, linear),
    );

    for (let c = 0; c < COLS; c++) {
      yield* flashSet(range(ROWS).map((r) => r * COLS + c));
    }

    yield scanBar().opacity(0, 0.2);
    yield* flashSet(range(COLS).map((c) => WIN_ROW * COLS + c));
    yield* flashSet([WIN]);
  }

  function* actScan() {
    yield whip(-420);
    yield delay(0.2, popNodes());
    yield delay(0.35, drawLinks());
    yield delay(0.5, scanSweep());
    yield* waitFor(2.0);
  }

  /* ----------------------------------------------------------- act three */
  /* 5.0 - 9.0   the signal breakthrough                                   */

  function* breakthrough() {
    const win = nodes[WIN];
    const ring = (
      <Circle
        size={30}
        stroke={GREEN}
        lineWidth={5}
        opacity={0.95}
        position={nodeAt(WIN_ROW, WIN_COL)}
      />
    ) as Circle;
    grid().add(ring);

    yield* all(
      win.fill(GREEN, 0.18),
      win.shadowColor(GREEN, 0.18),
      win.scale(2.1, 0.4, easeOutCubic),
      win.shadowBlur(90, 0.4),
      ring.size(360, 0.9, easeOutCubic),
      ring.lineWidth(1, 0.9),
      ring.opacity(0, 0.9),
      ...nodes
        .filter((_, i) => i !== WIN)
        .map((n) => n.opacity(0.22, 0.5)),
      ...links.map((l) => l.opacity(0.07, 0.5)),
      // Park the grid left so the curve owns the diagonal it needs.
      grid().position(GRID_PARK, 0.8, easeInOutCubic),
      grid().scale(0.62, 0.8, easeInOutCubic),
    );
    ring.remove();
  }

  function* riseCurve() {
    yield* all(
      rise(1, 1.5, easeInOutCubic),
      wave().stroke(GREEN, 0.7),
      wave().shadowColor(GREEN, 0.5),
      wave().lineWidth(6, 0.9),
      wave().opacity(1, 0.5),
      wave().shadowBlur(40, 1.0),
      delay(0.3, baseline().opacity(0.22, 0.6)),
      delay(0.3, ticks().opacity(0.22, 0.6)),
      delay(0.7, tip().opacity(1, 0.4)),
    );
  }

  function* countUp() {
    yield* all(
      counter().opacity(1, 0.3),
      counter().position.y(360, 0.4, easeOutCubic),
      amount(1200, 1.5, easeInOutCubic),
    );
  }

  function* plusPop() {
    yield* all(
      plus().opacity(1, 0.14),
      chain(
        plus().shadowBlur(48, 0.14),
        plus().shadowBlur(16, 0.16),
      ),
      chain(
        plus().scale(1.25, 0.14, easeOutCubic),
        plus().scale(1, 0.16, easeInOutCubic),
      ),
    );
  }

  /** Four beats of held glow: 7.0, 7.5, 8.0, 8.5. */
  function* holdPulses() {
    for (let i = 0; i < 4; i++) {
      yield* all(
        chain(
          tip().scale(1.55, 0.12, easeOutCubic),
          tip().scale(1, BEAT - 0.12, easeInOutCubic),
        ),
        chain(
          wave().shadowBlur(66, 0.12),
          wave().shadowBlur(40, BEAT - 0.12),
        ),
      );
    }
  }

  function* actSignal() {
    yield breakthrough();
    yield riseCurve();
    yield countUp();
    yield delay(1.5, plusPop());
    yield delay(1.5, world().scale(1.02, 2.5, easeInOutCubic));
    yield delay(2.0, holdPulses());
    yield* waitFor(4.0);
  }

  /* ------------------------------------------------------------ act four */
  /* 9.0 - 12.0   kinetic typography outro                                 */

  function* exitGraphs() {
    // streakBurst must be awaited, not spawned: a finished thread cancels its
    // children, so `yield streakBurst(...)` would kill it at 0.18s — mid-flight,
    // before its cleanup runs — and leave the bars frozen on screen.
    yield* all(
      streakBurst(-1, 0.3, 26),
      world().position.x(-2400, 0.18, easeInExpo),
      world().opacity(0, 0.18),
    );
  }

  function* profitHit() {
    const p = words[2];
    yield* all(
      p.fill(CYAN, 0.12),
      chain(p.shadowBlur(60, 0.15), p.shadowBlur(24, 0.15)),
      chain(
        p.scale(1.05, 0.15, easeOutCubic),
        p.scale(1, 0.15, easeInOutCubic),
      ),
    );
  }

  function* actOutro() {
    yield exitGraphs();

    // Masked reveals landing on eighth notes: 9.50 / 9.75 / 10.00 absolute.
    yield delay(0.2, words[0].position.y(0, 0.3, easeOutExpo));
    yield delay(0.45, words[1].position.y(0, 0.3, easeOutExpo));
    yield delay(0.7, words[2].position.y(0, 0.3, easeOutExpo));

    // The clip exists only for the reveal. Drop it once all three have landed,
    // or the 1.05 scale-up and its glow get sliced off at the mask edge.
    yield delay(1.05, () => masks.forEach((m) => m.clip(false)));

    yield delay(1.5, profitHit()); // 10.50 exactly
    yield delay(2.4, outro.opacity(0, 0.6)); // 11.40 -> 12.00
    yield* waitFor(3.0);
  }

  /* -------------------------------------------------------------- master */

  // Idle oscillation for the whole 12s, running underneath everything.
  yield clock(26, 12, linear);

  yield delay(0.0, actNoise());
  yield delay(3.0, actScan());
  yield delay(5.0, actSignal());
  yield delay(9.0, actOutro());
  yield* waitFor(12.0);
});
