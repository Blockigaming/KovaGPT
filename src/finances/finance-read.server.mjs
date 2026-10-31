const text = (v, length = 160) => (typeof v === "string" ? v.slice(0, length) : null);
const amount = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// On-demand reads deliberately do not advance a Transactions Sync cursor or
// claim a background import. A persisted webhook receipt is only a notification;
// account balances and transactions below are fetched fresh on an explicit read.
// https://plaid.com/docs/api/products/transactions/#transactionsget
export async function readFinanceSnapshot(
  accessToken,
  requestPlaid,
  ensureCurrent,
  now = Date.now(),
) {
  const end = new Date(now).toISOString().slice(0, 10);
  const start = new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
  await ensureCurrent();
  const accounts = await requestPlaid("/accounts/get", { access_token: accessToken });
  if (
    !Array.isArray(accounts.accounts) ||
    accounts.accounts.length > 100 ||
    accounts.accounts.some(
      (account) =>
        !account ||
        typeof account.account_id !== "string" ||
        !account.account_id ||
        account.account_id.length > 256,
    ) ||
    new Set(accounts.accounts.map((account) => account.account_id)).size !==
      accounts.accounts.length
  )
    throw new Error("plaid_response_rejected");
  await ensureCurrent();
  const transactions = await requestPlaid("/transactions/get", {
    access_token: accessToken,
    start_date: start,
    end_date: end,
    options: { count: 100, offset: 0 },
  });
  if (
    !Array.isArray(transactions.transactions) ||
    transactions.transactions.length > 100 ||
    !Number.isSafeInteger(transactions.total_transactions) ||
    transactions.total_transactions < transactions.transactions.length ||
    transactions.transactions.some(
      (transaction) =>
        !transaction ||
        typeof transaction.transaction_id !== "string" ||
        !transaction.transaction_id ||
        transaction.transaction_id.length > 256,
    )
  )
    throw new Error("plaid_response_rejected");
  await ensureCurrent();
  const allowedIds = new Set(accounts.accounts.map((account) => account.account_id));
  if (transactions.transactions.some((transaction) => !allowedIds.has(transaction.account_id)))
    throw new Error("plaid_response_rejected");
  return {
    fetchedAt: new Date(now).toISOString(),
    startDate: start,
    endDate: end,
    accounts: accounts.accounts.map((account) => ({
      id: text(account.account_id, 256),
      name: text(account.name),
      mask:
        typeof account.mask === "string" && /^\d{1,4}$/u.test(account.mask) ? account.mask : null,
      type: text(account.type, 40),
      subtype: text(account.subtype, 40),
      current: amount(account.balances?.current),
      available: amount(account.balances?.available),
      currency: text(account.balances?.iso_currency_code, 3),
    })),
    transactions: transactions.transactions.map((transaction) => ({
      id: text(transaction.transaction_id, 256),
      accountId: text(transaction.account_id, 256),
      name: text(transaction.merchant_name) ?? text(transaction.name),
      date: text(transaction.date, 10),
      amount: amount(transaction.amount),
      currency: text(transaction.iso_currency_code, 3),
      pending: transaction.pending === true,
    })),
    limited: Number(transactions.total_transactions) > transactions.transactions.length,
  };
}
