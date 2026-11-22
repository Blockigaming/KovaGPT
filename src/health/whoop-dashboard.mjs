const metrics = {
  sleep: { id: "whoop.sleep", label: "WHOOP sleep performance", group: "Sleep", unit: "%" },
  recovery: { id: "whoop.recovery", label: "WHOOP recovery", group: "Recovery", unit: "%" },
  activity: { id: "whoop.strain", label: "WHOOP strain", group: "Activity", unit: "strain" },
};
const restingHeartRate = {
  id: "whoop.restingHeartRate",
  label: "WHOOP resting heart rate",
  group: "Vitals",
  unit: "bpm",
};
export const WHOOP_METRICS = [...Object.values(metrics), restingHeartRate].map((metric) => ({
  ...metric,
  aggregation: "avg",
}));

const dayMs = 86_400_000;
function dateTime(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return NaN;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : NaN;
}

export function whoopDashboardReport(summary) {
  if (
    summary?.provider !== "whoop" ||
    typeof summary.fetchedAt !== "string" ||
    !Array.isArray(summary.missing) ||
    !Array.isArray(summary.summaries) ||
    summary.summaries.length > 75
  )
    return null;
  const fetchedAt = Date.parse(summary.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return null;
  const asOf = new Date(fetchedAt).toISOString().slice(0, 10);
  const end = dateTime(asOf);
  const series = new Map();
  function add(id, date, value, maximum) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum)
      return;
    const readings = series.get(id) ?? new Map();
    // When the provider returns multiple daily samples, use the highest
    // reported strain for that date and the first score for other metrics.
    if (!readings.has(date) || (id === metrics.activity.id && value > readings.get(date))) {
      readings.set(date, value);
      series.set(id, readings);
    }
  }
  for (const row of summary.summaries) {
    if (!row || !Object.hasOwn(metrics, row.metric) || summary.missing.includes(row.metric))
      continue;
    const time = dateTime(row.date);
    if (!Number.isFinite(time) || time > end || end - time > 8 * dayMs) continue;
    if (row.metric === "activity" && row.scoreUnit !== "strain") continue;
    add(metrics[row.metric].id, row.date, row.score, row.metric === "activity" ? 21 : 100);
    if (row.metric === "recovery") add(restingHeartRate.id, row.date, row.restingHeartRate, 240);
  }
  return {
    asOf,
    fetchedAt: summary.fetchedAt,
    metrics: Object.fromEntries(
      [...series].map(([id, readings]) => [
        id,
        [
          {
            name: "WHOOP",
            days: [...readings]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([date, value]) => ({ date, value })),
          },
        ],
      ]),
    ),
    missing: Object.keys(metrics).filter((id) => summary.missing.includes(id)),
    unavailable: [],
    limited: summary.limited === true,
  };
}
