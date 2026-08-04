import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCriticalPath,
  dagLayout,
  graphRelations,
  topologicalOrder,
} from "../../src/lib/work-graph.mjs";
const nodes = [
  { id: "research", status: "completed", durationMs: 100 },
  { id: "draft", status: "completed", durationMs: 200 },
  { id: "review", status: "blocked", durationMs: 50 },
  { id: "optional", status: "waiting", durationMs: null },
];
const edges = [
  { id: "e1", source: "research", target: "draft" },
  { id: "e2", source: "draft", target: "review" },
  { id: "e3", source: "research", target: "optional" },
];
test("topological ordering rejects cycles", () => {
  assert.deepEqual(topologicalOrder(nodes, edges), ["research", "draft", "optional", "review"]);
  assert.throws(
    () =>
      topologicalOrder(nodes, [...edges, { id: "cycle", source: "review", target: "research" }]),
    /cycle/,
  );
});
test("critical path uses factual durations and discloses unknown timing", () => {
  const result = calculateCriticalPath(nodes, edges);
  assert.equal(result.totalKnownDurationMs, 350);
  assert.deepEqual(result.criticalNodes, ["research", "draft", "review"]);
  assert.deepEqual(result.blockedCriticalPath, ["review"]);
  assert.deepEqual(result.unknownDurationNodes, ["optional"]);
  assert.equal(result.incomplete, true);
});
test("relations include direct and transitive dependencies", () => {
  const result = graphRelations("review", edges);
  assert.deepEqual([...result.directPrerequisites], ["draft"]);
  assert.deepEqual([...result.prerequisites], ["draft", "research"]);
});
test("DAG layout is deterministic and layered", () => {
  assert.deepEqual(dagLayout(nodes, edges), dagLayout(nodes, edges));
  assert.ok(dagLayout(nodes, edges).draft.x > dagLayout(nodes, edges).research.x);
  assert.ok(dagLayout(nodes, edges, { direction: "TB" }).draft.y > 0);
});
