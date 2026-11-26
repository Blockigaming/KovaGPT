// Pure policy for the proposed developer credit-lot ledger.
// Values are exact integer ticks (10^-8 of the currency minor unit).
// A database transaction must lock the account, verify payment/plan state,
// persist reservations and settle them against the original lots. This
// module alone never grants, expires, reserves or spends real credits.
export const PRO_API_ALLOWANCE_USD_MINOR = 8000;
const fail = (code) => {
  throw new Error(code);
};
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    fail("developer_credit_date_invalid");
  const date = new Date(value);
  if (!Number.isFinite(+date) || date.toISOString() !== value)
    fail("developer_credit_date_invalid");
  return date;
};

// Calendar-year expiry in UTC. Feb 29 expires on Feb 28 the following year.
export function purchasedCreditExpiresAt(purchasedAt) {
  const date = validDate(purchasedAt);
  const year = date.getUTCFullYear() + 1;
  if (year > 9999) fail("developer_credit_date_invalid");
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const target = new Date(+date);
  target.setUTCDate(1);
  target.setUTCFullYear(year);
  target.setUTCMonth(month);
  const last = new Date(+target);
  last.setUTCMonth(month + 1, 0);
  target.setUTCDate(Math.min(day, last.getUTCDate()));
  return target.toISOString();
}

const amount = (value) => {
  if (typeof value !== "bigint" || value < 0n) fail("developer_credit_amount_invalid");
  return value;
};

/**
 * Select the funding lots for a new reservation, without mutating balances.
 * Included credits fund API only; consumer fallback requires explicit opt-in.
 * Expired lots and inactive Pro grants are excluded. Return null if the
 * whole reservation cannot be covered. Only accept server-owned lot records.
 */
export function planDeveloperCreditReservation({
  lots,
  requestedTicks,
  now,
  surface,
  consumerOptIn = false,
  proEligible = false,
}) {
  const requested = amount(requestedTicks);
  if (requested === 0n || !["api", "consumer"].includes(surface) || !Array.isArray(lots))
    fail("developer_credit_request_invalid");
  const at = +validDate(now);
  if (surface === "consumer" && consumerOptIn !== true) return null;
  const seen = new Set();
  const eligible = [];
  for (const lot of lots) {
    if (
      !lot ||
      typeof lot.id !== "string" ||
      !lot.id ||
      seen.has(lot.id) ||
      !["included_pro", "purchased"].includes(lot.kind)
    )
      fail("developer_credit_lot_invalid");
    seen.add(lot.id);
    const available = amount(lot.availableTicks);
    const expiry = +validDate(lot.expiresAt);
    if (available === 0n || expiry <= at) continue;
    if (lot.kind === "included_pro" && (surface !== "api" || proEligible !== true)) continue;
    eligible.push({ id: lot.id, kind: lot.kind, expiry, available });
  }
  eligible.sort(
    (a, b) =>
      Number(a.kind !== "included_pro") - Number(b.kind !== "included_pro") ||
      a.expiry - b.expiry ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let left = requested;
  const allocations = [];
  for (const lot of eligible) {
    const ticks = left < lot.available ? left : lot.available;
    allocations.push({ lotId: lot.id, ticks });
    left -= ticks;
    if (left === 0n) return allocations;
  }
  return null;
}
