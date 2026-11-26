// Customer-visible analytics only. This is an observed request-history summary,
// not a replacement for the authoritative financial ledger.
const tokenFields = ["input_tokens", "cached_input_tokens", "image_input_tokens", "output_tokens"];
const newTotals = () => ({
  requests: 0,
  measuredRequests: 0,
  tokens: Object.fromEntries(tokenFields.map((key) => [key, 0])),
  charges: Object.create(null),
});
// PostgreSQL stores customer charges at scale 8. Sum the returned decimal
// representations as integer ticks to avoid compounding binary-float error.
function chargeTicks(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return null;
  const match = /^(\d{1,20})(?:\.(\d{1,20}))?(?:e([+-]?\d{1,2}))?$/i.exec(String(value));
  if (!match) return null;
  const fraction = match[2] ?? "";
  const scale = 8 + Number(match[3] ?? 0) - fraction.length;
  if (scale < -20 || scale > 20) return null;
  const digits = BigInt(match[1] + fraction);
  if (scale >= 0) return digits * 10n ** BigInt(scale);
  const divisor = 10n ** BigInt(-scale);
  return digits % divisor === 0n ? digits / divisor : null;
}
function formatTicks(ticks) {
  const digits = ticks.toString().padStart(9, "0");
  return digits.slice(0, -8) + "." + digits.slice(-8);
}
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
  const value = chargeTicks(row.final_customer_charge);
  if (value === null) return;
  totals.charges[row.currency] = (totals.charges[row.currency] ?? 0n) + value;
}
function group(map, key, row) {
  if (!map.has(key)) map.set(key, newTotals());
  add(map.get(key), row);
}
function finish(totals) {
  return {
    ...totals,
    charges: Object.entries(totals.charges)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: formatTicks(amount) })),
  };
}
export function summarizeDeveloperUsage(rows) {
  const total = newTotals(),
    days = new Map(),
    models = new Map(),
    services = new Map(),
    statuses = new Map();
  for (const row of rows) {
    add(total, row);
    group(days, String(row.created_at).slice(0, 10), row);
    group(models, String(row.public_model), row);
    group(services, String(row.capability), row);
    group(statuses, String(row.settlement_state), row);
  }
  const entries = (map, sort) =>
    [...map].sort(sort).map(([label, totals]) => ({ label, ...finish(totals) }));
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
