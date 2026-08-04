const ELIGIBLE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function resolveAgentEntitlement(
  rows,
  { billingEnvironment, tierForLookupKey, now = Date.now() },
) {
  for (const row of rows ?? []) {
    if (row?.environment !== billingEnvironment) continue;
    if (!ELIGIBLE_STATUSES.has(row?.status)) continue;

    if (row.current_period_end) {
      const periodEnd = Date.parse(row.current_period_end);
      if (!Number.isFinite(periodEnd) || periodEnd <= now) continue;
    }

    const tier = tierForLookupKey(row.price_id);
    if (tier === "plus" || tier === "pro") return tier;
  }
  return null;
}
