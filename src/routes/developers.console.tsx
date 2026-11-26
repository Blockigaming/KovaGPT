import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import type { ReactNode } from "react";
import {
  BookOpen,
  ChartNoAxesColumn,
  ChevronLeft,
  CreditCard,
  Folder,
  KeyRound,
  LayoutDashboard,
  List,
  SlidersHorizontal,
  Users,
} from "lucide-react";
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
const WORKSPACE_SECTIONS = [
  "overview",
  "projects",
  "keys",
  "files",
  "usage",
  "logs",
  "billing",
  "limits",
] as const;
type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const Route = createFileRoute("/developers/console")({
  validateSearch: (search: Record<string, unknown>): {
    section?: WorkspaceSection;
    funding?: "returned" | "canceled";
  } => ({
    section: WORKSPACE_SECTIONS.find((section) => section === search.section),
    funding: search.funding === "returned" || search.funding === "canceled" ? search.funding : undefined,
  }),
  component: DeveloperConsole,
  head: () => ({
    meta: [
      { title: "Developer console | KovaGPT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
function DeveloperWorkspace({
  children,
  authenticated = false,
  section = "overview",
}: {
  children: ReactNode;
  authenticated?: boolean;
  section?: WorkspaceSection;
}) {
  const navigation = [
    { label: "Overview", anchor: "overview", icon: LayoutDashboard },
    { label: "Projects", anchor: "projects", icon: Users },
    { label: "API keys", anchor: "keys", icon: KeyRound },
    { label: "Files", anchor: "files", icon: Folder },
    { label: "Usage", anchor: "usage", icon: ChartNoAxesColumn },
    { label: "Logs", anchor: "logs", icon: List },
    { label: "Billing", anchor: "billing", icon: CreditCard },
    { label: "Limits", anchor: "limits", icon: SlidersHorizontal },
  ] as const;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/developers" className="text-lg font-semibold tracking-tight">
            Kova
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">API Platform</span>
        </div>
        <Link to="/" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="size-4" aria-hidden="true" /> KovaGPT
        </Link>
      </header>
      <div className="mx-auto grid min-w-0 max-w-[1600px] md:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-border p-3 md:border-b-0 md:border-r md:p-4">
          <nav aria-label="Developer workspace" className="flex flex-wrap gap-1 md:sticky md:top-4 md:flex-col">
            {navigation
              .filter((item) => authenticated || item.anchor === "overview")
              .map(({ label, anchor, icon: Icon }) => (
                <Link
                  key={anchor}
                  to="/developers/console"
                  search={{ section: anchor }}
                  aria-current={section === anchor ? "page" : undefined}
                  className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring ${section === anchor ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            <Link to="/developers/$docSlug" params={{ docSlug: "docs" }} className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <BookOpen className="size-4 shrink-0" aria-hidden="true" /> Documentation
            </Link>
          </nav>
        </aside>
        <main id="main-content" tabIndex={-1} data-ui-reference="chatgpt-settings-form" className="min-w-0 space-y-6 px-4 py-6 sm:px-8 sm:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
function DeveloperConsole() {
  const { isSignedIn, user } = useUser();
  const search = Route.useSearch();
  const section = search.section ?? (search.funding ? "billing" : "overview");
  if (isSignedIn && user?.id)
    return <OwnedDeveloperConsole key={user.id} userId={user.id} section={section} />;
  return (
    <DeveloperWorkspace>
      <section id="overview" className="space-y-4 rounded-xl border border-border p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Developer workspace</h1>
        <p className="text-sm text-muted-foreground">Sign in with your existing KovaGPT account to manage your API projects.</p>
        <SignInButton mode="modal">
          <Button>Sign in to continue</Button>
        </SignInButton>
      </section>
    </DeveloperWorkspace>
  );
}
function OwnedDeveloperConsole({
  userId,
  section,
}: {
  userId: string;
  section: WorkspaceSection;
}) {
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
    [currency, setCurrency] = useState("USD");
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
  const [modelFilter, setModelFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const accountUsage = (data?.usage ?? []).filter((row) => !account || row.account_id === account);
  const distinct = (field: string) =>
    [...new Set(accountUsage.map((row) => String(row[field] ?? "")).filter(Boolean))].sort();
  const visibleUsage = accountUsage.filter((row) =>
    (!modelFilter || row.public_model === modelFilter) &&
    (!serviceFilter || row.capability === serviceFilter) &&
    (!statusFilter || row.settlement_state === statusFilter) &&
    (!dateFilter || String(row.created_at).slice(0, 10) >= dateFilter)
  );
  const settledByCurrency = new Map<string, number>();
  for (const row of visibleUsage) {
    if (row.final_customer_charge == null) continue;
    const amount = Number(row.final_customer_charge);
    const currency = String(row.currency);
    if (Number.isFinite(amount))
      settledByCurrency.set(currency, (settledByCurrency.get(currency) ?? 0) + amount);
  }
  const fieldClass = "mt-1 block w-full";
  return (
    <DeveloperWorkspace authenticated section={section}>
      <section id="overview" hidden={section !== "overview"} className="scroll-mt-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Workspace / Overview</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Overview</h1>
            <p className="mt-2 text-sm text-muted-foreground">Build and manage your applications with Kova.</p>
          </div>
          <Link to="/developers/connections" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
            MCP connections
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            ["Credit accounts", data?.accounts.length],
            ["Projects", data?.projects.length],
            ["API keys", data?.keys.filter((key) => !key.revoked_at && key.enabled === true).length],
            ["Recent calls (up to 100)", data?.usage.length],
          ] as const).map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{value ?? "—"}</p>
            </div>
          ))}
        </div>
      </section>
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
            hidden={section !== "projects"}
            className="space-y-4 rounded-xl border p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate({ operation: "create_account", name, currency });
            }}
          >
            <h2 className="text-lg font-semibold">Create a credit account</h2>
            <label className="block">
              Account name
              <Input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block">
              Billing currency (three-letter code)
              <Input
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
          <section aria-label="Account and project selection" className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="developer-console-account">Account</label>
              <Select
                value={account || "__none__"}
                onValueChange={(value) => {
                  setAccount(value === "__none__" ? "" : value);
                  setProject("");
                  setSecret("");
                }}
              >
                <SelectTrigger id="developer-console-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select an account</SelectItem>
                  {data?.accounts.map((row) => (
                    <SelectItem key={String(row.account_id)} value={String(row.account_id)}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selected && (
              <p>
                Available: {selected.available_amount} {selected.currency} minor units. Reserved:{" "}
                {selected.reserved_amount}.{" "}
                {selected.suspended_at ? "This account is suspended." : ""}
              </p>
            )}
            <div className="grid gap-1">
              <label htmlFor="developer-console-project">Project</label>
              <Select
                value={project || "__none__"}
                onValueChange={(value) => setProject(value === "__none__" ? "" : value)}
              >
                <SelectTrigger id="developer-console-project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select a project</SelectItem>
                  {data?.projects
                    .filter((row) => row.account_id === account)
                    .map((row) => (
                      <SelectItem key={String(row.id)} value={String(row.id)}>
                        {row.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </section>
          <section id="keys" hidden={section !== "keys" && section !== "limits"} className="scroll-mt-4 space-y-4 rounded-xl border p-5">
            <h2 className="text-lg font-semibold">Keys and spending limits</h2>
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
                  <Input
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
              <Input
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
                <Textarea readOnly aria-label="New API key" value={secret} className={fieldClass} />
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
                    <div className="flex flex-wrap gap-2">
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
          <section id="files" hidden={section !== "files"} className="scroll-mt-4 space-y-3">
            {section === "files" && project ? (
              <DeveloperFilesPanel key={`${userId}:${project}`} userId={userId} projectId={project} />
            ) : (
              <div className="rounded-xl border p-5">
                <h2 className="text-lg font-semibold">Files</h2>
                <p className="mt-2 text-sm text-muted-foreground">Select a project in API keys &amp; projects to manage its files.</p>
              </div>
            )}
          </section>
          <section id="billing" hidden={section !== "billing"} className="scroll-mt-4 space-y-3">
            {section === "billing" && account ? (
              <DeveloperFundingPanel
                key={`${userId}:${account}`}
                userId={userId}
                accountId={account}
                onBalanceChanged={load}
              />
            ) : (
              <div className="rounded-xl border p-5">
                <h2 className="text-lg font-semibold">Billing</h2>
                <p className="mt-2 text-sm text-muted-foreground">Select a credit account to manage API funding.</p>
              </div>
            )}
          </section>
          <section id="limits" hidden={section !== "limits"} className="scroll-mt-4 space-y-3 rounded-xl border p-5">
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
            <div className="flex flex-wrap items-center gap-3">
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
          <section id="usage" hidden={section !== "usage" && section !== "logs"} className="scroll-mt-4 space-y-4 rounded-xl border p-5">
            <h1 className="text-2xl font-semibold">{section === "logs" ? "Request logs" : "Usage"}</h1>
            <p className="text-sm text-muted-foreground">Filters and totals cover only the latest 100 API calls returned by the server. They are not full-period billing totals.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ["Model", "public_model", modelFilter, setModelFilter],
                ["Service", "capability", serviceFilter, setServiceFilter],
                ["Status", "settlement_state", statusFilter, setStatusFilter],
              ] as const).map(([label, field, value, setter]) => (
                <label key={field} className="space-y-1 text-sm">
                  <span>{label}</span>
                  <select value={value} onChange={(event) => setter(event.target.value)} className="block min-h-10 w-full rounded-md border border-border bg-background px-2">
                    <option value="">All</option>
                    {distinct(field).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              ))}
              <label className="space-y-1 text-sm">
                <span>From (UTC)</span>
                <Input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
              </label>
            </div>
            <Button variant="outline" onClick={() => {
              setModelFilter("");
              setServiceFilter("");
              setStatusFilter("");
              setDateFilter("");
            }}>Clear filters</Button>
            {section === "usage" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Matching requests</p>
                  <p className="text-2xl font-semibold">{data ? visibleUsage.length : "—"}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Recorded final charges (minor units)</p>
                  {settledByCurrency.size ? [...settledByCurrency].map(([currency, amount]) => (
                    <p key={currency} className="text-xl font-semibold tabular-nums">{amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {currency}</p>
                  )) : <p className="text-sm text-muted-foreground">No final charges in this view.</p>}
                </div>
              </div>
            )}
            {data && !visibleUsage.length && <p className="text-sm text-muted-foreground">No matching API calls.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="p-2">Model</th>
                    <th className="p-2">Service</th>
                    <th className="p-2">Time (UTC)</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Charge (minor units)</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsage.map((row) => (
                      <tr key={String(row.id)}>
                        <td className="p-2">{row.public_model}</td>
                        <td className="p-2">{row.capability}</td>
                        <td className="p-2">{row.created_at}</td>
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
    </DeveloperWorkspace>
  );
}
