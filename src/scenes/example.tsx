import { Circle, Layout, Rect, Txt, makeScene2D } from "@motion-canvas/2d";
import { all, createRef, easeOutCubic, waitFor } from "@motion-canvas/core";

/**
 * Harness smoke test. Exists to prove the headless render loop works end to
 * end — not to be pretty. The point of interest is the shape of the code:
 * time reads top-to-bottom instead of being derived from a frame number.
 */
export default makeScene2D(function* (view) {
  const dot = createRef<Circle>();
  const bar = createRef<Rect>();
  const label = createRef<Txt>();

  view.fill("#09090B");

  view.add(
    <Layout direction="column" gap={48} alignItems="center" layout>
      <Txt
        ref={label}
        fill="#FAFAFA"
        fontFamily="Segoe UI, system-ui, sans-serif"
        fontWeight={700}
        fontSize={0}
        text="Motion Canvas"
      />
      <Rect
        ref={bar}
        width={0}
        height={12}
        radius={6}
        fill="#10B981"
      />
    </Layout>,
  );

  view.add(
    <Circle ref={dot} size={64} fill="#3B82F6" x={-560} y={260} opacity={0} />,
  );

  // Sequential time. `all` runs concurrently, bare `yield*` runs after.
  yield* all(
    label().fontSize(96, 0.6, easeOutCubic),
    bar().width(620, 0.6, easeOutCubic),
    dot().opacity(1, 0.4),
  );

  yield* dot().position.x(560, 0.9, easeOutCubic);
  yield* waitFor(0.3);
  yield* all(bar().fill("#3B82F6", 0.5), dot().fill("#10B981", 0.5));
  yield* waitFor(0.5);
});
