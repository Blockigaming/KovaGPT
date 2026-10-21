import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskPayload } from "../../src/lib/scheduled-task-policy.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const { validateScheduledTaskDraft: validate } = loadUiModule(
  "src/lib/scheduled-task-draft-validation.ts",
  { "@/lib/scheduled-task-policy.mjs": { parseTaskPayload } },
);
const valid = {
  title: "Task",
  prompt: "Review this",
  localTime: "2028-02-29T09:00",
  timezone: "America/New_York",
  mode: "time",
  consent: true,
};
const fields = (draft) => Array.from(validate({ ...valid, ...draft }), (issue) => issue.field);

test("the client reuses server title and prompt presence, length, and control-character checks", () => {
  assert.deepEqual(fields({}), []);
  for (const [field, limit] of [
    ["title", 200],
    ["prompt", 4000],
  ]) {
    for (const value of ["", "   ", "x".repeat(limit + 1), "bad\u0001text"]) {
      assert.deepEqual(fields({ [field]: value }), [field]);
      assert.throws(() => parseTaskPayload({ [field]: value }, true));
    }
    assert.deepEqual(fields({ [field]: "x".repeat(limit) }), []);
  }
});

test("date and time errors identify their own field using the server's valid-calendar and shape rules", () => {
  for (const localTime of ["2027-02-29T09:00", "2028-13-01T09:00", "2028-02-30T09:00", "T09:00"]) {
    assert.deepEqual(fields({ localTime }), ["date"]);
    assert.throws(() => parseTaskPayload({ localTime }, true));
  }
  for (const localTime of [
    "2028-02-29T",
    "2028-02-29T25:00",
    "2028-02-29T09:60",
    "2028-02-29T09:00Z",
    "2028-02-29T09:00Tbad",
  ]) {
    assert.deepEqual(fields({ localTime }), ["time"]);
    assert.throws(() => parseTaskPayload({ localTime }, true));
  }
  assert.deepEqual(fields({ localTime: "" }), ["date", "time"]);
  assert.deepEqual(fields({ localTime: "2028-02-29T23:59:59" }), []);
});

test("future admission and ambiguous or missing DST instants remain server-owned", () => {
  for (const localTime of ["2000-01-01T09:00", "2027-03-14T02:30", "2027-11-07T01:30"]) {
    const draft = { ...valid, localTime };
    assert.deepEqual(fields(draft), []);
    assert.equal(draft.localTime, localTime);
  }
});

test("timezone recognition matches the service and explicit consent is required", () => {
  for (const timezone of ["UTC", "America/New_York", "Asia/Kolkata"])
    assert.deepEqual(fields({ timezone }), []);
  for (const timezone of ["", "   ", "Mars/Olympus_Mons", "UTC\u0001"]) {
    assert.deepEqual(fields({ timezone }), ["timezone"]);
    assert.throws(() => parseTaskPayload({ timezone }, true));
  }
  assert.deepEqual(fields({ consent: false }), ["consent"]);
});

test("event mode skips hidden date/time fields without trying to admit event filters", () => {
  assert.deepEqual(fields({ mode: "event", localTime: "not a schedule" }), []);
  assert.deepEqual(fields({ mode: "event", localTime: "", timezone: "invalid", consent: false }), [
    "timezone",
    "consent",
  ]);
});
