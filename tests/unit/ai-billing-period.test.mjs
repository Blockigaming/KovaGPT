import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveCurrentBillingPeriod } from "../../src/lib/ai/billing-period.mjs";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");

function row(overrides = {}) {
  return {
    environment: "live",
    status: "active",
    current_period_start: "2026-09-01T00:00:00.000Z",
    current_period_end: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

test("AI accounting accepts only a current nonterminal live billing period", () => {
  assert.deepEqual(resolveCurrentBillingPeriod([row()], { now: NOW }), [
    "2026-09-01T00:00:00.000Z",
    "2026-10-01T00:00:00.000Z",
  ]);

  for (const invalid of [
    row({ environment: "sandbox" }),
    row({ status: "canceled" }),
    row({ status: "incomplete_expired" }),
    row({ current_period_end: "2026-09-03T12:00:00.000Z" }),
    row({ current_period_start: "2026-09-04T00:00:00.000Z" }),
    row({ current_period_start: "not-a-date" }),
    row({ current_period_end: null }),
  ]) {
    assert.equal(resolveCurrentBillingPeriod([invalid], { now: NOW }), null);
  }
});

test("AI accounting selects the latest valid period without mutating the input", () => {
  const rows = [
    row({
      current_period_start: "2026-08-15T00:00:00.000Z",
      current_period_end: "2026-09-15T00:00:00.000Z",
    }),
    row({
      status: "trialing",
      current_period_start: "2026-09-01T00:00:00.000Z",
      current_period_end: "2026-10-01T00:00:00.000Z",
    }),
  ];
  const snapshot = structuredClone(rows);
  assert.deepEqual(resolveCurrentBillingPeriod(rows, { now: NOW }), [
    "2026-09-01T00:00:00.000Z",
    "2026-10-01T00:00:00.000Z",
  ]);
  assert.deepEqual(rows, snapshot);
});

test("AI accounting query is live-only, current-only, and fail-closed", () => {
  const source = readFileSync("src/lib/ai/accounting.server.ts", "utf8");
  assert.match(source, /\.eq\("environment", BILLING_ENV\)/);
  assert.match(source, /\.in\("status", \["active", "trialing", "past_due"\]\)/);
  assert.match(source, /\.lte\("current_period_start", nowIso\)/);
  assert.match(source, /\.gt\("current_period_end", nowIso\)/);
  assert.match(source, /if \(error\) throw new Error\("billing_period_lookup_failed"\)/);
  assert.doesNotMatch(source, /"canceled"/);
});
