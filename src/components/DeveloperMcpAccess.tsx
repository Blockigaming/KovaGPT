import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useUser } from "@/components/auth/ClerkSafe";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestMcpOwner, verifiedMcpRedirect } from "@/lib/pricing/mcp-oauth-client";
import {
  MCP_OAUTH_SCOPE_LABELS,
  mcpCanonical,
  mcpReviewPayload,
} from "@/lib/pricing/mcp-oauth-policy.mjs";
import {
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  isPrincipalBrowserStorageClearedEvent,
} from "@/lib/principal-browser-storage.mjs";
type Project = {
  id: string;
  name: string;
  account_id: string;
  currency: string;
  request_limit: number;
  daily_limit: number;
  monthly_limit: number;
  concurrent_limit: number;
};
type Details = {
  id: string;
  requestHash: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  decision: string | null;
  projects: Project[];
  expiresAt: string;
  refreshAllowed: boolean;
};
function ErrorMessage({ value }: { value: string }) {
  return value ? (
    <p role="alert" className="text-sm text-destructive">
      {value}
    </p>
  ) : null;
}
function OwnerBoundary({ ownerId, requestId }: { ownerId: string; requestId?: string }) {
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    const reset = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, ownerId)) setCleared(true);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [ownerId]);
  return cleared ? (
    <p role="status">Private device state was cleared. Reload before managing connections.</p>
  ) : requestId ? (
    <DeveloperMcpConsentPanel
      key={`${ownerId}:${requestId}`}
      ownerId={ownerId}
      requestId={requestId}
    />
  ) : (
    <DeveloperMcpConnectionsPanel ownerId={ownerId} />
  );
}
export function DeveloperMcpAccessPage({ requestId }: { requestId?: string }) {
  const { isLoaded, user } = useUser(),
    [authOpen, setAuthOpen] = useState(false);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Link to="/developers/console" className="text-sm underline">
        Developer console
      </Link>
      <h1 className="text-2xl font-semibold">
        {requestId ? "Connect an MCP client" : "Developer MCP connections"}
      </h1>
      {!isLoaded ? (
        <p>Loading account…</p>
      ) : !user ? (
        <>
          <p>Sign in to review the client, developer project, permissions and spending limits.</p>
          <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
          <AuthDialog open={authOpen} mode="sign-in" onOpenChange={setAuthOpen} />
        </>
      ) : (
        <OwnerBoundary key={user.id} ownerId={user.id} requestId={requestId} />
      )}
    </main>
  );
}
export function DeveloperMcpConsentPanel({
  ownerId,
  requestId,
}: {
  ownerId: string;
  requestId: string;
}) {
  const [details, setDetails] = useState<Details | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [projectId, setProjectId] = useState(""),
    [scopes, setScopes] = useState<string[]>([]),
    [reviewed, setReviewed] = useState(false);
  const [limits, setLimits] = useState({ request: "", daily: "", monthly: "", concurrent: "" }),
    lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setDetails(null);
    setError("");
    setReviewed(false);
    setBusy(false);
    setLimits({ request: "", daily: "", monthly: "", concurrent: "" });
    setProjectId("");
    setScopes([]);
    void requestMcpOwner(ownerId, `?request_id=${requestId}`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          const row = value as unknown as Details;
          setDetails(row);
          setScopes(row.scopes);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [ownerId, requestId]);
  const project = details?.projects.find((item) => item.id === projectId);
  const numeric = {
    request: Number(limits.request),
    daily: Number(limits.daily),
    monthly: Number(limits.monthly),
    concurrent: Number(limits.concurrent),
  };
  let valid = false;
  try {
    if (details && project) {
      mcpReviewPayload(details, projectId, scopes, numeric);
      valid =
        numeric.request <= project.request_limit &&
        numeric.daily <= project.daily_limit &&
        numeric.monthly <= project.monthly_limit &&
        numeric.concurrent <= project.concurrent_limit;
    }
  } catch {
    /* Form remains unapprovable until all owner choices are valid. */
  }
  const change = () => setReviewed(false);
  async function decide(approve: boolean) {
    if (
      !details ||
      busy ||
      !lifetime.current ||
      lifetime.current.signal.aborted ||
      (approve && (!valid || !reviewed))
    )
      return;
    const signal = lifetime.current.signal;
    setBusy(true);
    setError("");
    try {
      const review = approve ? mcpReviewPayload(details, projectId, scopes, numeric) : null;
      const reviewHash = review
        ? Array.from(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mcpCanonical(review))),
            ),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("")
        : null;
      if (signal.aborted) return;
      const result = await requestMcpOwner(ownerId, "", signal, {
        operation: "decide",
        requestId: details.id,
        requestHash: details.requestHash,
        approve,
        ...(review ? { projectId, scopes, limits: numeric, reviewHash } : {}),
      });
      if (signal.aborted) return;
      const redirect =
        typeof result.redirectUri === "string"
          ? verifiedMcpRedirect(result.redirectUri, details.redirectUri, details.resource)
          : null;
      if (!redirect)
        throw new Error(
          "The returned client destination could not be verified. Restart the connection from your client.",
        );
      window.location.assign(redirect);
    } catch (cause) {
      if (!signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "The decision could not be verified. Restart the connection from your client.",
        );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  if (!details)
    return (
      <>
        <p>Loading the authorization request…</p>
        <ErrorMessage value={error} />
      </>
    );
  if (details.decision)
    return (
      <p role="status">
        This request has already been {details.decision}. Restart the connection from your client if
        the redirect was interrupted. You can revoke unused access in{" "}
        <Link to="/developers/connections" className="underline">
          MCP connections
        </Link>
        .
      </p>
    );
  return (
    <section className="space-y-5 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Allow {details.clientName} to use developer credit?</h2>
      <p>
        This is an external client. Review its exact destination and access before continuing. It
        receives no KovaGPT sign-in token or provider key.
      </p>
      <dl className="space-y-2 break-all text-sm">
        <dt className="font-semibold">Client ID</dt>
        <dd>{details.clientId}</dd>
        <dt className="font-semibold">Redirect destination</dt>
        <dd>{details.redirectUri}</dd>
        <dt className="font-semibold">Resource</dt>
        <dd>{details.resource}</dd>
      </dl>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="font-semibold">Requested permissions</legend>
        {details.scopes.map((scope) => (
          <label key={scope} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={(event) => {
                change();
                setScopes((previous) =>
                  event.target.checked
                    ? [...previous, scope]
                    : previous.filter((item) => item !== scope),
                );
              }}
            />
            {MCP_OAUTH_SCOPE_LABELS[scope] ?? scope}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-2">
        Developer project
        <select
          aria-label="Developer project"
          className="block w-full rounded border bg-background p-2"
          value={projectId}
          disabled={busy}
          onChange={(event) => {
            setProjectId(event.target.value);
            change();
          }}
        >
          <option value="">Choose a project</option>
          {details.projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.currency}
            </option>
          ))}
        </select>
      </label>
      {!details.projects.length && (
        <p>
          Configure your developer account, project and spending limits in the{" "}
          <Link to="/developers/console" className="underline">
            developer console
          </Link>{" "}
          before starting a new connection.
        </p>
      )}
      {project && (
        <>
          <p className="text-sm">
            Enter this client's spending limits in {project.currency} currency units. Existing
            account and project limits still apply. No generation starts during consent.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["request", "daily", "monthly", "concurrent"] as const).map((key) => (
              <label key={key} className="space-y-1">
                <span>
                  {key === "request"
                    ? "Maximum per request"
                    : key === "daily"
                      ? "Daily limit"
                      : key === "monthly"
                        ? "Monthly limit"
                        : "Concurrent requests"}
                </span>
                <Input
                  aria-label={key}
                  type="number"
                  min={key === "concurrent" ? 1 : 0}
                  step={key === "concurrent" ? 1 : "any"}
                  value={limits[key]}
                  disabled={busy}
                  onChange={(event) => {
                    change();
                    setLimits((previous) => ({ ...previous, [key]: event.target.value }));
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  At most{" "}
                  {key === "request"
                    ? project.request_limit
                    : key === "daily"
                      ? project.daily_limit
                      : key === "monthly"
                        ? project.monthly_limit
                        : project.concurrent_limit}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      <p className="text-sm">
        Access tokens last at most 15 minutes.{" "}
        {details.refreshAllowed
          ? "This connection can renew them for up to 30 days while its client registration remains valid."
          : "This client does not receive a refresh token; another connection requires your consent."}{" "}
        You can revoke it at any time.
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy || !valid}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        I reviewed this client, destination, developer project, permissions and spending limits.
      </label>
      <ErrorMessage value={error} />
      <div className="flex gap-3">
        <Button disabled={busy || !valid || !reviewed} onClick={() => void decide(true)}>
          {busy ? "Submitting…" : "Approve connection"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>
          Deny
        </Button>
      </div>
    </section>
  );
}
type Grant = {
  id: string;
  client_name: string;
  client_id: string;
  project_id: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  request_limit: number;
  daily_limit: number;
  monthly_limit: number;
  currency: string;
};
type Client = {
  id: string;
  metadata: { client_name: string; redirect_uris: string[] };
  active: boolean;
  expires_at: string;
};
export function DeveloperMcpConnectionsPanel({ ownerId }: { ownerId: string }) {
  const [rows, setRows] = useState<Grant[]>([]),
    [clients, setClients] = useState<Client[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [redirect, setRedirect] = useState(""),
    [native, setNative] = useState(false),
    lifetime = useRef<AbortController | null>(null),
    loading = useRef(false);
  const load = useCallback(
    async (after?: string, signal = lifetime.current?.signal) => {
      if (!signal || signal.aborted || loading.current) return;
      loading.current = true;
      setBusy(true);
      try {
        const result = await requestMcpOwner(ownerId, after ? `?after=${after}` : "", signal);
        if (signal.aborted) return;
        setRows((previous) =>
          after
            ? [
                ...new Map(
                  [...previous, ...(result.grants as Grant[])].map((row) => [row.id, row]),
                ).values(),
              ]
            : (result.grants as Grant[]),
        );
        setClients(result.clients as Client[]);
        setNext(result.nextCursor as string | null);
      } finally {
        loading.current = false;
        if (!signal.aborted) setBusy(false);
      }
    },
    [ownerId],
  );
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void load(undefined, controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [load]);
  async function mutate(body: unknown) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setBusy(true);
    setError("");
    try {
      await requestMcpOwner(ownerId, "", signal, body);
      await load(undefined, signal);
    } catch (cause) {
      if (!signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Connection changes could not be verified.",
        );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <p>
        Revoke access here even when new MCP authorization is disabled. These connections use
        developer projects and prepaid developer credit.
      </p>
      <ErrorMessage value={error} />
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Granted connections</h2>
        {!rows.length && <p>No connections on this page.</p>}
        {rows.map((grant) => (
          <article key={grant.id} className="space-y-2 rounded-lg border p-4">
            <h3 className="font-semibold">{grant.client_name}</h3>
            <p className="break-all text-xs">
              Client {grant.client_id} · developer project {grant.project_id}
            </p>
            <p>{grant.scopes.map((scope) => MCP_OAUTH_SCOPE_LABELS[scope] ?? scope).join("; ")}</p>
            <p className="text-sm">
              {grant.revoked_at
                ? "Revoked"
                : `Expires ${new Date(grant.expires_at).toLocaleString()}`}{" "}
              · Limits in {grant.currency}: {grant.request_limit} / request, {grant.daily_limit} /
              day, {grant.monthly_limit} / month
            </p>
            <Button
              variant="outline"
              disabled={busy || Boolean(grant.revoked_at)}
              onClick={() => void mutate({ operation: "revoke", grantId: grant.id })}
            >
              Revoke connection
            </Button>
          </article>
        ))}
        {next && (
          <Button
            disabled={busy}
            onClick={() => void load(next).catch((cause) => setError(cause.message))}
          >
            Load more
          </Button>
        )}
      </section>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-xl font-semibold">Register your MCP client</h2>
        <p>
          Prepare a public client ID for your application. Registration grants no account access;
          each owner must approve the exact requested permissions.
        </p>
        <label className="block">
          Client name
          <Input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block">
          Exact redirect URL
          <Input
            value={redirect}
            maxLength={2048}
            onChange={(event) => setRedirect(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={native}
            onChange={(event) => setNative(event.target.checked)}
            disabled={busy}
          />
          Native client using an exact HTTP 127.0.0.1 or [::1] loopback port
        </label>
        <Button
          disabled={busy || !name.trim() || !redirect}
          onClick={() =>
            void mutate({
              operation: "register",
              metadata: {
                client_name: name,
                redirect_uris: [redirect],
                application_type: native ? "native" : "web",
                token_endpoint_auth_method: "none",
              },
            })
          }
        >
          Register client
        </Button>
        {clients.map((client) => (
          <article key={client.id} className="rounded border p-3">
            <h3>{client.metadata.client_name}</h3>
            <code className="break-all text-xs">{client.id}</code>
            <p className="break-all text-sm">{client.metadata.redirect_uris.join(", ")}</p>
            <p className="text-xs">
              {client.active
                ? `Registration expires ${new Date(client.expires_at).toLocaleString()}`
                : "Registration retired"}
            </p>
            <Button
              variant="outline"
              disabled={busy || !client.active}
              onClick={() => void mutate({ operation: "retire_client", clientId: client.id })}
            >
              Retire client and revoke its connections
            </Button>
          </article>
        ))}
      </section>
    </div>
  );
}
