import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHourlyPromptStats,
  recommendKovaGatewayCapacity,
} from "./kova-daily-capacity-policy.mjs";

const now = Date.parse("2026-11-05T12:00:00Z");
const hour = 3_600_000;
function hourly(count, prompts = 0, peakRps) {
  return Array.from({ length: count }, (_, i) => ({
    hourUtc: new Date(now - (count - i) * hour).toISOString(),
    prompts,
    ...(peakRps === undefined ? {} : { peakRps }),
  }));
}
const recommend = (hourlyStats, currentMaxReplicas = 2, other = {}) =>
  recommendKovaGatewayCapacity({ hourlyStats, currentMaxReplicas, now, ...other });

test("gateway never scales to zero during quiet periods", () => {
  const result = recommend(hourly(72, 0), 2);
  assert.equal(result.minReplicas, 1);
  assert.equal(result.maxReplicas, 1);
  assert.equal(result.reason, "daily_decrease");
  assert.equal(result.applied, false);
});

test("observed hourly peak prompts increase ceiling only one step per day", () => {
  const result = recommend(hourly(24, 3600, 3), 1);
  assert.equal(result.maxReplicas, 2);
  assert.equal(result.boundedRequiredReplicas, 3);
  assert.equal(result.reason, "daily_increase");
});

test("do not scale down from a single day of low traffic", () => {
  assert.equal(recommend(hourly(24, 0), 3).maxReplicas, 3);
});

test("rejects incomplete, duplicated and stale hourly telemetry", () => {
  const gaps = hourly(25, 0).filter((_, i) => i !== 12);
  assert.equal(recommend(gaps, 2).reason, "hourly_coverage_gap");
  const duplicate = hourly(24, 0);
  duplicate[1] = duplicate[0];
  assert.equal(normalizeHourlyPromptStats(duplicate, now), null);
  assert.equal(
    recommend(
      hourly(24, 0).map((x) => ({
        ...x,
        hourUtc: new Date(Date.parse(x.hourUtc) - 5 * 24 * hour).toISOString(),
      })),
      2,
    ).reason,
    "stale_metrics",
  );
});

test("never recommends spending beyond the hard replica ceiling", () => {
  const result = recommend(hourly(72, 500_000, 100), 3);
  assert.equal(result.maxReplicas, 4);
  assert.equal(result.boundedRequiredReplicas, 4);
});

test("rejects invalid current capacity and target rates", () => {
  assert.throws(() => recommend(hourly(24), 0), /invalid_scaling_bounds/);
  assert.throws(
    () => recommend(hourly(24), 2, { sustainableRpsPerReplica: 0 }),
    /invalid_scaling_bounds/,
  );
});

test("rejects unfinished hourly metrics so the planner never misreads partial traffic", () => {
  const unfinished = [{ hourUtc: new Date(now).toISOString(), prompts: 10 }];
  assert.equal(normalizeHourlyPromptStats(unfinished, now), null);
});
