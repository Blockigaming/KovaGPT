import { useCallback, useEffect, useRef, useState } from "react";
import {
  Boxes,
  Building2,
  CalendarDays,
  CreditCard,
  Globe2,
  PackageOpen,
} from "@/components/ui/product-icons";
import { createClientOnlyFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { FinanceActivityDashboard } from "@/components/FinanceActivityDashboard";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import type { PlaidHandler } from "@/finances/plaid-link.client";
import type { FinanceSnapshot } from "@/finances/finance-read.server.mjs";
import {
  savePlaidLinkSession,
  readPlaidLinkSession,
  clearPlaidLinkSession,
} from "@/finances/plaid-link-session.mjs";

type FinanceStatus = {
  configured: boolean;
  planEligible: boolean;
  connections: { id: string; status: string; country: string; created_at: string }[];
};
const getPlaidSdk = createClientOnlyFn(async () => {
  const { loadPlaidLink } = await import("@/finances/plaid-link.client");
  return loadPlaidLink();
});
const exampleSpending = [
  { label: "Rent and utilities", cents: 468942, icon: Building2, color: "#08b94d" },
  { label: "Groceries", cents: 214367, icon: Boxes, color: "#10913e" },
  { label: "Subscriptions", cents: 108924, icon: CreditCard, color: "#147235" },
  { label: "Dining", cents: 132158, icon: CalendarDays, color: "#078af3" },
  { label: "Travel and transport", cents: 174683, icon: Globe2, color: "#116bc0" },
  { label: "Shopping and other", cents: 149318, icon: PackageOpen, color: "#155595" },
];
const exampleTotal = exampleSpending.reduce((total, category) => total + category.cents, 0);
const exampleCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function FinanceSpendingPreview() {
  return (
    <div className="mx-auto w-full max-w-[680px] space-y-14 py-8 sm:py-14">
      <header className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-14 place-items-center rounded-full border border-border bg-card">
          <span aria-hidden="true" className="text-2xl font-semibold text-emerald-500">
            $
          </span>
        </span>
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          A new way to manage your finances
        </h2>
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
          See how Kova can help you make sense of spending, subscriptions, balances, and
          investments.
        </p>
        <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-medium text-foreground">
          Coming soon
        </span>
      </header>
      <section
        aria-labelledby="finance-example-spending"
        className="rounded-3xl border border-border bg-card p-4 text-card-foreground sm:p-6"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 id="finance-example-spending" className="font-semibold">
              Spending
            </h3>
            <p className="text-xs text-muted-foreground">Sample data</p>
          </div>
          <p className="font-semibold tabular-nums">{exampleCurrency.format(exampleTotal / 100)}</p>
        </div>
        <div aria-hidden="true" className="my-4 flex h-10 gap-0.5">
          {exampleSpending.map(({ label, cents, color }) => (
            <span key={label} className="rounded" style={{ backgroundColor: color, flex: cents }} />
          ))}
        </div>
        <ul className="space-y-3">
          {exampleSpending.map(({ label, cents, icon: Icon }) => (
            <li
              key={label}
              className="flex items-center justify-between gap-3 text-sm sm:text-base"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span>{label}</span>
              </span>
              <span className="shrink-0 tabular-nums">{exampleCurrency.format(cents / 100)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function BankConnectionsPanel({ ownerId }: { ownerId: string | null }) {
  const [status, setStatus] = useState<FinanceStatus | null>(null);
  const [busy, setBusyState] = useState(false);
  const running = useRef(false);
  const setBusy = useCallback((value: boolean) => {
    running.current = value;
    setBusyState(value);
  }, []);
  const resumed = useRef(false);
  const [message, setMessage] = useState("");
  const [snapshot, setSnapshot] = useState<FinanceSnapshot | null>(null);
  const [disconnect, setDisconnect] = useState<string | null>(null);
  const active = useRef(true);
  const handler = useRef<PlaidHandler | null>(null);
  const request = useCallback(
    (url: string, body?: object) =>
      fetchWithTimeoutAuthenticated(
        url,
        {
          method: body ? "POST" : "GET",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Kova-Expected-Owner": ownerId ?? "" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        30_000,
      ),
    [ownerId],
  );
  const reload = useCallback(async () => {
    if (!ownerId) return;
    try {
      const response = await request("/api/finances/manage");
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.connections)) throw new Error();
      if (active.current) setStatus(body);
    } catch {
      if (active.current) {
        setStatus(null);
        setMessage("Bank connection status is unavailable. Refresh to try again.");
      }
    }
  }, [ownerId, request]);
  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
      handler.current?.destroy();
    };
  }, [reload]);
  const openLink = useCallback(
    async (linkToken: string, receivedRedirectUri?: string) => {
      const sdk = await getPlaidSdk();
      if (!sdk || !active.current) return;
      let settled = false;
      handler.current?.destroy();
      handler.current = sdk.create({
        token: linkToken,
        ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
        onSuccess: (publicToken) => {
          if (settled || !active.current) return;
          settled = true;
          clearPlaidLinkSession(window.sessionStorage, ownerId ?? "");
          void (async () => {
            try {
              const result = await request("/api/finances/exchange", {
                publicToken,
                country: "US",
              });
              if (!result.ok) throw new Error();
              if (active.current) {
                setMessage("Bank connected. Choose Read balances and transactions to fetch data.");
                await reload();
              }
            } catch {
              if (active.current)
                setMessage(
                  "The link result could not be confirmed. Refresh connection status before starting another link.",
                );
            } finally {
              if (active.current) {
                setBusy(false);
                handler.current?.destroy();
                handler.current = null;
              }
            }
          })();
        },
        onExit: (error) => {
          if (settled || !active.current) return;
          settled = true;
          clearPlaidLinkSession(window.sessionStorage, ownerId ?? "");
          setBusy(false);
          setMessage(
            error
              ? "Plaid could not finish linking this bank. Try again later."
              : "Bank linking cancelled.",
          );
          handler.current?.destroy();
          handler.current = null;
        },
      });
      handler.current.open();
    },
    [ownerId, reload, request, setBusy],
  );
  useEffect(() => {
    if (
      !ownerId ||
      !status?.configured ||
      !status.planEligible ||
      resumed.current ||
      !new URL(window.location.href).searchParams.has("oauth_state_id")
    )
      return;
    resumed.current = true;
    const token = readPlaidLinkSession(window.sessionStorage, ownerId);
    if (!token) {
      setMessage(
        "This bank sign-in session expired or belongs to another account. Start a new bank connection.",
      );
      return;
    }
    setBusy(true);
    void openLink(token, window.location.href).catch(() => {
      if (active.current) {
        setBusy(false);
        setMessage("Bank sign-in could not resume. Start a new bank connection.");
      }
    });
  }, [ownerId, status, openLink, setBusy]);
  const connect = async () => {
    if (running.current || !ownerId || !status?.configured || !status.planEligible) return;
    setBusy(true);
    setMessage("");
    setSnapshot(null);
    try {
      const response = await request("/api/finances/link-token", { country: "US" });
      const body = await response.json();
      if (
        !response.ok ||
        typeof body.link_token !== "string" ||
        typeof body.expiration !== "string"
      )
        throw new Error();
      if (!active.current) return;
      savePlaidLinkSession(window.sessionStorage, ownerId, body.link_token, body.expiration);
      await openLink(body.link_token);
    } catch {
      if (active.current) {
        setBusy(false);
        setMessage("Bank linking is unavailable. Refresh status and try again later.");
      }
    }
  };
  const manage = async (connectionId: string, action: "read" | "disconnect") => {
    if (running.current) return;
    setBusy(true);
    setMessage("");
    setSnapshot(null);
    try {
      const response = await request("/api/finances/manage", { connectionId, action });
      const body = await response.json();
      if (!response.ok) throw new Error();
      if (active.current) {
        if (action === "read") setSnapshot(body);
        else {
          setMessage("Bank disconnected and Plaid access removed.");
          await reload();
        }
      }
    } catch {
      if (active.current)
        setMessage(
          action === "read"
            ? "The bank could not be read. Reconnect or try again later."
            : "Disconnect could not be confirmed. Refresh status before retrying.",
        );
    } finally {
      if (active.current) {
        setBusy(false);
        setDisconnect(null);
      }
    }
  };
  const money = (amount: number | null, currency: string | null) => {
    if (amount === null) return "Not available";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency ?? "USD",
      }).format(amount);
    } catch {
      return String(amount);
    }
  };
  if (!status?.configured && !status?.connections.length && !message) {
    return <FinanceSpendingPreview />;
  }

  return (
    <section
      className="mt-8 space-y-5 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6"
      aria-labelledby="bank-connections-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="bank-connections-title" className="text-xl font-semibold tracking-tight">
          Bank accounts
        </h2>
        <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          Read-only connections
        </span>
      </div>
      {snapshot ? <FinanceActivityDashboard snapshot={snapshot} /> : <FinanceSpendingPreview />}
      <p className="text-sm text-muted-foreground">
        Connect through Plaid to read balances and recent transactions. Kova cannot move money or
        place trades. Data is fetched when you choose to read it.
      </p>
      {!ownerId ? (
        <p>Sign in to manage bank connections.</p>
      ) : (
        <>
          {status && !status.configured && (
            <p
              role="status"
              className="w-fit rounded-full bg-amber-500/10 px-3 py-1 text-sm text-amber-700 dark:text-amber-300"
            >
              Coming soon
            </p>
          )}
          {status && !status.planEligible && (
            <p>
              Bank reads require Kova Plus or Pro. You can disconnect an existing bank on any plan.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void connect()}
              disabled={busy || !status?.configured || !status.planEligible}
            >
              Connect bank
            </Button>
            <Button variant="outline" onClick={() => void reload()} disabled={busy}>
              Refresh bank status
            </Button>
          </div>
          {status?.connections.map((connection, index) => (
            <div key={connection.id} className="rounded-xl border border-border p-3 space-y-2">
              <p className="font-medium">
                Bank connection {index + 1} ·{" "}
                {connection.status === "connected" ? "Connected" : "Reconnect required"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    !status.planEligible ||
                    !status.configured ||
                    connection.status !== "connected"
                  }
                  onClick={() => void manage(connection.id, "read")}
                >
                  Read balances and transactions
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDisconnect(connection.id)}
                >
                  Disconnect bank {index + 1}
                </Button>
              </div>
            </div>
          ))}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Working…</p>}
      {snapshot && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Fetched {new Date(snapshot.fetchedAt).toLocaleString()}. Transactions cover the last 30
            days; up to 100 are shown. Positive amounts are money spent; negative amounts are money
            received.
          </p>
          <ul className="space-y-2">
            {snapshot.accounts.map((account, index) => (
              <li key={account.id ?? index} className="rounded-xl bg-muted/40 p-3">
                <strong>{account.name ?? "Account"}</strong>
                {account.mask && ` ····${account.mask}`}
                <p>
                  Current balance: {money(account.current, account.currency)} · Available:{" "}
                  {money(account.available, account.currency)}
                </p>
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="text-left font-medium mb-2">
                Recent transactions{snapshot.limited ? " (limited to 100)" : ""}
              </caption>
              <thead>
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Description</th>
                  <th className="p-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.transactions.map((transaction, index) => (
                  <tr key={transaction.id ?? index}>
                    <td className="p-2 whitespace-nowrap">{transaction.date}</td>
                    <td className="p-2">
                      {transaction.name}
                      {transaction.pending ? " (pending)" : ""}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {money(transaction.amount, transaction.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!snapshot.transactions.length && (
            <p>No transactions are available for this period yet.</p>
          )}
        </div>
      )}
      <ConfirmActionDialog
        open={disconnect !== null}
        onOpenChange={(open) => !busy && !open && setDisconnect(null)}
        title="Disconnect this bank?"
        description="This revokes Plaid access to this bank and removes its saved Kova connection. Link the bank again if you want to reconnect."
        confirmLabel="Disconnect bank"
        disabled={busy}
        onConfirm={() => disconnect && void manage(disconnect, "disconnect")}
      />
    </section>
  );
}
