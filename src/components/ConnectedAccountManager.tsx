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
import { ConnectorWriteControls } from "@/components/ConnectorWriteControls";
import { EXTRA_WRITE_ACTIONS, isExtraWriteConnector } from "@/lib/connector-write-actions";
import { useUser } from "@/components/auth/ClerkSafe";
import { searchConnectedAccount, refreshConnectedAccess } from "@/lib/connected-accounts.functions";
import {
  CONNECTION_FLOWS,
  canReadConnection,
  hasConnectionScopes,
  connectionAccounts,
  connectionAuthorizationUrl,
  safeConnectionLink,
  type ConnectedAccount,
} from "@/integrations/connection-flows.mjs";
import type { ConnectionReadResult } from "@/integrations/connection-read.server.mjs";
import { toast } from "sonner";
import type { AccountStatus } from "@/hooks/use-connected-accounts";

const KEY_CONNECTION_FIELDS: Record<
  string,
  { field: string; label: string; secret?: boolean; optional?: boolean }[]
> = {
  vercel: [{ field: "teamId", label: "Vercel team ID" }],
  mixpanel: [
    { field: "username", label: "Service account username" },
    { field: "projectId", label: "Project ID" },
    { field: "workspaceId", label: "Workspace ID for Data Views", optional: true },
  ],
  etoro: [{ field: "userKey", label: "eToro user key", secret: true }],
  "interactive-brokers": [{ field: "queryId", label: "Activity Flex query ID" }],
  "sp-global": [{ field: "username", label: "Capital IQ API username" }],
  webull: [
    { field: "appKey", label: "Webull app key" },
    { field: "accessToken", label: "Webull access token", secret: true, optional: true },
  ],
  wix: [{ field: "clientId", label: "Wix Headless client ID" }],
  "notion-private": [{ field: "pageId", label: "Notion page ID" }],
  "custom-mcp": [{ field: "serverId", label: "Approved server ID" }],
};

const KEY_CREDENTIAL_LABELS: Record<string, string> = {
  vercel: "Vercel access token",
  mixpanel: "Mixpanel service account secret",
  etoro: "eToro public API key",
  "interactive-brokers": "Flex Web Service token",
  "sp-global": "Capital IQ API password",
  webull: "Webull app secret",
  wix: "Wix Headless client secret",
  "notion-private": "Notion internal integration token",
  "custom-mcp": "MCP bearer token",
};

export function ConnectedAccountManager({
  id,
  initiallySearchTeamsMessages = false,
  data,
  loading,
  error,
  reload,
}: {
  id: string;
  initiallySearchTeamsMessages?: boolean;
  data: AccountStatus | null;
  loading: boolean;
  error: boolean;
  reload: () => Promise<boolean>;
}) {
  const owner = useUser().user?.id;
  const [teamsMessages, setTeamsMessages] = useState(initiallySearchTeamsMessages);
  const [hubspotContacts, setHubspotContacts] = useState(false);
  const operationId =
    id === "hubspot" && hubspotContacts
      ? "hubspot-contacts"
      : id === "ms-teams" && teamsMessages
        ? "ms-teams-messages"
        : id;
  const flow = CONNECTION_FLOWS[operationId];
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [recordType, setRecordType] = useState<"accounts" | "contacts" | "opportunities">(
    "accounts",
  );
  const [result, setResult] = useState<ConnectionReadResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState<ConnectedAccount | null>(null);
  const active = useRef(true);
  const keyInput = useRef<HTMLInputElement>(null);
  const readAccount = useServerFn(searchConnectedAccount);
  const refreshAccess = useServerFn(refreshConnectedAccess);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (!flow) return null;
  const accounts = connectionAccounts(data?.accounts ?? [], operationId);
  const writeConnector = isExtraWriteConnector(id) ? id : null;
  const extraWrite = writeConnector ? EXTRA_WRITE_ACTIONS[writeConnector] : null;
  const writeScope = extraWrite
    ? extraWrite.scope
    : id === "onedrive"
      ? "Files.ReadWrite"
      : id === "outlook"
        ? "Mail.ReadWrite"
        : id === "outlook-calendar"
          ? "Calendars.ReadWrite"
          : id === "linear"
            ? "issues:create"
            : null;
  const usesApiKey = flow.authentication === "api-key";
  const linkedPage = id === "notion-private";
  const readQuery = linkedPage ? "open" : query.trim();
  const configured =
    data?.configuredProviders.some((provider) => provider.id === flow.provider) === true;
  const start = async (existingAccountId?: string, write: boolean | "Mail.Send" = false) => {
    if (busy || loading || error || !configured || !owner) return;
    const permission = write === "Mail.Send" ? write : write ? writeScope : null;
    setBusy(true);
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/integrations/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kova-Owner": owner },
        body: JSON.stringify({
          provider: flow.provider,
          optionalScopes: permission
            ? [...CONNECTION_FLOWS[extraWrite?.readConnection ?? operationId].scopes, permission]
            : flow.scopes,
          returnPath: `/apps?connection_view=${id === "hubspot" ? id : operationId}`,
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
  const linkApiKey = async (form: HTMLFormElement) => {
    const field = keyInput.current;
    const apiKey = field?.value.trim();
    if (busy || loading || error || !configured || !field || !apiKey || !owner) return;
    const credentials = Object.fromEntries(
      Array.from(
        form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-credential-field]"),
      ).map((input) => [input.dataset.credentialField!, input.value]),
    );
    field.value = "";
    for (const input of form.querySelectorAll<HTMLInputElement>(
      '[data-credential-field][type="password"]',
    ))
      input.value = "";
    setBusy(true);
    setResult(null);
    try {
      const response = await fetchWithTimeoutAuthenticated(
        "/api/integrations/accounts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Kova-Owner": owner },
          body: JSON.stringify({ ...credentials, provider: flow.provider, apiKey }),
        },
        25_000,
      );
      if (!response.ok) {
        if (active.current)
          toast.error(
            response.status === 403
              ? `Could not authorize ${flow.label} read access. Check the key’s permissions and Lockdown Mode.`
              : response.status === 503 && id === "interactive-brokers"
                ? "IBKR is still preparing the report or is temporarily unavailable. Try again shortly."
                : `Could not connect ${flow.label}. Check the key and try again.`,
          );
        return;
      }
      if (active.current) {
        await reload();
        if (active.current) toast.success(`${flow.label} read access verified.`);
      }
    } catch {
      if (active.current) toast.error(`Could not connect ${flow.label}. Try again.`);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const search = async (accountId: string) => {
    if (busy || !owner || !readQuery) return;
    setBusy(true);
    setResult(null);
    setReadError(null);
    try {
      const next = await readAccount({
        data: {
          connectionId: operationId,
          accountId,
          query: readQuery,
          ...(id === "salesforce" ? { recordType } : {}),
        },
        headers: { "X-Kova-Owner": owner },
      });
      if (active.current) {
        if ("error" in next) setReadError(next.error);
        else setResult(next);
      }
    } catch {
      if (active.current) setReadError("The connected service could not be read. Try again later.");
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
            : usesApiKey
              ? `Key removed from Kova. Revoke it in ${flow.label} to disable the key.`
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
      <h3>{linkedPage ? "Link a Notion page" : "Accounts"}</h3>
      {id === "ms-teams" && (
        <div className="my-3 space-y-4">
          <label htmlFor="teams-search-type">Teams access</label>
          <Select
            value={teamsMessages ? "messages" : "teams"}
            onValueChange={(value) => {
              setTeamsMessages(value === "messages");
              setQuery("");
              setResult(null);
            }}
            disabled={busy}
          >
            <SelectTrigger id="teams-search-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="teams">Joined teams</SelectItem>
              <SelectItem value="messages">Chat messages</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {id === "hubspot" && (
        <div className="my-3 space-y-4">
          <label htmlFor="hubspot-record-type">HubSpot records</label>
          <Select
            value={hubspotContacts ? "contacts" : "companies"}
            onValueChange={(value) => {
              setHubspotContacts(value === "contacts");
              setQuery("");
              setResult(null);
            }}
            disabled={busy}
          >
            <SelectTrigger id="hubspot-record-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="companies">Companies</SelectItem>
              <SelectItem value="contacts">Contacts</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <p>
        {linkedPage
          ? "Create a read-only internal integration in Notion, share the page with it, then enter the page ID and token."
          : flow.description}
      </p>
      {id === "hyperframes-heygen" && (
        <p className="text-sm text-muted-foreground">
          Use a restricted HeyGen key with HyperFrames read access.
        </p>
      )}
      {id === "interactive-brokers" && (
        <p className="text-sm text-muted-foreground">
          Use an XML Activity Flex report with the Open Positions section. Include Symbol, Currency
          and Quantity and select only the accounts you want Kova to read.
        </p>
      )}
      <p className="text-sm text-muted-foreground">Kova provides read access for this operation.</p>
      {loading && <p role="status">Checking accounts…</p>}
      {error && (
        <p role="status">Account status is unavailable. Refresh before taking an action.</p>
      )}
      {!loading && !error && !configured && (
        <p role="status">Connection setup is incomplete in this deployment.</p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {usesApiKey ? (
          configured && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void linkApiKey(event.currentTarget);
              }}
            >
              {KEY_CONNECTION_FIELDS[id]?.map(({ field, label, secret, optional }) => (
                <label key={field} className="kova-connection-field">
                  {label}
                  <Input
                    data-credential-field={field}
                    type={secret ? "password" : "text"}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required={!optional}
                    maxLength={secret ? 512 : 200}
                    disabled={busy || loading || error}
                  />
                </label>
              ))}
              {id === "mixpanel" && (
                <label className="kova-connection-field flex flex-col">
                  Data region
                  <select
                    className="h-9 rounded-lg border border-input bg-background px-2"
                    data-credential-field="region"
                    required
                    defaultValue=""
                    disabled={busy || loading || error}
                  >
                    <option value="" disabled>
                      Choose a region
                    </option>
                    <option value="us">United States</option>
                    <option value="eu">European Union</option>
                    <option value="in">India</option>
                  </select>
                </label>
              )}
              {id === "webull" && (
                <label className="kova-connection-field flex flex-col">
                  OpenAPI environment
                  <select
                    className="h-9 rounded-lg border border-input bg-background px-2"
                    data-credential-field="environment"
                    required
                    defaultValue=""
                    disabled={busy || loading || error}
                  >
                    <option value="" disabled>
                      Choose an environment
                    </option>
                    <option value="production">Production</option>
                    <option value="sandbox">Sandbox</option>
                  </select>
                </label>
              )}
              <label className="kova-connection-field">
                {KEY_CREDENTIAL_LABELS[id] ?? `${flow.label} API key`}
                <Input
                  ref={keyInput}
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={512}
                  disabled={busy || loading || error}
                />
              </label>
              <Button type="submit" disabled={busy || loading || error}>
                {busy ? "Working…" : accounts.length ? "Save credentials" : `Connect ${flow.label}`}
              </Button>
            </form>
          )
        ) : (
          <Button
            onClick={() => {
              void start();
            }}
            disabled={!configured || loading || error || busy}
          >
            {busy ? "Working…" : accounts.length ? "Connect or update permissions" : "Connect"}
          </Button>
        )}
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
            <div className="mt-4 space-y-4">
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
          {!linkedPage && (
            <label className="kova-connection-field block mt-4">
              {id === "figma"
                ? "Figma file"
                : id === "google-bigquery"
                  ? "Google Cloud project ID"
                  : `Search ${flow.label}`}
              <Input
                value={query}
                maxLength={id === "canva" ? 255 : 300}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setResult(null);
                }}
                placeholder={
                  id === "notion"
                    ? "Enter a title or page ID"
                    : id === "figma"
                      ? "Enter a design link or file key"
                      : id === "google-bigquery"
                        ? "Enter a Google Cloud project ID"
                        : id === "calendly"
                          ? "Enter a meeting title or upcoming"
                          : id === "granola"
                            ? "Enter a note title or recent"
                            : "Enter a search"
                }
              />
            </label>
          )}
          <ul className="space-y-3 mt-3">
            {accounts.map((account) => (
              <li key={account.id} className="rounded-xl border p-3">
                <p>{account.account_label ?? flow.label}</p>
                <p className="text-sm text-muted-foreground">
                  {canReadConnection(account, operationId)
                    ? "Account authorized. Search to verify access."
                    : "Reconnect to renew access or grant this service’s read permission."}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(id === "onedrive" ||
                    id === "outlook" ||
                    id === "outlook-calendar" ||
                    id === "linear") &&
                    writeScope &&
                    configured &&
                    canReadConnection(account, operationId) && (
                      <ConnectorWriteControls
                        connector={id}
                        target={account.id}
                        label={account.account_label ?? flow.label}
                        providerCanWrite={hasConnectionScopes(account.granted_scopes, [writeScope])}
                        authorizeWrite={() => void start(account.id, true)}
                        canSendOutlook={
                          id === "outlook" &&
                          hasConnectionScopes(account.granted_scopes, ["Mail.Send"])
                        }
                        authorizeOutlookSend={
                          id === "outlook" ? () => void start(account.id, "Mail.Send") : undefined
                        }
                      />
                    )}
                  {writeConnector &&
                    extraWrite &&
                    configured &&
                    (!usesApiKey ||
                      !writeScope ||
                      hasConnectionScopes(account.granted_scopes, [writeScope])) &&
                    (canReadConnection(account, operationId) ||
                      canReadConnection(account, extraWrite.readConnection)) && (
                      <ConnectorWriteControls
                        connector={writeConnector}
                        target={account.id}
                        label={account.account_label ?? flow.label}
                        providerCanWrite={
                          canReadConnection(account, extraWrite.readConnection) &&
                          (!writeScope || hasConnectionScopes(account.granted_scopes, [writeScope]))
                        }
                        authorizeWrite={
                          writeScope && !usesApiKey ? () => void start(account.id, true) : undefined
                        }
                      />
                    )}
                  {!usesApiKey && (
                    <Button
                      variant="outline"
                      disabled={!configured || busy || loading || error}
                      onClick={() => {
                        void start(account.id);
                      }}
                    >
                      Reconnect or add read access
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      loading ||
                      error ||
                      !canReadConnection(account, operationId) ||
                      !readQuery
                    }
                    onClick={() => {
                      void search(account.id);
                    }}
                  >
                    {linkedPage
                      ? "Read linked page"
                      : id === "figma"
                        ? "Read this file"
                        : id === "google-bigquery"
                          ? "List datasets"
                          : "Search this account"}
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
      {readError && (
        <p className="mt-4 text-sm" role="alert">
          {readError}
        </p>
      )}
      {result && (
        <div className="mt-4" role="status">
          <p>
            Read access verified for this request.
            {result.results.length === 0 && " No matching results returned."}
            {result.limited ? " Results may be incomplete." : ""}
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
