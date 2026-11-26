import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";

type Lot = {
  id: string;
  kind: "included_pro" | "purchased";
  issued_at: string;
  expires_at: string;
  issued_amount: number | string;
  available_amount: number | string;
  held_amount: number | string;
  spent_amount: number | string;
  expired_amount: number | string;
  reversed_amount: number | string;
};
type Wallet = {
  tracked: boolean;
  currency: string;
  asOf: string;
  included?: number | string;
  purchased?: number | string;
  held?: number | string;
  expired?: number | string;
  debt?: number | string;
  suspended?: boolean;
  renewalAt?: string | null;
  lots?: Lot[];
  hasMore?: boolean;
};
function money(value: string | number | undefined, currency: string) {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n)) return "—";
  try {
    const format = new Intl.NumberFormat(undefined, { style: "currency", currency });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(n / 10 ** digits);
  } catch { return `${n} ${currency} minor units`; }
}
function date(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
export function DeveloperCreditWallet({ userId, accountId, revision }: { userId: string; accountId: string; revision: string }) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ enabled: boolean; wallet?: Wallet } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => () => mutation.current?.abort(), []);
  const refreshAllowance = async () => {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setUpdating(true);
    setError("");
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/developer/console", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Kova-Expected-User": userId },
        body: JSON.stringify({ operation: "refresh_credit_wallet", accountId }),
      });
      const value = await response.json();
      if (!response.ok || !value.wallet) throw new Error(value.error?.code === "developer_credit_legacy_reconciliation_required" ? "Existing credit history needs reconciliation before this account can use the new credit ledger." : "Credit renewal could not be verified.");
      if (!controller.signal.aborted) { setData(value); setPage(0); setRefresh((n) => n + 1); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Credit refresh failed.");
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (!controller.signal.aborted) setUpdating(false);
    }
  };
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetchWithTimeoutAuthenticated(
      `/api/developer/console?creditWallet=${encodeURIComponent(accountId)}&creditPage=${page}`,
      { signal, headers: { "X-Kova-Expected-User": userId } },
    );
    const value = await response.json();
    if (!response.ok) throw new Error("Credit balances could not be verified.");
    if (!signal.aborted) setData(value);
  }, [userId, accountId, page]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("Credit balances could not be verified.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [load, refresh, revision]);
  if (data?.enabled === false && !loading && !error) return null;
  const wallet = data?.wallet;
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-border p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">API credit balances</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={loading || updating} onClick={() => setRefresh((value) => value + 1)}>Refresh view</Button>
          {data?.enabled && <Button variant="outline" disabled={loading || updating} onClick={() => void refreshAllowance()}>{updating ? "Checking…" : "Check allowance and expiry"}</Button>}
        </div>
      </div>
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading verified balances…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!loading && !error && wallet && !wallet.tracked && (
        <p className="text-sm text-muted-foreground">This account is not yet using the individual credit-lot ledger. Check allowance and expiry to verify eligibility and initialize an empty account. Existing paid balances require reconciliation first.</p>
      )}
      {!loading && !error && wallet?.tracked && (
        <>
          {wallet.suspended && <p role="alert" className="text-sm text-destructive">This credit account is suspended. The amounts below are not currently spendable.</p>}
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {([
              ["Included Pro", wallet.included],
              ["Purchased", wallet.purchased],
              ["Reserved", wallet.held],
              ["Expired", wallet.expired],
            ] as const).map(([label, amount]) => (
              <div key={label} className="min-w-0 rounded-lg bg-muted/40 p-2.5 sm:p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 break-words text-lg font-semibold tabular-nums sm:text-2xl">{money(amount, wallet.currency)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Included Pro credits renew monthly and do not roll over. Purchased credits expire one calendar year after purchase. {wallet.renewalAt ? `Current paid period ends ${date(wallet.renewalAt)} (UTC).` : "No current eligible paid Pro period was found."}</p>
          {Number(wallet.debt ?? 0) > 0 && <p className="text-sm text-destructive">Unresolved funding reversal: {money(wallet.debt, wallet.currency)}</p>}
          <h3 className="font-medium">Credit lots</h3>
          <div className="grid gap-2">
            {wallet.lots?.map((lot) => (
              <article key={lot.id} className="min-w-0 rounded-lg border border-border p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-sm font-medium">{lot.kind === "included_pro" ? "Included Pro allowance" : "Purchased credit"}</p>
                  <p className="text-sm font-medium tabular-nums">{money(lot.available_amount, wallet.currency)} available</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Issued {date(lot.issued_at)} · Expires {date(lot.expires_at)} (UTC)</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  {([["Original", lot.issued_amount], ["Used", lot.spent_amount], ["Reserved", lot.held_amount], ["Reversed", lot.reversed_amount]] as const).map(([label, value]) => (
                    <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="break-words tabular-nums">{money(value, wallet.currency)}</dd></div>
                  ))}
                </dl>
              </article>
            ))}
            {!wallet.lots?.length && <p className="text-sm text-muted-foreground">No credit lots recorded.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <span className="text-sm">Page {page + 1}</span>
            <Button variant="outline" disabled={!wallet.hasMore} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
          <p className="text-xs text-muted-foreground">Balance observed at {new Date(wallet.asOf).toLocaleString()}.</p>
        </>
      )}
    </section>
  );
}
