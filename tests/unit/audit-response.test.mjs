import assert from "node:assert/strict";
import test from "node:test";
import { parseAuditLogRows } from "../../src/lib/audit-response.mjs";

const validRow = Object.freeze({
  id: "0b601710-2027-42b4-80bb-59be771333e3",
  provider: "google",
  action: "calendar_list_events",
  status: "success",
  resource_id: null,
  summary: "Listed upcoming events",
  created_at: "2026-09-01T00:00:00.000Z",
});

test("accepts valid and empty audit-log arrays without rewriting them", () => {
  const rows = [validRow];
  assert.equal(parseAuditLogRows(rows), rows);

  const empty = [];
  assert.equal(parseAuditLogRows(empty), empty);
});

test("rejects non-array audit-log responses before React state assignment", () => {
  for (const value of [null, undefined, "unauthorized", {}, { error: "Unauthorized" }]) {
    assert.throws(() => parseAuditLogRows(value), {
      name: "TypeError",
      message: "Invalid audit log response",
    });
  }
});

test("rejects malformed audit-log rows", () => {
  const malformed = [
    [null],
    [{}],
    [{ ...validRow, id: null }],
    [{ ...validRow, provider: "" }],
    [{ ...validRow, action: [] }],
    [{ ...validRow, status: null }],
    [{ ...validRow, resource_id: 42 }],
    [{ ...validRow, summary: {} }],
    [{ ...validRow, created_at: "not-a-date" }],
  ];

  for (const value of malformed) {
    assert.throws(() => parseAuditLogRows(value), /Invalid audit log response/);
  }
});
