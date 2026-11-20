export const MAX_APPLE_HEALTH_REPORT_BYTES = 2048;

export function parseAppleHealthReport(text) {
  const maxDays = 7;
  const dayMs = 86_400_000;
  if (typeof text !== "string" || text.length > MAX_APPLE_HEALTH_REPORT_BYTES) {
    throw new Error("Invalid Apple Health report");
  }
  const report = JSON.parse(text);
  if (
    !report ||
    report.version !== 1 ||
    report.source !== "kovagpt.apple-health" ||
    !Array.isArray(report.days) ||
    report.days.length < 1 ||
    report.days.length > maxDays
  ) {
    throw new Error("Invalid Apple Health report");
  }
  let firstDay;
  let previousDay;
  return report.days.map((entry) => {
    if (
      !entry ||
      typeof entry.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      !Number.isSafeInteger(entry.steps) ||
      entry.steps < 0
    ) {
      throw new Error("Invalid Apple Health entry");
    }
    const timestamp = Date.parse(entry.date + "T00:00:00Z");
    firstDay ??= timestamp;
    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== entry.date ||
      (previousDay !== undefined && timestamp <= previousDay) ||
      timestamp - firstDay >= maxDays * dayMs
    ) {
      throw new Error("Invalid Apple Health report date");
    }
    previousDay = timestamp;
    return { date: entry.date, steps: entry.steps };
  });
}
