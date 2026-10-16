import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { compile } from "@tailwindcss/node";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
import { fitGraphViewport, GRAPH_MIN_ZOOM } from "../../src/lib/work-graph-viewport.mjs";
import { dagLayout } from "../../src/lib/work-graph.mjs";
const source = readFileSync("src/routes/work.tsx", "utf8");
const graph = source.slice(
  source.indexOf("function DependencyGraph("),
  source.indexOf("function Timeline("),
);
const classes = {
  section: graph.match(/<section className="([^"]+)"/)[1],
  header: graph.match(/<div className="(mb-4 [^"]+)"/)[1],
  canvas: graph.match(/ref=\{viewportRef\}\s+className="([^"]+)"/)[1],
  minimap: graph.match(/ref=\{minimapRef\}\s+className="([^"]+)"/)[1],
};
const compiler = await compile(readFileSync("src/styles.css", "utf8"), {
  base: `${process.cwd()}/src`,
  onDependency() {},
});
const css = compiler.build([...new Set(Object.values(classes).flatMap((s) => s.split(/\s+/)))]);
const escape = (s) =>
  s
    .split(/\s+/)
    .map((p) => p.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [320, 390, 834, 1440])
  test(`Graph canvas uses the real pane remainder with an independently sized minimap at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768),
      html = element("html"),
      section = element("section", escape(classes.section), html),
      header = element("div", escape(classes.header), section),
      canvas = element("div", escape(classes.canvas), section),
      minimap = element("div", escape(classes.minimap), canvas);
    assert.equal(c.value(section, "display"), "flex");
    assert.equal(c.value(section, "height"), "100%");
    assert.equal(c.value(section, "flex-direction"), "column");
    assert.equal(c.value(header, "flex-shrink"), "0");
    assert.equal(c.value(canvas, "height"), undefined);
    assert.equal(c.value(canvas, "flex"), "1");
    assert.equal(c.value(canvas, "min-height"), `calc(0.25rem * ${width < 640 ? 32 : 48})`);
    assert.equal(c.value(canvas, "max-height"), "28rem");
    assert.equal(c.value(canvas, "padding"), `calc(0.25rem * ${width < 640 ? 4 : 8})`);
    assert.equal(c.value(minimap, "height"), `calc(0.25rem * ${width < 640 ? 12 : 20})`);
  });
const fitCode = ts.transpileModule(
  graph.slice(graph.indexOf("  const fit = () => {"), graph.indexOf("  const specialist =")) +
    "\nfit();",
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
function runFit({
  width,
  paneHeight,
  canvasHeight,
  canvasStart,
  padding,
  mapHeight,
  scrollTop = 0,
  empty = false,
  parallel = false,
}) {
  let scroll = scrollTop,
    writes = 0;
  const pane = {
    clientTop: 0,
    clientHeight: paneHeight,
    getBoundingClientRect: () => ({ top: 0 }),
    get scrollTop() {
      return scroll;
    },
    set scrollTop(value) {
      writes++;
      scroll = Math.max(0, Math.min(canvasStart + canvasHeight - paneHeight, value));
    },
  };
  const viewport = {
    clientTop: 0,
    clientWidth: width,
    clientHeight: canvasHeight,
    closest(selector) {
      assert.equal(selector, "[data-work-view-scroll]");
      return pane;
    },
    getBoundingClientRect: () => ({
      top: canvasStart - scroll,
      bottom: canvasStart - scroll + canvasHeight,
    }),
  };
  const minimap = {
    getBoundingClientRect: () => ({ top: canvasStart - scroll + canvasHeight - 12 - mapHeight }),
  };
  const sizes = parallel
    ? [0, 1, 2, 3].map(() => ({ width: 224, height: 143 }))
    : [
        { width: 224, height: 143 },
        { width: 224, height: 118 },
      ];
  const graphNodes = empty
      ? []
      : parallel
        ? [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]
        : [{ id: "a" }, { id: "b" }],
    edges = empty || parallel ? [] : [{ source: "a", target: "b" }];
  const result = {};
  const minimumZoomRef = { current: GRAPH_MIN_ZOOM };
  vm.runInNewContext(fitCode, {
    viewportRef: { current: viewport },
    minimapRef: { current: minimap },
    nodeRefs: {
      current: new Map(
        graphNodes.map((n, i) => [
          n.id,
          { offsetWidth: sizes[i].width, offsetHeight: sizes[i].height },
        ]),
      ),
    },
    graphNodes,
    detail: { edges },
    dagLayout,
    fitGraphViewport,
    GRAPH_MIN_ZOOM,
    minimumZoomRef,
    getComputedStyle: () => ({
      paddingLeft: String(padding),
      paddingRight: String(padding),
      paddingTop: String(padding),
      paddingBottom: String(padding),
    }),
    setPositions: (value) => (result.positions = value),
    setScale: (value) => (result.scale = value),
    setOffset: (value) => (result.offset = value),
  });
  for (const [index, node] of graphNodes.entries()) {
    const p = result.positions[node.id],
      box = sizes[index];
    const left = padding + p.x * result.scale + result.offset.x;
    const top = canvasStart - scroll + padding + p.y * result.scale + result.offset.y;
    assert.ok(left >= padding - 1e-8);
    assert.ok(left + box.width * result.scale <= width - padding + 1e-8);
    assert.ok(top >= Math.max(0, canvasStart - scroll + padding) - 1e-8);
    assert.ok(
      top + box.height * result.scale <=
        Math.min(paneHeight, minimap.getBoundingClientRect().top - 8) + 1e-8,
    );
  }
  return { result, scroll, writes, minimumZoomRef };
}
for (const [label, values] of [
  [
    "390px observed 355px run pane",
    {
      width: 332,
      paneHeight: 355,
      canvasHeight: 187,
      canvasStart: 152,
      padding: 16,
      mapHeight: 48,
    },
  ],
  [
    "320px wrapped graph header",
    {
      width: 262,
      paneHeight: 323,
      canvasHeight: 131,
      canvasStart: 176,
      padding: 16,
      mapHeight: 48,
    },
  ],
  [
    "short landscape pane requiring local scroll",
    {
      width: 420,
      paneHeight: 180,
      canvasHeight: 128,
      canvasStart: 152,
      padding: 16,
      mapHeight: 48,
    },
  ],
  [
    "wide desktop",
    {
      width: 700,
      paneHeight: 500,
      canvasHeight: 380,
      canvasStart: 104,
      padding: 32,
      mapHeight: 80,
    },
  ],
  [
    "already-scrolled pane",
    {
      width: 332,
      paneHeight: 355,
      canvasHeight: 187,
      canvasStart: 152,
      padding: 16,
      mapHeight: 48,
      scrollTop: 170,
    },
  ],
])
  test(`Actual Fit handler keeps nodes inside the visible pane and above minimap: ${label}`, () => {
    const outcome = runFit(values);
    assert.equal(outcome.writes, 1);
    if (label.includes("requiring")) assert.equal(outcome.scroll, 100);
  });
test("Fit remains explicit, scrolls only the marked run pane, and empty tasks remain safe", () => {
  assert.doesNotMatch(fitCode, /scrollIntoView|window\.scroll|document\.|fetch|localStorage/);
  assert.doesNotMatch(graph, /useEffect\([^]*?\bfit\(\)/);
  assert.match(graph, /onClick=\{fit\}/);
  const outcome = runFit({
    width: 332,
    paneHeight: 355,
    canvasHeight: 187,
    canvasStart: 152,
    padding: 16,
    mapHeight: 48,
    empty: true,
  });
  assert.equal(outcome.result.scale, 1);
});

test("Actual Fit contains four parallel nodes in the narrowest phone canvas", () => {
  const outcome = runFit({
    width: 262,
    paneHeight: 323,
    canvasHeight: 131,
    canvasStart: 176,
    padding: 16,
    mapHeight: 48,
    parallel: true,
  });
  assert.ok(outcome.result.scale < 0.1);
});
test("Compact sm+ graph has a nonzero fit region below its 32px padding and 80px minimap", () => {
  runFit({
    width: 500,
    paneHeight: 220,
    canvasHeight: 192,
    canvasStart: 120,
    padding: 32,
    mapHeight: 80,
  });
});

test("A smaller explicit Fit keeps its floor through zoom-in/out without changing pan or drag", () => {
  const outcome = runFit({
    width: 262,
    paneHeight: 323,
    canvasHeight: 131,
    canvasStart: 176,
    padding: 16,
    mapHeight: 48,
    parallel: true,
  });
  const floor = outcome.minimumZoomRef.current;
  assert.equal(floor, outcome.result.scale);
  assert.ok(floor < GRAPH_MIN_ZOOM);
  const zoomIn = Math.min(1.8, floor + 0.1);
  assert.equal(Math.max(floor, zoomIn - 0.1), floor);
  assert.equal(Math.max(floor, floor - 0.1), floor);
  assert.equal((graph.match(/minimumZoomRef.current =/g) || []).length, 1);
  assert.match(graph, /Math.max\(minimumZoomRef.current, s - 0.1\)/);
  assert.match(graph, /Math.max\(minimumZoomRef.current, value - event.deltaY \* 0.001\)/);
});
