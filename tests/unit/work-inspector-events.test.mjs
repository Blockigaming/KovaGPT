import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifySpecialistEvents,
  WORK_INSPECTOR_CATEGORIES,
} from "../../src/lib/work-inspector-events.mjs";
const event = (id, type, taskId, detail = "") => ({
  id,
  type,
  payload: { specialist_task_id: taskId, detail },
});
test("A selected task never inherits another task or run-global events", () => {
  const rows = [
    event(1, "objective", "a"),
    event(2, "browser_event", "b"),
    event(3, "provider", undefined),
    event(4, "browser_event", "a"),
  ];
  const grouped = classifySpecialistEvents(rows, "a");
  assert.deepEqual(
    grouped.objective.map((x) => x.id),
    [1],
  );
  assert.deepEqual(
    grouped.browser.map((x) => x.id),
    [4],
  );
  assert.equal(grouped.provider.length, 0);
  assert.equal(Object.values(grouped).flat().length, 2);
});
test("Negated provider/browser/tool prose cannot create category activity", () => {
  const row = event(
    1,
    "evidence",
    "a",
    "No browser capture, tool call or provider request occurred.",
  );
  const grouped = classifySpecialistEvents([row], "a");
  for (const category of ["browser", "provider", "tool"]) assert.deepEqual(grouped[category], []);
  assert.deepEqual(grouped.evidence, [row]);
});
test("Only exact structured types classify; unknown selected-task events remain explicitly Other", () => {
  const types = WORK_INSPECTOR_CATEGORIES.filter((x) => x !== "other");
  const rows = types.flatMap((type, id) => [
    event(id * 2, type, "a"),
    event(id * 2 + 1, `${type}_event`, "a"),
  ]);
  const unknown = event(99, "not_provider_event", "a");
  const grouped = classifySpecialistEvents([...rows, unknown], "a");
  for (const type of types) assert.equal(grouped[type].length, 2);
  assert.deepEqual(grouped.other, [unknown]);
});
test("Missing, nonstring, near-match and nested-only task attribution are not guessed", () => {
  const rows = [
    null,
    {},
    { type: "provider", payload: null },
    event(1, "provider", "a-other"),
    event(2, "provider", 1),
    { type: "provider", payload: { nested: { specialist_task_id: "a" } } },
  ];
  assert.equal(Object.values(classifySpecialistEvents(rows, "a")).flat().length, 0);
  assert.equal(
    Object.values(classifySpecialistEvents([event(1, "provider", "a")], null)).flat().length,
    0,
  );
});
test("Inspector shows structured type, exact category counts and event terminology", () => {
  const source = readFileSync("src/routes/work.tsx", "utf8");
  const inspector = source.slice(
    source.indexOf("{specialist && ("),
    source.indexOf("function Timeline("),
  );
  assert.match(inspector, /WORK_INSPECTOR_CATEGORIES.map/);
  assert.match(inspector, /const matching = inspectorEvents\[kind\]/);
  assert.match(inspector, /events \(\{matching.length\}\)/);
  assert.match(inspector, /JSON.stringify\(\{ type: event.type, payload: event.payload \}/);
  assert.doesNotMatch(inspector, /includes\(kind\)|recorded action/);
});
