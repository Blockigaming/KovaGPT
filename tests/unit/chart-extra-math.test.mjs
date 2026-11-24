import assert from "node:assert/strict";
import test from "node:test";

import {
  boxStats,
  calendarCells,
  chordLayout,
  contourSegments,
  gridFromRows,
  kernelDensity,
  partition,
  pathHierarchy,
  project3d,
  rankRows,
} from "../../src/lib/chart-extra-math.mjs";

test("box statistics use type-7 quartiles and 1.5×IQR outliers", () => {
  const stats = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 100]);
  assert.deepEqual(
    { q1: stats.q1, median: stats.median, q3: stats.q3, max: stats.max, outliers: stats.outliers },
    { q1: 3, median: 5, q3: 7, max: 8, outliers: [100] },
  );
});

test("kernel density integrates to about one", () => {
  const curve = kernelDensity([1, 2, 2, 3, 3, 3, 4, 4, 5], 200);
  const step = curve[1].x - curve[0].x;
  const area = curve.reduce((sum, point) => sum + point.density * step, 0);
  assert.ok(Math.abs(area - 1) < 0.02, `area ${area}`);
  assert.deepEqual(kernelDensity([1]), []);
});

test("calendar cells place dates by week and weekday", () => {
  const cells = calendarCells(
    [
      { d: "2026-11-23", v: 1 }, // Monday
      { d: "2026-11-30", v: 2 },
      { d: "bad", v: 3 },
    ],
    "d",
    "v",
  );
  assert.equal(cells.length, 2);
  assert.equal(cells[0].weekday, 1);
  assert.equal(cells[1].week - cells[0].week, 1);
});

test("path hierarchies total children and partition proportionally", () => {
  const root = pathHierarchy(
    [
      { p: "A/x", v: 3 },
      { p: "A/y", v: 1 },
      { p: "B", v: 4 },
    ],
    "p",
    "v",
  );
  assert.equal(root.value, 8);
  const { nodes, depth } = partition(root);
  assert.equal(depth, 2);
  const a = nodes.find((node) => node.path === "A");
  assert.deepEqual([a.x0, a.x1], [0, 0.5]);
});

test("chord layout spends each group's arc exactly on its ribbons", () => {
  const layout = chordLayout([
    { source: "A", target: "B", value: 2 },
    { source: "B", target: "C", value: 1 },
  ]);
  assert.equal(layout.groups.length, 3);
  for (const group of layout.groups) {
    const used = layout.ribbons
      .flatMap((ribbon) => [
        ribbon.source === group.name ? ribbon.from : null,
        ribbon.target === group.name ? ribbon.to : null,
      ])
      .filter(Boolean)
      .reduce((sum, [start, end]) => sum + end - start, 0);
    assert.ok(Math.abs(used - (group.end - group.start)) < 1e-9);
  }
  assert.equal(chordLayout([{ source: "A", target: "A", value: 0 }]), null);
});

test("grids need every x/y pair; marching squares finds the crossing", () => {
  assert.equal(
    gridFromRows([
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
    ]),
    null,
  );
  const grid = gridFromRows([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 2 },
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 1, z: 2 },
  ]);
  const [segment] = contourSegments(grid, 1);
  assert.deepEqual(
    segment.map(([x]) => x),
    [0.5, 0.5],
  );
});

test("projection keeps the cube origin centred and ranks bump charts", () => {
  const centre = project3d([0, 0, 0], 0.7, 0.4);
  assert.deepEqual([centre.x, centre.y], [0, -0]);
  assert.deepEqual(rankRows([{ t: 1, a: 5, b: 9 }], "t", ["a", "b"]), [{ t: 1, b: 1, a: 2 }]);
});
