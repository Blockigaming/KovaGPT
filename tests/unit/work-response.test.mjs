import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkRunList } from "../../src/lib/work-response.mjs";

const validRun = Object.freeze({
  id: "a151c693-c0e3-44ed-a5dc-e21018320466",
  kind: "team",
  status: "completed",
  attempts: 1,
  maxAttempts: 3,
  projectId: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  startedAt: "2026-08-31T12:00:01.000Z",
  completedAt: "2026-08-31T12:00:02.000Z",
  error: null,
  input: {},
});

test("accepts valid and empty Work run lists without rewriting them", () => {
  const runs = [validRun];
  assert.equal(parseWorkRunList(runs), runs);

  const empty = [];
  assert.equal(parseWorkRunList(empty), empty);
});

test("rejects non-array Work responses before React state assignment", () => {
  for (const value of [null, undefined, "unauthorized", {}, { error: "Unauthorized" }]) {
    assert.throws(() => parseWorkRunList(value), {
      name: "TypeError",
      message: "Invalid Work runs response",
    });
  }
});

test("rejects malformed Work run entries", () => {
  const malformed = [
    [null],
    [{}],
    [{ ...validRun, id: null }],
    [{ ...validRun, kind: "unknown" }],
    [{ ...validRun, status: null }],
    [{ ...validRun, attempts: "1" }],
    [{ ...validRun, input: [] }],
  ];

  for (const value of malformed) {
    assert.throws(() => parseWorkRunList(value), /Invalid Work runs response/);
  }
});
