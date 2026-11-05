/**
 * Daily, bounded Kova gateway capacity planning.
 *
 * IMPORTANT:
 * - Hosted inference providers independently operate their warm GPUs.
 * - This controls recommended API gateway max replicas only (min remains >=1).
 * - Azure's request-based autoscaling handles bursts between daily reviews.
 * - This module does not mutate Azure or spend money.
 */
const HOUR_MS = 60 * 60_000;
const MIN_SAMPLES = 24;
const MAX_HISTORY = 14 * 24;

function safeInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function normalizeHourlyPromptStats(samples, now = Date.now()) {
  if (!Array.isArray(samples) || samples.length > MAX_HISTORY || !Number.isFinite(now)) return null;
  const hours = new Set();
  const records = [];
  for (const entry of samples) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const timestamp = Date.parse(entry.hourUtc);
    if (
      !Number.isFinite(timestamp) ||
      timestamp % HOUR_MS !== 0 ||
      timestamp + HOUR_MS > now ||
      timestamp < now - 15 * 24 * HOUR_MS ||
      !safeInteger(entry.prompts, 0, 100_000_000) ||
      (entry.peakRps !== undefined &&
        (!Number.isFinite(entry.peakRps) || entry.peakRps < 0 || entry.peakRps > 100_000))
    )
      return null;
    if (hours.has(timestamp)) return null;
    hours.add(timestamp);
    records.push({
      time: timestamp,
      hourOfDay: new Date(timestamp).getUTCHours(),
      prompts: entry.prompts,
      averageRps: entry.prompts / 3600,
      peakRps: entry.peakRps ?? entry.prompts / 3600,
    });
  }
  records.sort((a, b) => a.time - b.time);
  return records;
}

/**
 * @param {object} input
 * @param {Array<{hourUtc:string,prompts:number,peakRps?:number}>} input.hourlyStats
 * @param {number} input.currentMaxReplicas
 * @param {number} [input.now]
 * @param {number} [input.minReplicas]
 * @param {number} [input.hardReplicaCap]
 * @param {number} [input.sustainableRpsPerReplica]
 */
export function recommendKovaGatewayCapacity({
  hourlyStats,
  currentMaxReplicas,
  now = Date.now(),
  minReplicas = 1,
  hardReplicaCap = 4,
  sustainableRpsPerReplica = 2,
} = {}) {
  if (
    !safeInteger(minReplicas, 1, 50) ||
    !safeInteger(hardReplicaCap, minReplicas, 50) ||
    !safeInteger(currentMaxReplicas, minReplicas, hardReplicaCap) ||
    !Number.isFinite(sustainableRpsPerReplica) ||
    sustainableRpsPerReplica <= 0
  )
    throw new Error("invalid_scaling_bounds");
  const unchanged = (reason) => ({
    minReplicas,
    maxReplicas: currentMaxReplicas,
    reason,
    applied: false,
    evidenceHours: 0,
  });
  const records = normalizeHourlyPromptStats(hourlyStats, now);
  if (!records || records.length < MIN_SAMPLES) return unchanged("insufficient_or_invalid_metrics");
  const latestHour = records.at(-1).time;
  if (latestHour < now - 3 * HOUR_MS) return unchanged("stale_metrics");
  const last24 = records.filter((row) => row.time >= latestHour - 23 * HOUR_MS);
  if (
    last24.length !== 24 ||
    last24.some((row, index) => index > 0 && row.time - last24[index - 1].time !== HOUR_MS)
  ) {
    return unchanged("hourly_coverage_gap");
  }

  const groups = Array.from({ length: 24 }, () => []);
  for (const row of records) groups[row.hourOfDay].push(row.averageRps);
  const predicted = Math.max(
    ...groups.map((values) =>
      values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : 0,
    ),
  );
  const observedPeak = Math.max(...last24.map((row) => row.peakRps));
  const required = Math.max(
    minReplicas,
    Math.min(
      hardReplicaCap,
      Math.ceil((Math.max(predicted, observedPeak) * 1.5) / sustainableRpsPerReplica),
    ),
  );
  // A single low-traffic day is not sufficient to shrink capacity.
  const downscaleAllowed =
    records.length >= 72 &&
    records.at(-1).time - records.at(-72).time === 71 * HOUR_MS &&
    required < currentMaxReplicas;
  const direction = required > currentMaxReplicas ? 1 : downscaleAllowed ? -1 : 0;
  return {
    minReplicas,
    maxReplicas: Math.max(minReplicas, Math.min(hardReplicaCap, currentMaxReplicas + direction)),
    reason:
      direction > 0 ? "daily_increase" : direction < 0 ? "daily_decrease" : "capacity_unchanged",
    applied: false,
    evidenceHours: records.length,
    predictedPeakRps: Number(predicted.toFixed(4)),
    observedPeakRps: Number(observedPeak.toFixed(4)),
    boundedRequiredReplicas: required,
  };
}
