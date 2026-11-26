// Customer-visible analytics only. This is an observed request-history summary,
// not a replacement for the authoritative financial ledger.
const tokenFields = ["input_tokens", "cached_input_tokens", "image_input_tokens", "output_tokens"];
const newTotals = () => ({
  requests: 0,
  measuredRequests: 0,
  tokens: Object.fromEntries(tokenFields.map((key) => [key, 0])),
  charges: Object.create(null),
});
function add(totals, row) {
  totals.requests++;
  const usage = row.authoritative_usage;
  let measured = false;
  for (const field of tokenFields) {
    const value = usage?.[field];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      totals.tokens[field] += value;
      measured = true;
    }
  }
  if (measured) totals.measuredRequests++;
  if (row.final_customer_charge == null || !/^[A-Z]{3}$/.test(row.currency)) return;
  const value = Number(row.final_customer_charge);
  if (!Number.isFinite(value) || value < 0) return;
  totals.charges[row.currency] = (totals.charges[row.currency] ?? 0) + value;
}
function group(map, key, row) {
  if (!map.has(key)) map.set(key, newTotals());
  add(map.get(key), row);
}
function finish(totals) {
  return {
    ...totals,
    charges: Object.entries(totals.charges).sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: amount.toFixed(8) })),
  };
}
export function summarizeDeveloperUsage(rows) {
  const total = newTotals(), days = new Map(), models = new Map(), services = new Map(), statuses = new Map();
  for (const row of rows) {
    add(total, row);
    group(days, String(row.created_at).slice(0, 10), row);
    group(models, String(row.public_model), row);
    group(services, String(row.capability), row);
    group(statuses, String(row.settlement_state), row);
  }
  const entries = (map, sort) => [...map].sort(sort).map(([label, totals]) => ({ label, ...finish(totals) }));
  const alphabetic = ([a], [b]) => a.localeCompare(b);
  const byCount = ([a, av], [b, bv]) => bv.requests - av.requests || a.localeCompare(b);
  return {
    ...finish(total),
    days: entries(days, alphabetic),
    models: entries(models, byCount),
    services: entries(services, byCount),
    statuses: entries(statuses, byCount),
  };
}
