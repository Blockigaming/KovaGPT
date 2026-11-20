import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_APPLE_HEALTH_REPORT_BYTES,
  parseAppleHealthReport,
} from "../../src/health/apple-health-report.mjs";

const report = (days) => JSON.stringify({ version: 1, source: "kovagpt.apple-health", days });
const first = { date: "2028-02-29", steps: 0 };

test("Apple Health reports keep chronological daily totals, including zero and missing dates", () => {
  const days = [first, { date: "2028-03-02", steps: 3201 }, { date: "2028-03-06", steps: 4920 }];
  assert.deepEqual(parseAppleHealthReport(report(days)), days);
});

test("Apple Health reports reject invalid or oversized input", () => {
  for (const input of [
    "",
    "null",
    "{}",
    report([]),
    report([first, first]),
    report([{ date: "2028-03-01", steps: 3201 }, first]),
    report([{ date: "2027-02-29", steps: 0 }]),
    report([first, { date: "2028-03-07", steps: 3201 }]),
    report([{ date: first.date, steps: -1 }]),
    report([{ date: first.date, steps: 1.5 }]),
    report([{ date: first.date, steps: "3201" }]),
    report([{ date: first.date, steps: Number.MAX_SAFE_INTEGER + 1 }]),
    " ".repeat(MAX_APPLE_HEALTH_REPORT_BYTES) + report([first]),
  ]) {
    assert.throws(() => parseAppleHealthReport(input), Error);
  }
});
