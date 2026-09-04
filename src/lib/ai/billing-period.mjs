const ELIGIBLE_STATUSES = new Set(["active", "trialing", "past_due"]);

function parseTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Resolve the current, live Stripe billing period used for AI accounting.
 *
 * Database filters are repeated here deliberately. The server must not let a
 * stale, sandbox, malformed, or terminal row redefine a production user's
 * quota window even if a query or fixture becomes less restrictive later.
 */
export function resolveCurrentBillingPeriod(
  rows,
  { billingEnvironment = "live", now = Date.now() } = {},
) {
  if (!Number.isFinite(now)) throw new TypeError("now must be finite");

  let selected = null;
  for (const row of rows ?? []) {
    if (!row || row.environment !== billingEnvironment) continue;
    if (!ELIGIBLE_STATUSES.has(row.status)) continue;

    const periodStart = parseTimestamp(row.current_period_start);
    const periodEnd = parseTimestamp(row.current_period_end);
    if (periodStart === null || periodEnd === null) continue;
    if (periodStart > now || periodEnd <= now || periodEnd <= periodStart) continue;

    if (!selected || periodEnd > selected.periodEnd) {
      selected = {
        periodStart,
        periodEnd,
        value: [new Date(periodStart).toISOString(), new Date(periodEnd).toISOString()],
      };
    }
  }

  return selected?.value ?? null;
}
