import assert from "node:assert/strict";
import test from "node:test";
import { summarizeUsdActivity } from "../../src/finances/finance-activity-summary.mjs";

const entry = (amount, date = "2026-11-09", currency = "USD", pending = false) => ({
  amount,
  date,
  currency,
  pending,
});

test("posted USD outflows and inflows are separated and grouped by day", () => {
  const result = summarizeUsdActivity([
    entry(12.2, "2026-11-10"),
    entry(-5.1),
    entry(2.3, "2026-11-10"),
  ]);
  assert.equal(result.spent, 14.5);
  assert.equal(result.received, 5.1);
  assert.deepEqual(result.days, [
    { date: "2026-11-09", spent: 0, received: 5.1 },
    { date: "2026-11-10", spent: 14.5, received: 0 },
  ]);
});

test("pending records never enter posted USD totals", () => {
  const result = summarizeUsdActivity([entry(9), entry(120, undefined, "USD", true)]);
  assert.equal(result.spent, 9);
  assert.equal(result.excludedPending, 1);
});

test("mixed and unknown currency cannot be misreported as USD", () => {
  const result = summarizeUsdActivity([
    entry(10, "2026-11-09", "USD"),
    entry(100, "2026-11-09", "EUR"),
    entry(-40, "2026-11-09", null),
  ]);
  assert.equal(result.spent, 10);
  assert.equal(result.received, 0);
  assert.equal(result.excludedCurrency, 2);
});

test("null, malformed and nonfinite values are excluded without NaN", () => {
  const result = summarizeUsdActivity([
    entry(null),
    entry(Number.NaN),
    entry(Number.POSITIVE_INFINITY),
    entry(8, "2026-02-30"),
    entry(3.4, "2026-11-08"),
  ]);
  assert.equal(result.spent, 3.4);
  assert.equal(result.excludedInvalid, 4);
  assert.equal(result.days.length, 1);
});

test("sum in integer cents to avoid floating-point drift", () => {
  const result = summarizeUsdActivity([entry(0.1), entry(0.2), entry(-0.3)]);
  assert.equal(result.spent, 0.3);
  assert.equal(result.received, 0.3);
});
