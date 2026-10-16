import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fitGraphViewport,
  GRAPH_MIN_ZOOM,
  GRAPH_MAX_ZOOM,
} from "../../src/lib/work-graph-viewport.mjs";
import { dagLayout } from "../../src/lib/work-graph.mjs";
function contained(rectangles, viewport, fitted) {
  assert.ok(fitted);
  for (const r of rectangles) {
    assert.ok(r.x * fitted.scale + fitted.offset.x >= 8 - 1e-8);
    assert.ok(r.y * fitted.scale + fitted.offset.y >= 8 - 1e-8);
    assert.ok((r.x + r.width) * fitted.scale + fitted.offset.x <= viewport.width - 8 + 1e-8);
    assert.ok((r.y + r.height) * fitted.scale + fitted.offset.y <= viewport.height - 8 + 1e-8);
  }
}
for (const width of [174, 244, 600, 1100]) {
  test(`Fit contains both real-width nodes in a ${width}px inner viewport`, () => {
    const nodes = [{ id: "a" }, { id: "b" }];
    const positions = dagLayout(nodes, [{ source: "a", target: "b" }]);
    const rectangles = nodes.map(({ id }) => ({ ...positions[id], width: 224, height: 143 }));
    const before = structuredClone(rectangles);
    const viewport = { width, height: 302 };
    const fitted = fitGraphViewport(rectangles, viewport);
    contained(rectangles, viewport, fitted);
    assert.deepEqual(rectangles, before);
    assert.ok(fitted.scale >= GRAPH_MIN_ZOOM && fitted.scale <= 1);
  });
}
test("Fit centers a single task without enlarging it", () => {
  const rectangles = [{ x: -100, y: -32, width: 224, height: 220 }];
  const viewport = { width: 700, height: 302 };
  const fitted = fitGraphViewport(rectangles, viewport);
  assert.equal(fitted.scale, 1);
  contained(rectangles, viewport, fitted);
});
test("Fit accounts for multirow bounds and actual unequal node heights", () => {
  const rectangles = [
    { x: -200, y: -50, width: 224, height: 180 },
    { x: 300, y: 380, width: 224, height: 260 },
    { x: 60, y: 700, width: 224, height: 140 },
  ];
  const viewport = { width: 244, height: 302 };
  contained(rectangles, viewport, fitGraphViewport(rectangles, viewport));
});
test("Empty, zero-size, malformed and explicitly bounded zoom inputs are deterministic", () => {
  assert.deepEqual(fitGraphViewport([], { width: 244, height: 302 }), {
    scale: 1,
    offset: { x: 0, y: 0 },
  });
  assert.equal(fitGraphViewport([], { width: 0, height: 302 }), null);
  assert.equal(
    fitGraphViewport([{ x: NaN, y: 0, width: 224, height: 140 }], { width: 244, height: 302 }),
    null,
  );
  const enormous = [{ x: 0, y: 0, width: 100000, height: 100000 }];
  assert.equal(fitGraphViewport(enormous, { width: 244, height: 302 }).scale, GRAPH_MIN_ZOOM);
  assert.equal(
    fitGraphViewport(
      [{ x: 0, y: 0, width: 10, height: 10 }],
      { width: 244, height: 302 },
      { maxZoom: GRAPH_MAX_ZOOM },
    ).scale,
    GRAPH_MAX_ZOOM,
  );
});
test("The actual Fit handler measures untransformed rendered cards and viewport only on explicit activation", () => {
  const source = fs.readFileSync(new URL("../../src/routes/work.tsx", import.meta.url), "utf8");
  const handler = source.slice(
    source.indexOf("  const fit = () => {"),
    source.indexOf("  const specialist ="),
  );
  for (const marker of [
    "viewportRef.current",
    "nodeRefs.current.get(node.id)",
    "element?.offsetWidth",
    "element?.offsetHeight",
    "viewport.clientWidth",
    "viewport.clientHeight",
    "fitGraphViewport(",
    "setPositions(nextPositions)",
    "setScale(fitted.scale)",
    "setOffset({ x: fitted.offset.x, y: fitted.offset.y + visibleTop - paddingTop })",
  ])
    assert.ok(handler.includes(marker), marker);
  assert.match(source, /onClick=\{fit\}/);
  assert.doesNotMatch(source, /useEffect\([^]*?\bfit\(\)/);
  assert.doesNotMatch(handler, /fetch|controlWorkRun|localStorage|recordWorkRecent/);
});

test("Explicit overview fitting can contain many parallel nodes below the manual zoom floor", () => {
  const rectangles = [0, 160, 320, 480].map((y) => ({ x: 0, y, width: 224, height: 143 }));
  const viewport = { width: 230, height: 47 };
  const fitted = fitGraphViewport(rectangles, viewport, { minZoom: Number.MIN_VALUE });
  assert.ok(fitted.scale < GRAPH_MIN_ZOOM);
  contained(rectangles, viewport, fitted);
});
