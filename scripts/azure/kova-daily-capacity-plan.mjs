#!/usr/bin/env node
/**
 * Safe CLI for a once-per-day Azure capacity review.
 * Metrics must be retrieved from trusted Kova server-side telemetry.
 * This command only outputs a plan; it NEVER mutates Azure.
 *
 * Usage:
 *   node scripts/azure/kova-daily-capacity-plan.mjs ./hourly-prompt-stats.json 2
 */
import { readFileSync } from "node:fs";
import { recommendKovaGatewayCapacity } from "../../src/lib/ai/kova-daily-capacity-policy.mjs";

export function planFromJson(json, currentMaxReplicas, now = Date.now()) {
  const data = JSON.parse(json);
  if (!data || typeof data !== "object" || !Array.isArray(data.hourlyStats)) {
    throw new Error("invalid_hourly_prompt_metrics");
  }
  return recommendKovaGatewayCapacity({
    hourlyStats: data.hourlyStats,
    currentMaxReplicas,
    now,
    minReplicas: 1,
    hardReplicaCap: 4,
    // Placeholder; revise using actual gateway latency and concurrency benchmarks.
    sustainableRpsPerReplica: 2,
  });
}

if (process.argv[1]?.endsWith("/kova-daily-capacity-plan.mjs")) {
  const [file, replicas] = process.argv.slice(2);
  if (!file || !/^\d+$/.test(replicas ?? "")) {
    process.stderr.write(
      "Usage: node scripts/azure/kova-daily-capacity-plan.mjs metrics.json currentMaxReplicas\n",
    );
    process.exitCode = 2;
  } else {
    try {
      const plan = planFromJson(readFileSync(file, "utf8"), Number(replicas));
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    } catch {
      process.stderr.write("No capacity change: invalid or unavailable metrics.\n");
      process.exitCode = 1;
    }
  }
}
