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

test("accepts canonical RFC 3339 timestamps emitted by PostgREST", () => {
  const rows = [
    { ...validRow, created_at: "2026-09-01T00:00:00Z" },
    { ...validRow, created_at: "2026-09-01T00:00:00.123456+00:00" },
  ];

  assert.equal(parseAuditLogRows(rows), rows);
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
    [{ ...validRow, status: "pending" }],
    [{ ...validRow, resource_id: 42 }],
    [{ ...validRow, summary: {} }],
    [{ ...validRow, created_at: "not-a-date" }],
    [{ ...validRow, created_at: "2026-02-30T00:00:00.000Z" }],
    [{ ...validRow, created_at: "2026-09-01 00:00:00.000Z" }],
  ];

  for (const value of malformed) {
    assert.throws(() => parseAuditLogRows(value), /Invalid audit log response/);
  }
});

test("rejects sparse arrays instead of skipping missing rows", () => {
  const sparse = new Array(1);
  assert.throws(() => parseAuditLogRows(sparse), /Invalid audit log response/);

  const partiallyFilled = new Array(2);
  partiallyFilled[1] = validRow;
  assert.throws(() => parseAuditLogRows(partiallyFilled), /Invalid audit log response/);
});
