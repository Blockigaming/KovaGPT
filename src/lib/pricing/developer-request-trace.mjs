import { developerUsageDimension, developerUsageDimensions } from "./developer-usage-summary.mjs";

const statuses = [
  "reserved",
  "dispatched",
  "settled",
  "uncertain",
  "reconciliation_required",
  "rejected",
];
const publicFields = [
  "id",
  "account_id",
  "project_id",
  "api_key_id",
  "public_model",
  "capability",
  "currency",
  "settlement_state",
  "maximum_reserved_charge",
  "final_customer_charge",
  "created_at",
  "dispatched_at",
  "settled_at",
  "terminal_outcome",
];

// Only explicitly permitted customer-visible metadata. Never pass through a raw row,
// upstream response ID, fingerprint, payload, provider costs or reconciliation reason.
export function developerRequestTrace(row, recentRows, observedAt) {
  const request = Object.fromEntries(publicFields.map((field) => [field, row[field] ?? null]));
  const meters = Object.fromEntries(
    Object.keys(developerUsageDimensions).map((key) => [
      key,
      developerUsageDimension(row.authoritative_usage, key),
    ]),
  );
  const timeline = [
    { stage: "Reserved", at: request.created_at },
    { stage: "Dispatched", at: request.dispatched_at },
    {
      stage: request.terminal_outcome === "released" ? "Released" : "Settled",
      at: request.settled_at,
    },
  ].filter((event) => typeof event.at === "string" && Number.isFinite(Date.parse(event.at)));
  const counts = Object.fromEntries(statuses.map((state) => [state, 0]));
  const rows = recentRows.slice(0, 100);
  for (const item of rows)
    if (Object.hasOwn(counts, item.settlement_state)) counts[item.settlement_state]++;
  return {
    request,
    meters,
    timeline,
    serviceObservation: {
      observedAt,
      sampleSize: rows.length,
      truncated: recentRows.length > 100,
      counts,
      // Settlement outcomes are not provider uptime or an SLA measurement.
      providerHealth: "unknown",
    },
  };
}
