import { useCallback, useEffect, useRef, useState } from "react";
import {
  Boxes,
  Building2,
  CalendarDays,
  CreditCard,
  Globe2,
  PackageOpen,
} from "./ui/product-icons.tsx";
import { toast } from "sonner";
import { createClientOnlyFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  connections: {
    id: string;
    status: string;
    country: string;
    created_at: string;
    maintenanceAllowed?: boolean;
  }[];
};
const getPlaidSdk = createClientOnlyFn(async () => {
  const { loadPlaidLink } = await import("@/finances/plaid-link.client");
  return loadPlaidLink();
});
const exampleSpending = [
  {
    label: "Rent and utilities",
    cents: 468942,
    icon: Building2,
    color: "#08b94d",
    examples: "Rent, electricity, and internet",
  },
  {
    label: "Groceries",
    cents: 214367,
    icon: Boxes,
    color: "#10913e",
    examples: "Supermarkets, farmers markets, and pantry staples",
  },
  {
    label: "Subscriptions",
    cents: 108924,
    icon: CreditCard,
    color: "#147235",
    examples: "Streaming, cloud storage, and software plans",
  },
  {
    label: "Dining",
    cents: 132158,
    icon: CalendarDays,
    color: "#078af3",
    examples: "Coffee shops, takeout, and restaurants",
  },
  {
    label: "Travel and transport",
    cents: 174683,
    icon: Globe2,
    color: "#116bc0",
    examples: "Transit passes, rideshares, and flights",
  },
  {
    label: "Shopping and other",
    cents: 149318,
    icon: PackageOpen,
    color: "#155595",
    examples: "Clothing, household goods, and gifts",
  },
];
const exampleTotal = exampleSpending.reduce((total, category) => total + category.cents, 0);
const exampleCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function FinanceExampleDetails({ category }: { category: (typeof exampleSpending)[number] }) {
  const share = Math.round((category.cents / exampleTotal) * 100);
  return (
    <TooltipContent sideOffset={8} className="max-w-[260px] rounded-xl px-3.5 py-3">
      <p className="text-xs text-muted-foreground">Sample spending</p>
      <p className="mt-1 font-semibold">{category.label}</p>
      <p className="tabular-nums">
        {exampleCurrency.format(category.cents / 100)} · {share}% of total
      </p>
      <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
        {category.examples}
      </p>
    </TooltipContent>
  );
}

function FinanceSpendingPreview({
  action,
  unavailable,
}: {
  action?: React.ReactNode;
  unavailable: boolean;
}) {
  return (
    <div className="kova-finance-preview mx-auto w-full max-w-[680px] space-y-14 py-8 sm:py-14">
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
        {action}
        {unavailable && (
          <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-medium text-foreground">
            Coming soon
          </span>
        )}
      </header>
      <section aria-labelledby="finance-example-spending" className="text-foreground">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 id="finance-example-spending" className="font-semibold">
              Spending
            </h3>
            <p className="text-xs text-muted-foreground">Sample data</p>
          </div>
          <p className="font-semibold tabular-nums">{exampleCurrency.format(exampleTotal / 100)}</p>
        </div>
        <TooltipProvider delayDuration={150}>
          <div
            aria-label="Sample spending breakdown"
            role="group"
            className="my-4 flex h-10 gap-0.5"
          >
            {exampleSpending.map((category) => (
              <Tooltip key={category.label}>
                <TooltipTrigger asChild>
                  <span
                    aria-label={category.label}
                    role="img"
                    tabIndex={0}
                    className="min-w-0 rounded transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    style={{ backgroundColor: category.color, flex: category.cents }}
                  />
                </TooltipTrigger>
                <FinanceExampleDetails category={category} />
              </Tooltip>
            ))}
          </div>
          <ul className="space-y-1">
            {exampleSpending.map((category) => {
              const { label, cents, icon: Icon } = category;
              return (
                <li key={label}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        tabIndex={0}
                        className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring sm:text-base"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                            <Icon aria-hidden="true" className="size-4" />
                          </span>
                          <span>{label}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {exampleCurrency.format(cents / 100)}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <FinanceExampleDetails category={category} />
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </TooltipProvider>
      </section>
    </div>
  );
}

export function BankConnectionsPanel({
  ownerId,
  visible = true,
}: {
  ownerId: string | null;
  visible?: boolean;
}) {
  const [status, setStatus] = useState<FinanceStatus | null>(null);
  const [busy, setBusyState] = useState(false);
  const running = useRef(false);
  const setBusy = useCallback((value: boolean) => {
    running.current = value;
    setBusyState(value);
  }, []);
  const resumed = useRef(false);
  const [statusFailed, setStatusFailed] = useState(false);
  const [linking, setLinking] = useState(false);
  const initialRead = useRef(false);
  const newlyLinked = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<FinanceSnapshot | null>(null);
  const [disconnect, setDisconnect] = useState<string | null>(null);
  const [restoreWebhook, setRestoreWebhook] = useState<string | null>(null);
  const active = useRef(true);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const handler = useRef<PlaidHandler | null>(null);
  const request = useCallback(
    (url: string, body?: object) =>
      fetchWithTimeoutAuthenticated(
        url,
        {
          method: body ? "POST" : "GET",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Kova-Owner": ownerId ?? "" },
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
      if (active.current) {
        setStatus(body);
        setStatusFailed(false);
      }
    } catch {
      if (active.current) {
        setStatus(null);
        setStatusFailed(true);
        if (visibleRef.current) toast.error("Bank connection status is unavailable.");
      }
    }
  }, [ownerId, request]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      handler.current?.destroy();
    };
  }, []);
  useEffect(() => {
    if (visible) void reload();
  }, [visible, reload]);
  const openLink = useCallback(
    async (linkToken: string, receivedRedirectUri?: string) => {
      const sdk = await getPlaidSdk();
      if (!active.current) return;
      if (!sdk) throw new Error("plaid_sdk_unavailable");
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
              const connection = await result.json();
              if (!result.ok || typeof connection.id !== "string") throw new Error();
              if (active.current) {
                newlyLinked.current = connection.id;
                initialRead.current = false;
                toast.success("Accounts linked");
                await reload();
              }
            } catch {
              if (active.current)
                toast.error(
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
          if (error) toast.error("Plaid could not finish linking this bank. Try again later.");
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
      resumed.current ||
      !new URL(window.location.href).searchParams.has("oauth_state_id")
    )
      return;
    resumed.current = true;
    const token = readPlaidLinkSession(window.sessionStorage, ownerId);
    if (!token) {
      toast.error(
        "This bank sign-in session expired or belongs to another account. Start a new bank connection.",
      );
      return;
    }
    setBusy(true);
    const callbackUrl = new URL(window.location.href);
    if (callbackUrl.searchParams.get("kova_plaid_return") === "apps") {
      callbackUrl.pathname = "/apps";
      callbackUrl.searchParams.delete("kova_plaid_return");
    }
    void openLink(token, callbackUrl.href).catch(() => {
      if (active.current) {
        setBusy(false);
        toast.error("Bank sign-in could not resume. Start a new bank connection.");
      }
    });
  }, [ownerId, status, openLink, setBusy]);
  const connect = async () => {
    if (running.current || !ownerId || !status?.configured) return;
    setBusy(true);
    setLinking(true);
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
        toast.error("Bank linking is unavailable. Please try again.");
      }
    } finally {
      if (active.current) setLinking(false);
    }
  };
  const manage = useCallback(
    async (
      connectionId: string,
      action: "read" | "disconnect" | "restore_webhook" | "maintenance",
      enabled?: boolean,
    ) => {
      if (running.current) return;
      setBusy(true);
      if (action === "disconnect") setSnapshot(null);
      try {
        const response = await request("/api/finances/manage", {
          connectionId,
          action,
          ...(action === "restore_webhook" ? { confirmed: true } : {}),
          ...(action === "maintenance" ? { enabled } : {}),
        });
        const body = await response.json();
        if (!response.ok) throw new Error();
        if (active.current) {
          if (action === "read") setSnapshot(body);
          else if (action === "maintenance") {
            if (body.maintenanceAllowed !== enabled) throw new Error();
            setStatus(
              (current) =>
                current && {
                  ...current,
                  connections: current.connections.map((connection) =>
                    connection.id === connectionId
                      ? { ...connection, maintenanceAllowed: body.maintenanceAllowed }
                      : connection,
                  ),
                },
            );
          } else if (action === "restore_webhook") {
            if (body.restored !== true) throw new Error();
            toast.success("Plaid webhook restored.");
          } else {
            initialRead.current = false;
            toast.success("Bank disconnected and Plaid access removed.");
            await reload();
          }
        }
      } catch {
        if (active.current)
          toast.error(
            action === "read"
              ? "The bank could not be read. Reconnect or try again later."
              : action === "disconnect"
                ? "Disconnect could not be confirmed. Refresh status before retrying."
                : action === "maintenance"
                  ? "The permission change could not be confirmed. Refresh bank status."
                  : "Plaid did not confirm the webhook change.",
          );
      } finally {
        if (active.current) {
          setBusy(false);
          setDisconnect(null);
          setRestoreWebhook(null);
        }
      }
    },
    [reload, request, setBusy],
  );
  useEffect(() => {
    if (
      !visible ||
      !ownerId ||
      !status?.configured ||
      busy ||
      running.current ||
      initialRead.current
    )
      return;
    const connection = status.connections.find(
      (candidate) =>
        candidate.status === "connected" &&
        (!newlyLinked.current || candidate.id === newlyLinked.current),
    );
    if (!connection) return;
    initialRead.current = true;
    newlyLinked.current = null;
    void manage(connection.id, "read");
  }, [visible, ownerId, status, busy, manage]);
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
  const hasConnections = Boolean(ownerId && status?.connections.length);
  // Any in-progress state (opening Plaid, saving, reading) shows the spinner inside the button.
  const showSpinner = linking || busy;
  const linkButton = (
    <Button
      onClick={() => void connect()}
      disabled={busy || !status?.configured}
      aria-busy={showSpinner}
      aria-label={showSpinner ? "Connecting a bank" : undefined}
      className="min-w-[132px] bg-white text-neutral-950 hover:bg-neutral-100 disabled:opacity-100"
    >
      {showSpinner ? (
        <span
          aria-hidden="true"
          className="size-4 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
        />
      ) : (
        "Connect a bank"
      )}
    </Button>
  );
  if (!hasConnections) {
    return (
      <>
        <FinanceSpendingPreview
          action={ownerId && status?.configured ? linkButton : undefined}
          unavailable={status?.configured === false}
        />
        {ownerId && !status && !statusFailed && (
          <p className="text-center text-sm text-muted-foreground" role="status">
            Checking bank connections…
          </p>
        )}
        {ownerId && statusFailed && (
          <div className="text-center">
            <Button variant="outline" onClick={() => void reload()}>
              Retry
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <section className="mt-8 space-y-5" aria-labelledby="bank-connections-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="bank-connections-title" className="text-xl font-semibold tracking-tight">
          {status?.connections.some((connection) => connection.status === "connected")
            ? "Accounts linked"
            : "Bank accounts"}
        </h2>
        <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          Read-only by default
        </span>
      </div>
      {snapshot && <FinanceActivityDashboard snapshot={snapshot} />}
      <p className="text-sm text-muted-foreground">
        Connect through Plaid to read balances and recent transactions. Kova cannot move money or
        place trades.
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
          <div className="flex flex-wrap gap-2">
            {linkButton}
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
                  disabled={busy || !status.configured || connection.status !== "connected"}
                  onClick={() => void manage(connection.id, "read")}
                >
                  Refresh balances and transactions
                </Button>
                {status.configured && connection.status === "connected" && (
                  <>
                    <Button
                      variant="outline"
                      aria-pressed={connection.maintenanceAllowed === true}
                      disabled={busy}
                      onClick={() =>
                        void manage(connection.id, "maintenance", !connection.maintenanceAllowed)
                      }
                    >
                      {connection.maintenanceAllowed
                        ? "Disable connection maintenance"
                        : "Allow connection maintenance"}
                    </Button>
                    {connection.maintenanceAllowed && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRestoreWebhook(connection.id)}
                      >
                        Restore Plaid webhook
                      </Button>
                    )}
                  </>
                )}
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
          <div className="kova-transaction-table overflow-x-auto">
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
          {snapshot.transactions.length > 0 && (
            <section className="kova-transaction-list hidden" aria-label="Recent transactions">
              <h3 className="font-medium">Recent transactions</h3>
              {snapshot.limited && (
                <p className="text-sm text-muted-foreground">Latest 100 transactions</p>
              )}
              <ul>
                {snapshot.transactions.map((transaction, index) => (
                  <li key={transaction.id ?? index}>
                    <div>
                      <strong>
                        {transaction.name}
                        {transaction.pending ? " (pending)" : ""}
                      </strong>
                      {transaction.date && (
                        <time dateTime={transaction.date}>{transaction.date}</time>
                      )}
                    </div>
                    <span>{money(transaction.amount, transaction.currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!snapshot.transactions.length && (
            <p>
              {snapshot.transactionsPending
                ? "Plaid is still preparing your transactions. Refresh in a moment."
                : "No transactions are available for this period yet."}
            </p>
          )}
        </div>
      )}
      <ConfirmActionDialog
        open={restoreWebhook !== null}
        onOpenChange={(open) => !busy && !open && setRestoreWebhook(null)}
        title="Restore the Plaid webhook?"
        description="Plaid will send connection status updates for this linked bank to KovaGPT again."
        confirmLabel="Restore webhook"
        disabled={busy}
        onConfirm={() => restoreWebhook && void manage(restoreWebhook, "restore_webhook")}
      />
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
