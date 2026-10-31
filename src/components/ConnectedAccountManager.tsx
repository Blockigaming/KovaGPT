import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { authFetch, fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { searchConnectedAccount, refreshConnectedAccess } from "@/lib/connected-accounts.functions";
import {
  CONNECTION_FLOWS,
  canReadConnection,
  connectionAccounts,
  connectionAuthorizationUrl,
  safeConnectionLink,
  type ConnectedAccount,
} from "@/integrations/connection-flows.mjs";
import type { ConnectionReadResult } from "@/integrations/connection-read.server.mjs";
import { toast } from "sonner";
import type { AccountStatus } from "@/hooks/use-connected-accounts";

export function ConnectedAccountManager({
  id,
  data,
  loading,
  error,
  reload,
}: {
  id: string;
  data: AccountStatus | null;
  loading: boolean;
  error: boolean;
  reload: () => Promise<boolean>;
}) {
  const flow = CONNECTION_FLOWS[id];
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [recordType, setRecordType] = useState<"accounts" | "contacts" | "opportunities">(
    "accounts",
  );
  const [result, setResult] = useState<ConnectionReadResult | null>(null);
  const [disconnect, setDisconnect] = useState<ConnectedAccount | null>(null);
  const active = useRef(true);
  const readAccount = useServerFn(searchConnectedAccount);
  const refreshAccess = useServerFn(refreshConnectedAccess);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (!flow) return null;
  const accounts = connectionAccounts(data?.accounts ?? [], id);
  const configured =
    data?.configuredProviders.some((provider) => provider.id === flow.provider) === true;
  const start = async (existingAccountId?: string) => {
    if (busy || loading || error || !configured) return;
    setBusy(true);
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/integrations/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: flow.provider,
          optionalScopes: flow.scopes,
          returnPath: `/apps?connection_view=${id}`,
          existingAccountId,
        }),
      });
      const body = await response.json();
      const url = connectionAuthorizationUrl(flow.provider, body.url);
      if (!response.ok || !url) throw new Error("connection_start_failed");
      if (active.current) window.location.assign(url);
    } catch {
      if (active.current) toast.error("Could not start this connection. Refresh and try again.");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const search = async (accountId: string) => {
    if (busy || !query.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const next = await readAccount({
        data: {
          connectionId: id,
          accountId,
          query,
          ...(id === "salesforce" ? { recordType } : {}),
        },
      });
      if (active.current) {
        if ("error" in next) toast.error(next.error);
        else setResult(next);
      }
    } catch {
      if (active.current) toast.error("The connected service could not be read. Try again later.");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (!disconnect || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await authFetch("/api/integrations/oauth/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: disconnect.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error("disconnect_failed");
      if (active.current)
        toast.success(
          body.providerRevoked
            ? "Account disconnected and provider access revoked."
            : "Account disconnected locally. Provider revocation may still be pending.",
        );
    } catch {
      if (active.current)
        toast.error("Disconnect outcome could not be confirmed. Refresh status before retrying.");
    } finally {
      if (active.current) {
        setDisconnect(null);
        setBusy(false);
        await reload();
      }
    }
  };
  return (
    <section className="spec400-plugin-detail-section" aria-label={`${flow.label} accounts`}>
      <h3>Accounts</h3>
      <p>{flow.description}</p>
      {loading && <p role="status">Checking accounts…</p>}
      {error && (
        <p role="status">Account status is unavailable. Refresh before taking an action.</p>
      )}
      {!loading && !error && !configured && (
        <p role="status">Connection setup is incomplete in this deployment.</p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        <Button
          onClick={() => {
            void start();
          }}
          disabled={!configured || loading || error || busy}
        >
          {busy ? "Working…" : accounts.length ? "Connect or update permissions" : "Connect"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                await refreshAccess();
              } catch {
                if (active.current)
                  toast.error("Could not renew access. Refresh or reconnect the account.");
              } finally {
                if (active.current) {
                  await reload();
                  setBusy(false);
                }
              }
            })();
          }}
          disabled={loading || busy}
        >
          Refresh status
        </Button>
      </div>
      {accounts.length > 0 && (
        <>
          {id === "salesforce" && (
            <div className="mt-4 space-y-2">
              <label htmlFor="salesforce-record-type">Record type</label>
              <Select
                value={recordType}
                onValueChange={(value: "accounts" | "contacts" | "opportunities") => {
                  setRecordType(value);
                  setResult(null);
                }}
              >
                <SelectTrigger id="salesforce-record-type" aria-label="Record type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="accounts">Accounts</SelectItem>
                  <SelectItem value="contacts">Contacts</SelectItem>
                  <SelectItem value="opportunities">Opportunities</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <label className="block mt-4">
            Search {flow.label}
            <Input
              value={query}
              maxLength={300}
              onChange={(event) => {
                setQuery(event.target.value);
                setResult(null);
              }}
              placeholder="Enter a search"
            />
          </label>
          <ul className="space-y-3 mt-3">
            {accounts.map((account) => (
              <li key={account.id} className="rounded-xl border p-3">
                <p>{account.account_label ?? flow.label}</p>
                <p className="text-sm text-muted-foreground">
                  {canReadConnection(account, id)
                    ? "Account authorized. Search to verify access."
                    : "Reconnect to renew access or grant this service’s read permission."}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button
                    variant="outline"
                    disabled={!configured || busy || loading || error}
                    onClick={() => {
                      void start(account.id);
                    }}
                  >
                    Reconnect or add read access
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      busy || loading || error || !canReadConnection(account, id) || !query.trim()
                    }
                    onClick={() => {
                      void search(account.id);
                    }}
                  >
                    Search this account
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || loading || error}
                    onClick={() => setDisconnect(account)}
                  >
                    Disconnect
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {result && (
        <div className="mt-4" role="status">
          <p>
            {result.results.length
              ? "Results from the connected service"
              : "No matching results returned."}{" "}
            Up to 10 results.
          </p>
          <ul className="space-y-3 mt-2">
            {result.results.map((item, index) => (
              <li key={`${item.id}:${index}`}>
                {safeConnectionLink(item.url) ? (
                  <a className="underline" href={item.url!} target="_blank" rel="noreferrer">
                    {item.title || "Open result"}
                  </a>
                ) : (
                  <p>{item.title}</p>
                )}
                {item.snippet && <p className="text-sm whitespace-pre-wrap">{item.snippet}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmActionDialog
        open={disconnect !== null}
        onOpenChange={(open) => !busy && !open && setDisconnect(null)}
        title="Disconnect account?"
        description="This removes this account’s access from Kova and cancels its sync jobs. Other Microsoft services using the same account are affected. Remote provider revocation may remain pending."
        confirmLabel="Disconnect"
        onConfirm={remove}
        disabled={busy}
      />
    </section>
  );
}
