import assert from "node:assert/strict";
import test from "node:test";

import {
  compareCells,
  rowsToDelimited,
  tableModelFromHast,
} from "../../src/lib/response-table.mjs";
import {
  messageActivitiesFromDelta,
  timeMessageActivities,
} from "../../src/lib/message-activity-list.mjs";

const cell = (tagName, value) => ({
  type: "element",
  tagName,
  children: [{ type: "text", value }],
});
const row = (tagName, values) => ({
  type: "element",
  tagName: "tr",
  children: values.map((value) => cell(tagName, value)),
});

test("table model reads header and body text from the Markdown table", () => {
  const model = tableModelFromHast({
    type: "element",
    tagName: "table",
    children: [
      { type: "element", tagName: "thead", children: [row("th", ["Name", "Price"])] },
      {
        type: "element",
        tagName: "tbody",
        children: [row("td", ["A", "$1,200"]), row("td", ["B", "$90"])],
      },
    ],
  });
  assert.deepEqual(model, {
    header: ["Name", "Price"],
    rows: [
      ["A", "$1,200"],
      ["B", "$90"],
    ],
  });
});

test("cells sort numerically with currency, separators, percent and k/m suffixes", () => {
  const values = [
    "$1,200",
    "$90",
    "12%",
    "-5",
    "2.5k",
    "1m",
    "apple",
    "Banana",
    "item 10",
    "item 9",
  ];
  assert.deepEqual([...values].sort(compareCells), [
    "-5",
    "12%",
    "$90",
    "$1,200",
    "2.5k",
    "1m",
    "apple",
    "Banana",
    "item 9",
    "item 10",
  ]);
});

test("CSV export quotes safely and neutralises spreadsheet formulas", () => {
  assert.equal(
    rowsToDelimited(
      [
        ["a,b", 'say "hi"', "=SUM(A1)"],
        ["-5", "+x", "line\nbreak"],
      ],
      ",",
    ),
    '"a,b","say ""hi""",\'=SUM(A1)\r\n-5,\'+x,"line\nbreak"',
  );
  assert.equal(rowsToDelimited([["a\tb", "c"]], "\t"), "a b\tc");
});

test("activity deltas keep new states, details, counts, nesting and server durations", () => {
  const [activity] = messageActivitiesFromDelta([], {
    tool: "drive_read",
    label: "Reading files",
    status: "partial",
    detail: "report.pdf",
    count: 3,
    total: 5,
    parent_id: "op-1",
    duration_ms: 1500,
  });
  assert.deepEqual(activity, {
    tool: "drive_read",
    label: "Reading files",
    status: "partial",
    detail: "report.pdf",
    count: 3,
    total: 5,
    durationMs: 1500,
    parentId: "op-1",
  });
  for (const status of ["queued", "paused", "skipped", "failed", "canceled"])
    assert.equal(
      messageActivitiesFromDelta([], { tool: "x", label: "y", status })[0].status,
      status,
    );
  assert.equal(
    messageActivitiesFromDelta([], { tool: "x", label: "y", status: "bogus" })[0].status,
    "done",
  );
});

test("live operations are timed from first sight to settling on this client's clock", () => {
  const running = [{ tool: "web", label: "Searching", status: "running", activityId: "a" }];
  const started = timeMessageActivities([], running, 1_000);
  assert.equal(started[0].startedAt, 1_000);
  assert.equal(started[0].durationMs, undefined);
  const done = timeMessageActivities(started, [{ ...started[0], status: "done" }], 4_500);
  assert.equal(done[0].durationMs, 3_500);
  const serverTimed = timeMessageActivities(
    [],
    [{ tool: "x", label: "y", status: "done", durationMs: 9 }],
    5,
  );
  assert.equal(serverTimed[0].durationMs, 9);
});
