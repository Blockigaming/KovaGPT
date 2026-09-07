import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { PublicPageView } from "@/components/public/PublicSite";
import { Button } from "@/components/ui/button";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { DeveloperFundingPanel } from "@/components/DeveloperFundingPanel";
import { DeveloperFilesPanel } from "@/components/DeveloperFilesPanel";
type Row = Record<string, string | number | boolean | null | string[]>;
type ConsoleData = {
  enabled: boolean;
  accounts: Row[];
  projects: Row[];
  keys: Row[];
  limits: Row[];
  usage: Row[];
  balances: Row[];
  limitsPage: number;
  limitsHasMore: boolean;
};
export const Route = createFileRoute("/developers/console")({
  component: DeveloperConsole,
  head: () => ({
    meta: [
      { title: "Developer console | KovaGPT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
function DeveloperConsole() {
  const { isSignedIn, user } = useUser();
  if (isSignedIn && user?.id) return <OwnedDeveloperConsole key={user.id} userId={user.id} />;
  return (
    <PublicPageView
      eyebrow="Developers"
      title="Developer console"
      summary="Manage your developer workspace."
    >
      <SignInButton mode="modal">
        <Button>Sign in to continue</Button>
      </SignInButton>
    </PublicPageView>
  );
}
function OwnedDeveloperConsole({ userId }: { userId: string }) {
  const isSignedIn = true;
  const ownerRef = useRef<string | null>(userId);
  const [limitsPage, setLimitsPage] = useState(0);
  const limitsPageRef = useRef(limitsPage);
  limitsPageRef.current = limitsPage;
  const loadVersion = useRef(0);
  const [data, setData] = useState<ConsoleData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState("");
  const [account, setAccount] = useState(""),
    [project, setProject] = useState(""),
    [name, setName] = useState(""),
    [currency, setCurrency] = useState("");
  const [requestLimit, setRequestLimit] = useState(""),
    [daily, setDaily] = useState(""),
    [monthly, setMonthly] = useState(""),
    [concurrent, setConcurrent] = useState("1"),
    [scopes, setScopes] = useState<string[]>(["chat"]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const owner = ownerRef.current;
      if (owner !== userId) return;
      const version = ++loadVersion.current;
      const response = await fetchWithTimeoutAuthenticated(
        `/api/developer/console?limitsPage=${limitsPageRef.current}`,
        { signal, headers: { "X-Kova-Expected-User": userId } },
      );
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error?.message ?? "Could not load your developer workspace.");
      if (!signal?.aborted && owner === ownerRef.current && version === loadVersion.current)
        setData(value);
    },
    [userId],
  );
  useEffect(() => {
    ownerRef.current = userId;
    const controller = new AbortController();
    load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => {
      ownerRef.current = null;
      controller.abort();
    };
  }, [userId, load, limitsPage]);
  const mutate = async (body: Record<string, unknown>) => {
    const owner = ownerRef.current;
    setBusy(true);
    setError("");
    setSecret("");
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/developer/console", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kova-Expected-User": userId },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error?.message ?? "The change could not be confirmed.");
      if (owner !== ownerRef.current) return;
      if (value.secret) setSecret(value.secret);
      await load();
    } catch (cause) {
      if (owner === ownerRef.current)
        setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      if (owner === ownerRef.current) setBusy(false);
    }
  };
  const limits = () => ({
    request: Number(requestLimit),
    daily: Number(daily),
    monthly: Number(monthly),
    concurrent: Number(concurrent),
  });
  const selected = data?.balances.find((row) => row.id === account);
  const fieldClass =
    "mt-1 block min-h-11 w-full rounded-md border border-border bg-background px-3";
  return (
    <PublicPageView
      eyebrow="Developers"
      title="Developer console"
      summary="Manage scoped keys, spending limits, and prepaid API usage."
    >
      <Link to="/developers/connections" className="text-sm underline">
        Manage MCP client connections
      </Link>
      {!isSignedIn ? (
        <SignInButton mode="modal">
          <Button>Sign in to continue</Button>
        </SignInButton>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {data && !data.enabled && (
            <p role="status">
              Paid API execution is not enabled. You can prepare your workspace and limits.
            </p>
          )}
          <form
            className="space-y-4 rounded-xl border p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate({ operation: "create_account", name, currency });
            }}
          >
            <h2 className="text-lg font-semibold">Create a credit account</h2>
            <label className="block">
              Account name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block">
              Billing currency (three-letter code)
              <input
                required
                pattern="[A-Z]{3}"
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                className={fieldClass}
              />
            </label>
            <Button disabled={busy} type="submit">
              Create empty account
            </Button>
          </form>
          <section className="space-y-4 rounded-xl border p-5">
            <h2 className="text-lg font-semibold">Keys and spending limits</h2>
            <label className="block">
              Account
              <select
                className={fieldClass}
                value={account}
                onChange={(event) => {
                  setAccount(event.target.value);
                  setProject("");
                  setSecret("");
                }}
              >
                <option value="">Select an account</option>
                {data?.accounts.map((row) => (
                  <option key={String(row.account_id)} value={String(row.account_id)}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <p>
                Available: {selected.available_amount} {selected.currency} minor units. Reserved:{" "}
                {selected.reserved_amount}.{" "}
                {selected.suspended_at ? "This account is suspended." : ""}
              </p>
            )}
            <label className="block">
              Project
              <select
                className={fieldClass}
                value={project}
                onChange={(event) => setProject(event.target.value)}
              >
                <option value="">Select a project</option>
                {data?.projects
                  .filter((row) => row.account_id === account)
                  .map((row) => (
                    <option key={String(row.id)} value={String(row.id)}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              Enter spending limits in the account currency’s minor units. Organization, project,
              and key limits all apply.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Per request", requestLimit, setRequestLimit],
                ["Per UTC day", daily, setDaily],
                ["Per UTC month", monthly, setMonthly],
                ["Concurrent requests", concurrent, setConcurrent],
              ].map(([label, value, setter]) => (
                <label key={String(label)} className="block">
                  {String(label)}
                  <input
                    className={fieldClass}
                    type="number"
                    required
                    min="0.00000001"
                    step="any"
                    value={String(value)}
                    onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !account}
                onClick={() =>
                  void mutate({
                    operation: "set_limits",
                    accountId: account,
                    scope: "organization",
                    limits: limits(),
                  })
                }
              >
                Save organization limits
              </Button>
              <Button
                disabled={busy || !project}
                onClick={() =>
                  void mutate({
                    operation: "set_limits",
                    accountId: account,
                    scope: "project",
                    scopeId: project,
                    limits: limits(),
                  })
                }
              >
                Save project limits
              </Button>
            </div>
            <fieldset>
              <legend>New key capabilities</legend>
              {["chat", "streaming", "image_generation", "embeddings", "files"].map((scope) => (
                <label key={scope} className="mr-5 inline-flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(event) =>
                      setScopes(
                        event.target.checked
                          ? [...scopes, scope]
                          : scopes.filter((item) => item !== scope),
                      )
                    }
                  />
                  {scope}
                </label>
              ))}
            </fieldset>
            <label className="block">
              Key name
              <input
                maxLength={80}
                className={fieldClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button
              disabled={busy || !project || !name.trim()}
              onClick={() =>
                void mutate({
                  operation: "issue_key",
                  accountId: account,
                  projectId: project,
                  name,
                  scopes,
                  limits: limits(),
                })
              }
            >
              Create key with these limits
            </Button>
            {secret && (
              <div role="status" className="space-y-2 rounded-md border p-3">
                <p>
                  Save this key in your server’s secret manager. It is shown once and expires in 89
                  days.
                </p>
                <textarea readOnly aria-label="New API key" value={secret} className={fieldClass} />
                <Button onClick={() => setSecret("")}>Hide key</Button>
              </div>
            )}
            <ul className="space-y-2">
              {data?.keys
                .filter((row) => row.account_id === account)
                .map((row) => (
                  <li
                    key={String(row.id)}
                    className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"
                  >
                    <span>
                      {row.name} · …{row.secret_suffix} ·{" "}
                      {row.revoked_at
                        ? "revoked"
                        : `expires ${String(row.expires_at).slice(0, 10)}`}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        disabled={busy || Boolean(row.revoked_at)}
                        variant="outline"
                        onClick={() =>
                          void mutate({
                            operation: "revoke_key",
                            accountId: account,
                            keyId: row.id,
                          })
                        }
                      >
                        Revoke
                      </Button>
                      <Button
                        disabled={busy || Boolean(row.revoked_at) || !project}
                        variant="outline"
                        onClick={() =>
                          void mutate({
                            operation: "issue_key",
                            accountId: account,
                            projectId: project,
                            name: row.name,
                            scopes,
                            limits: limits(),
                            rotateKeyId: row.id,
                          })
                        }
                      >
                        Rotate
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
          {project && (
            <DeveloperFilesPanel key={`${userId}:${project}`} userId={userId} projectId={project} />
          )}
          {account && (
            <DeveloperFundingPanel
              key={`${userId}:${account}`}
              userId={userId}
              accountId={account}
              onBalanceChanged={load}
            />
          )}
          <section className="space-y-3 rounded-xl border p-5">
            <h2 className="text-lg font-semibold">Stored spending limits</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Scope</th>
                    <th>Per request</th>
                    <th>Per day</th>
                    <th>Per month</th>
                    <th>Concurrent</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.limits.map((row) => (
                    <tr key={`${row.account_id}:${row.scope_type}:${row.scope_id}`}>
                      <td>{data.accounts.find((a) => a.account_id === row.account_id)?.name}</td>
                      <td>
                        {row.scope_type} · {String(row.scope_id).slice(0, 8)}
                      </td>
                      <td>{row.request_limit}</td>
                      <td>{row.daily_limit}</td>
                      <td>{row.monthly_limit}</td>
                      <td>{row.concurrent_limit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={limitsPage === 0 || busy}
                onClick={() => setLimitsPage((page) => Math.max(0, page - 1))}
              >
                Previous limits
              </Button>
              <span>Page {limitsPage + 1}</span>
              <Button
                variant="outline"
                disabled={!data?.limitsHasMore || busy}
                onClick={() => setLimitsPage((page) => page + 1)}
              >
                Next limits
              </Button>
            </div>
          </section>
          <section className="rounded-xl border p-5">
            <h2 className="text-lg font-semibold">Latest 100 API calls</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="p-2">Model</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Charge (minor units)</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.usage
                    .filter((row) => !account || row.account_id === account)
                    .map((row) => (
                      <tr key={String(row.id)}>
                        <td className="p-2">{row.public_model}</td>
                        <td className="p-2">{row.settlement_state}</td>
                        <td className="p-2">
                          {row.final_customer_charge ?? `Held: ${row.maximum_reserved_charge}`}{" "}
                          {row.currency}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <Link to="/developers/$docSlug" params={{ docSlug: "quickstart" }} className="underline">
            Read the API quickstart
          </Link>
        </>
      )}
    </PublicPageView>
  );
}
