// Plaid amounts are positive for outflows and negative for inflows.
// Never add different currencies or unposted transactions to USD totals.
export function summarizeUsdActivity(records) {
  const byDay = new Map();
  const byCategory = new Map();
  let spentCents = 0;
  let receivedCents = 0;
  let excludedPending = 0;
  let excludedCurrency = 0;
  let excludedInvalid = 0;

  for (const record of records) {
    if (record?.pending === true) {
      excludedPending++;
      continue;
    }
    if (record?.currency !== "USD") {
      excludedCurrency++;
      continue;
    }
    const value = record.amount;
    const date = record.date;
    const cents = typeof value === "number" ? Math.round(value * 100) : NaN;
    if (
      !Number.isFinite(value) ||
      !Number.isSafeInteger(cents) ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date + "T00:00:00Z")) ||
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
    ) {
      excludedInvalid++;
      continue;
    }
    const day = byDay.get(date) ?? { date, spentCents: 0, receivedCents: 0 };
    if (cents >= 0) {
      spentCents += cents;
      day.spentCents += cents;
      if (cents > 0) {
        const category = record.category || "UNCATEGORIZED";
        byCategory.set(category, (byCategory.get(category) ?? 0) + cents);
      }
    } else {
      receivedCents += -cents;
      day.receivedCents += -cents;
    }
    byDay.set(date, day);
  }

  return {
    spent: spentCents / 100,
    received: receivedCents / 100,
    days: [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ date, spentCents: daySpent, receivedCents: dayReceived }) => ({
        date,
        spent: daySpent / 100,
        received: dayReceived / 100,
      })),
    categories: [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([category, cents]) => ({ category, amount: cents / 100 })),
    excludedPending,
    excludedCurrency,
    excludedInvalid,
  };
}
