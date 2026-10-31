import { useCallback, useEffect, useRef, useState } from "react";
import { createClientOnlyFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
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
  return (
    <section
      className="mt-8 rounded-2xl border border-border p-5 space-y-4"
      aria-labelledby="bank-connections-title"
    >
      <h2 id="bank-connections-title" className="text-lg font-semibold">
        Bank accounts
      </h2>
      <p className="text-sm text-muted-foreground">
        Connect through Plaid to read balances and recent transactions. Kova cannot move money or
        place trades. Data is fetched when you choose to read it.
      </p>
      {!ownerId ? (
        <p>Sign in to manage bank connections.</p>
      ) : (
        <>
          {status && !status.configured && (
            <p role="status">Bank connections are not enabled yet.</p>
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
