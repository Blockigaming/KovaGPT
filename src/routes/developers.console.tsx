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
  FlaskConical,
  KeyRound,
  Layers,
  LayoutDashboard,
  List,
  Menu,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NovaLogo } from "@/components/NovaLogo";
import "@/styles/developer-console.css";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { DeveloperFundingPanel } from "@/components/DeveloperFundingPanel";
import { DeveloperCreditWallet } from "@/components/DeveloperCreditWallet";
import { DeveloperFilesPanel } from "@/components/DeveloperFilesPanel";
import { DeveloperPlayground } from "@/components/DeveloperPlayground";
import { KOVA_MODEL_LABELS } from "@/lib/kova-foundation-models.mjs";
import type { DeveloperUsageSummary } from "@/lib/pricing/developer-usage-summary.mjs";
type Row = Record<string, string | number | boolean | null | string[]>;
const CSV_FIELDS = [
  "id",
  "account_id",
  "project_id",
  "api_key_id",
  "public_model",
  "capability",
  "created_at",
  "settled_at",
  "settlement_state",
  "input_tokens",
  "cached_input_tokens",
  "image_input_tokens",
  "output_tokens",
  "final_customer_charge",
  "maximum_reserved_charge",
  "currency",
] as const;
function downloadUsageCsv(rows: Row[], filename: string) {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+@-]/.test(text.trimStart()) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const csv = [
    CSV_FIELDS.join(","),
    ...rows.map((row) => CSV_FIELDS.map((field) => cell(row[field])).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type ConsoleData = {
  enabled: boolean;
  workspaceV2?: boolean;
  consumerCreditSharing?: boolean;
  accounts: Row[];
  projects: Row[];
  keys: Row[];
  limits: Row[];
  usage: Row[];
  balances: Row[];
  limitsPage: number;
  limitsHasMore: boolean;
  usagePage?: number;
  usageHasMore?: boolean;
};
const WORKSPACE_SECTIONS = [
  "overview",
  "playground",
  "projects",
  "keys",
  "models",
  "files",
  "usage",
  "costs",
  "logs",
  "billing",
  "limits",
  "settings",
] as const;
type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const Route = createFileRoute("/developers/console")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    section?: WorkspaceSection;
    funding?: "returned" | "canceled";
  } => ({
    section: WORKSPACE_SECTIONS.find((section) => section === search.section),
    funding:
      search.funding === "returned" || search.funding === "canceled" ? search.funding : undefined,
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => setMobileNavOpen(false), [section]);
  const navigation = [
    {
      label: "Workspace",
      items: [
        { label: "Overview", anchor: "overview", icon: LayoutDashboard },
        { label: "Playground", anchor: "playground", icon: FlaskConical },
        { label: "Models", anchor: "models", icon: Layers },
        { label: "Files", anchor: "files", icon: Folder },
      ],
    },
    {
      label: "Analytics",
      items: [
        { label: "Usage", anchor: "usage", icon: ChartNoAxesColumn },
        { label: "Costs", anchor: "costs", icon: CreditCard },
        { label: "Logs", anchor: "logs", icon: List },
      ],
    },
    {
      label: "Manage",
      items: [
        { label: "Projects", anchor: "projects", icon: Users },
        { label: "API keys", anchor: "keys", icon: KeyRound },
        { label: "Billing", anchor: "billing", icon: CreditCard },
        { label: "Limits", anchor: "limits", icon: SlidersHorizontal },
        { label: "Settings", anchor: "settings", icon: Settings },
      ],
    },
  ] as const;
  return (
    <div
      data-developer-workspace
      className="min-h-dvh min-w-0 w-full bg-background font-sans text-foreground [overflow-wrap:anywhere]"
    >
      <header className="sticky top-0 z-30 flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 sm:min-h-16 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 shrink-0 md:hidden"
            aria-label={mobileNavOpen ? "Close developer navigation" : "Open developer navigation"}
            aria-expanded={mobileNavOpen}
            aria-controls="developer-workspace-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
          <Link
            to="/developers"
            className="flex shrink-0 items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <NovaLogo decorative className="size-6" />
            <span>KovaGPT</span>
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="min-w-0 text-sm text-muted-foreground">
            API<span className="hidden sm:inline"> Platform</span>
          </span>
        </div>
        <Link
          to="/"
          aria-label="Back to KovaGPT"
          className="kova-button inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">KovaGPT</span>
        </Link>
      </header>
      <div className="grid min-h-[calc(100dvh-4rem)] w-full min-w-0 grid-cols-[minmax(0,1fr)] md:grid-cols-[224px_minmax(0,1fr)] xl:grid-cols-[var(--kova-sidebar-width)_minmax(0,1fr)]">
        <aside
          id="developer-workspace-navigation"
          className={`min-w-0 rounded-b-[var(--kova-radius-panel)] border-b border-border bg-sidebar px-3 py-4 md:block md:rounded-none md:border-b-0 md:border-r md:bg-background md:px-4 md:py-6 ${mobileNavOpen ? "block" : "hidden"}`}
        >
          <nav
            aria-label="Developer workspace"
            className="flex max-h-[70dvh] flex-col gap-1 overflow-y-auto overscroll-contain md:sticky md:top-20 md:max-h-[calc(100dvh-6rem)]"
          >
            {navigation.map((group) => {
              const items = group.items.filter((item) => authenticated || item.anchor === "overview");
              if (items.length === 0) return null;
              return (
                <div key={group.label} className="mb-4 flex min-w-0 flex-col gap-1">
                  {authenticated && (
                    <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </p>
                  )}
                  {items.map(({ label, anchor, icon: Icon }) => (
                    <Link
                      key={anchor}
                      to="/developers/console"
                      search={{ section: anchor }}
                      onClick={() => setMobileNavOpen(false)}
                      aria-current={section === anchor ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-3 rounded-[var(--kova-radius-sidebar)] px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 ${section === anchor ? "bg-sidebar-active font-medium text-foreground" : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground"}`}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {label}
                    </Link>
                  ))}
                </div>
              );
            })}
            <Link
              to="/developers/$docSlug"
              params={{ docSlug: "docs" }}
              className="flex min-h-10 items-center gap-2.5 rounded-[var(--kova-radius-sidebar)] px-3 text-sm text-muted-foreground hover:bg-sidebar-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookOpen className="size-4 shrink-0" aria-hidden="true" /> Documentation
            </Link>
          </nav>
        </aside>
        <main
          id="main-content"
          tabIndex={-1}
          data-ui-reference="chatgpt-settings-form"
          className="mx-auto w-full min-w-0 max-w-[1320px] space-y-6 px-4 py-6 sm:space-y-8 sm:px-8 sm:py-10 xl:px-12 [&_button]:max-w-full [&_button]:whitespace-normal"
        >
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
        <p className="text-sm text-muted-foreground">
          Sign in with your existing KovaGPT account to manage your API projects.
        </p>
        <SignInButton mode="modal">
          <Button>Sign in to continue</Button>
        </SignInButton>
      </section>
    </DeveloperWorkspace>
  );
}
function OwnedDeveloperConsole({ userId, section }: { userId: string; section: WorkspaceSection }) {
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
  const [projectName, setProjectName] = useState("");
  const [renameId, setRenameId] = useState("");
  const projectCreateId = useRef<string | null>(null);
  const [account, setAccount] = useState(""),
    [project, setProject] = useState(""),
    [name, setName] = useState(""),
    [currency, setCurrency] = useState("USD");
  const [requestLimit, setRequestLimit] = useState(""),
    [daily, setDaily] = useState(""),
    [monthly, setMonthly] = useState(""),
    [concurrent, setConcurrent] = useState("1"),
    [scopes, setScopes] = useState<string[]>(["chat"]);
  const [modelFilter, setModelFilter] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [catalogFilter, setCatalogFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [usageProject, setUsageProject] = useState("");
  const [usageKey, setUsageKey] = useState("");
  const [usagePage, setUsagePage] = useState(0);
  const [loadedUsageQuery, setLoadedUsageQuery] = useState<string | null>(null);
  const usageParams = new URLSearchParams({ usagePage: String(usagePage) });
  for (const [key, value] of [
    ["usageAccount", account],
    ["usageProject", usageProject],
    ["usageKey", usageKey],
    ["usageModel", modelFilter.trim()],
    ["usageService", serviceFilter.trim()],
    ["usageStatus", statusFilter],
    ["usageFrom", dateFilter],
    ["usageThrough", endDateFilter],
  ]) {
    if (value) usageParams.set(key, value);
  }
  const usageQuery = usageParams.toString();
  usageParams.delete("usagePage");
  const summaryQuery = usageParams.toString();
  const [summary, setSummary] = useState<{
    query: string;
    data: DeveloperUsageSummary;
    readAt: string;
  } | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const summaryAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    setSummary(null);
    setSummaryError("");
    setSummaryBusy(false);
    return () => {
      summaryAbort.current?.abort();
      summaryAbort.current = null;
    };
  }, [summaryQuery, userId]);
  const loadSummary = async () => {
    if (summaryAbort.current || !dateFilter || !endDateFilter) return;
    const controller = new AbortController();
    summaryAbort.current = controller;
    setSummaryBusy(true);
    setSummaryError("");
    try {
      const response = await fetchWithTimeoutAuthenticated(
        `/api/developer/console?${summaryQuery}&usageSummary=1`,
        { signal: controller.signal, headers: { "X-Kova-Expected-User": userId } },
        45_000,
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.code === "developer_summary_range_too_large"
            ? "More than 5,000 matching records. Narrow the date range or choose a project."
            : result.error?.code === "developer_summary_range_invalid"
              ? "Select a date range of 93 days or less."
              : (result.error?.message ?? "Could not load analytics."),
        );
      if (!controller.signal.aborted && summaryAbort.current === controller) {
        setSummary({ query: summaryQuery, data: result.summary, readAt: result.summaryReadAt });
      }
    } catch (cause) {
      if (!controller.signal.aborted && summaryAbort.current === controller)
        setSummaryError(cause instanceof Error ? cause.message : "Could not load analytics.");
    } finally {
      if (summaryAbort.current === controller) {
        summaryAbort.current = null;
        setSummaryBusy(false);
      }
    }
  };
  const currentSummary = summary?.query === summaryQuery ? summary : null;
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    setExportBusy(false);
    setExportError("");
    return () => {
      exportAbort.current?.abort();
      exportAbort.current = null;
    };
  }, [summaryQuery, userId]);
  const exportRange = async () => {
    if (exportAbort.current || !dateFilter || !endDateFilter) return;
    const controller = new AbortController();
    exportAbort.current = controller;
    setExportBusy(true);
    setExportError("");
    try {
      const response = await fetchWithTimeoutAuthenticated(
        `/api/developer/console?${summaryQuery}&usageExport=1`,
        {
          signal: controller.signal,
          headers: { "X-Kova-Expected-User": userId },
        },
        45_000,
      );
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.exportRows))
        throw new Error(
          result.error?.code === "developer_summary_range_too_large"
            ? "More than 5,000 matching records. Choose a narrower date range."
            : (result.error?.message ?? "Export could not be completed."),
        );
      if (!controller.signal.aborted && exportAbort.current === controller)
        downloadUsageCsv(result.exportRows, `kova-api-usage-${dateFilter}-${endDateFilter}.csv`);
    } catch (cause) {
      if (!controller.signal.aborted && exportAbort.current === controller)
        setExportError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      if (exportAbort.current === controller) {
        exportAbort.current = null;
        setExportBusy(false);
      }
    }
  };
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const owner = ownerRef.current;
      if (owner !== userId) return;
      const version = ++loadVersion.current;
      const response = await fetchWithTimeoutAuthenticated(
        `/api/developer/console?limitsPage=${limitsPageRef.current}&${usageQuery}`,
        { signal, headers: { "X-Kova-Expected-User": userId } },
      );
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error?.message ?? "Could not load your developer workspace.");
      if (!signal?.aborted && owner === ownerRef.current && version === loadVersion.current) {
        setData(value);
        setLoadedUsageQuery(usageQuery);
      }
    },
    [userId, usageQuery],
  );
  useEffect(() => {
    ownerRef.current = userId;
    const controller = new AbortController();
    setError("");
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
      if (
        ["create_account", "create_project", "ensure_workspace"].includes(String(body.operation)) &&
        typeof value.accountId === "string"
      ) {
        setAccount(value.accountId);
        if (typeof value.projectId === "string") setProject(value.projectId);
      }
      if (body.operation === "create_project" || body.operation === "rename_project") {
        setProjectName("");
        setRenameId("");
        projectCreateId.current = null;
      }
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
  useEffect(() => {
    if (section !== "keys" && section !== "limits") setSecret("");
  }, [section]);
  const autoSelected = useRef(false);
  const provisioning = useRef(false);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const shouldProvision = data?.workspaceV2 === true && data.accounts.length === 0;
  useEffect(() => {
    if (!shouldProvision || provisioning.current) return;
    const controller = new AbortController();
    provisioning.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const response = await fetchWithTimeoutAuthenticated("/api/developer/console", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-Kova-Expected-User": userId },
          body: JSON.stringify({ operation: "ensure_workspace" }),
        });
        const value = await response.json();
        if (
          !response.ok ||
          typeof value.accountId !== "string" ||
          typeof value.projectId !== "string"
        )
          throw new Error(value.error?.message ?? "Workspace setup could not be confirmed.");
        if (!controller.signal.aborted && ownerRef.current === userId) {
          setAccount(value.accountId);
          setProject(value.projectId);
          setBusy(false);
        }
      } catch (cause) {
        if (!controller.signal.aborted && ownerRef.current === userId)
          setError(cause instanceof Error ? cause.message : "Workspace setup failed.");
      } finally {
        if (!controller.signal.aborted) {
          provisioning.current = false;
          setBusy(false);
        }
      }
    })();
    return () => {
      controller.abort();
      provisioning.current = false;
    };
    // The setup RPC is idempotent; it may safely repeat after an interrupted login.
  }, [shouldProvision, userId, setupAttempt]);
  useEffect(() => {
    if (!data || autoSelected.current) return;
    autoSelected.current = true;
    if (data.accounts.length !== 1) return;
    const id = String(data.accounts[0].account_id);
    setAccount(id);
    const projects = data.projects.filter((row) => row.account_id === id);
    if (projects.length === 1) setProject(String(projects[0].id));
  }, [data]);
  const selected = data?.balances.find((row) => row.id === account);
  const usageReady = loadedUsageQuery === usageQuery;
  const visibleUsage = usageReady ? (data?.usage ?? []) : [];
  const clearUsageFilters = () => {
    setModelFilter("");
    setModelDraft("");
    setServiceFilter("");
    setStatusFilter("");
    setDateFilter("");
    setEndDateFilter("");
    setUsageProject("");
    setUsageKey("");
    setUsagePage(0);
  };
  const settledByCurrency = new Map<string, number>();
  for (const row of visibleUsage) {
    if (row.final_customer_charge == null) continue;
    const amount = Number(row.final_customer_charge);
    const currency = String(row.currency);
    if (Number.isFinite(amount))
      settledByCurrency.set(currency, (settledByCurrency.get(currency) ?? 0) + amount);
  }
  const tokenDimensions = [
    "input_tokens",
    "cached_input_tokens",
    "image_input_tokens",
    "output_tokens",
  ] as const;
  const tokenTotals = Object.fromEntries(
    tokenDimensions.map((dimension) => [
      dimension,
      visibleUsage.reduce((total, row) => {
        const value = row[dimension];
        return (
          total +
          (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0)
        );
      }, 0),
    ]),
  );
  const measuredRequests = visibleUsage.filter((row) =>
    tokenDimensions.some((dimension) => typeof row[dimension] === "number"),
  ).length;
  const activityByDay = new Map<string, number>();
  for (const row of visibleUsage) {
    const day = String(row.created_at).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) activityByDay.set(day, (activityByDay.get(day) ?? 0) + 1);
  }
  const activity = [...activityByDay].sort(([a], [b]) => a.localeCompare(b));
  const peak = Math.max(1, ...activity.map(([, count]) => count));
  const fieldClass = "mt-1 block w-full min-w-0";
  return (
    <DeveloperWorkspace authenticated section={section}>
      <section id="overview" hidden={section !== "overview"} className="scroll-mt-20 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Workspace / Overview</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Overview</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Build and manage your applications with Kova.
            </p>
          </div>
          <Link
            to="/developers/connections"
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            MCP connections
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {(
            [
              ["Credit accounts", data?.accounts.length],
              ["Projects", data?.projects.length],
              [
                "API keys",
                data?.keys.filter((key) => !key.revoked_at && key.enabled === true).length,
              ],
              ["Requests in current view", usageReady ? visibleUsage.length : undefined],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-[var(--kova-radius-panel)] border border-border bg-background p-4 sm:p-6">
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
          {data && data.accounts.length === 0 && section === "overview" && (
            <section className="min-w-0 rounded-xl border border-border p-4">
              <h2 className="font-semibold">Set up your developer workspace</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You are already signed in to KovaGPT. Your developer credit account has not been
                created yet.
              </p>
              {data.workspaceV2 ? (
                <Button
                  disabled={busy}
                  className="mt-4"
                  onClick={() => setSetupAttempt((attempt) => attempt + 1)}
                >
                  {busy ? "Preparing workspace…" : "Retry workspace setup"}
                </Button>
              ) : (
                <Button
                  disabled={busy}
                  className="mt-4"
                  onClick={() =>
                    void mutate({
                      operation: "create_account",
                      name: "Personal workspace",
                      currency: "USD",
                    })
                  }
                >
                  Create workspace
                </Button>
              )}
            </section>
          )}
          {data && !data.enabled && (
            <p role="status">
              Paid API execution is not enabled. You can prepare your workspace and limits.
            </p>
          )}
          {section === "playground" && (
            <DeveloperPlayground key={userId} enabled={data?.enabled === true} />
          )}
          {section === "models" && (
            <section className="min-w-0 space-y-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Models</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Explore the Kova model families. An approved pricing contract and enabled API key
                  are required before a model can be used.
                </p>
              </div>
              <Input
                aria-label="Search models"
                placeholder="Search models"
                value={catalogFilter}
                onChange={(event) => setCatalogFilter(event.target.value)}
              />
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Object.entries(KOVA_MODEL_LABELS)
                  .filter(([id, label]) =>
                    (id + " " + label).toLowerCase().includes(catalogFilter.trim().toLowerCase()),
                  )
                  .map(([id, label]) => (
                    <article
                      key={id}
                      className="min-w-0 space-y-2 rounded-[var(--kova-radius-card)] border border-border bg-background p-5"
                    >
                      <Layers className="size-5 text-muted-foreground" aria-hidden="true" />
                      <h2 className="font-semibold">{label}</h2>
                      <p className="break-all font-mono text-xs text-muted-foreground">{id}</p>
                      <p className="text-xs text-muted-foreground">
                        Text / reasoning · API availability must be confirmed with GET
                        /api/v1/models.
                      </p>
                    </article>
                  ))}
              </div>
              <Link
                to="/developers/$docSlug"
                params={{ docSlug: "models" }}
                className="inline-flex min-h-10 items-center text-sm underline"
              >
                Model API documentation
              </Link>
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Other API capabilities</h2>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["Image generation", "images"],
                      ["Embeddings", "api-reference"],
                      ["Files", "files"],
                      ["Web search", "search"],
                      ["Agents", "agents"],
                      ["Webhooks", "webhooks"],
                    ] as const
                  ).map(([label, slug]) => (
                    <Link
                      key={slug}
                      to="/developers/$docSlug"
                      params={{ docSlug: slug }}
                      className="min-w-0 rounded-[var(--kova-radius-card)] border border-border p-4 text-sm hover:bg-muted"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </section>
            </section>
          )}
          {section === "settings" && (
            <section className="min-w-0 space-y-6">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
              <article className="space-y-3 border-b border-border pb-6">
                <h2 className="font-semibold">Account</h2>
                <p className="text-sm text-muted-foreground">
                  This workspace uses your existing KovaGPT sign-in. Manage your main account on
                  KovaGPT.
                </p>
                <Link to="/" className="inline-flex min-h-10 items-center text-sm underline">
                  Open KovaGPT
                </Link>
              </article>
              <article className="space-y-3 border-b border-border pb-6">
                <h2 className="font-semibold">Spending and security</h2>
                <p className="text-sm text-muted-foreground">
                  Manage spending ceilings and scoped credentials.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    to="/developers/console"
                    search={{ section: "limits" }}
                    className="inline-flex min-h-10 items-center text-sm underline"
                  >
                    Spending limits
                  </Link>
                  <Link
                    to="/developers/console"
                    search={{ section: "keys" }}
                    className="inline-flex min-h-10 items-center text-sm underline"
                  >
                    API keys
                  </Link>
                  <Link
                    to="/developers/connections"
                    className="inline-flex min-h-10 items-center text-sm underline"
                  >
                    MCP connections
                  </Link>
                </div>
              </article>
              {data?.workspaceV2 && (
                <article className="min-w-0 space-y-3 border-b border-border pb-6">
                  <h2 className="font-semibold">KovaGPT usage credits</h2>
                  <p className="text-sm text-muted-foreground">
                    Your preference is saved to your account. Consumer credit spending is not active
                    until the shared ledger integration is released.
                  </p>
                  <label className="flex min-w-0 items-start gap-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={data.consumerCreditSharing === true}
                      disabled={busy}
                      className="mt-0.5 size-5 shrink-0"
                      onChange={(event) =>
                        void mutate({
                          operation: "set_credit_sharing",
                          enabled: event.target.checked,
                        })
                      }
                    />
                    <span className="min-w-0">
                      Allow purchased API credits to fund additional KovaGPT usage when available
                      (off by default).
                    </span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Included Pro API credits are excluded. This preference does not purchase credits
                    or enable auto-reload.
                  </p>
                </article>
              )}
              <article className="space-y-3 border-b border-border pb-6">
                <h2 className="font-semibold">Data sharing</h2>
                <p className="text-sm text-muted-foreground">
                  Kova does not offer free API tokens in exchange for training data. The planned Pro
                  monthly API allowance is not tied to data sharing.
                </p>
              </article>
            </section>
          )}
          {section === "projects" && (
            <section className="min-w-0 space-y-5 border-b border-border pb-6">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Projects</h1>
              <p className="text-sm text-muted-foreground">
                Projects belong to your developer credit accounts.
              </p>
              {data?.projects.length ? (
                <ul className="divide-y divide-border">
                  {data.projects.map((row) => (
                    <li
                      key={String(row.id)}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                    >
                      <div className="min-w-0 flex-1 break-words">
                        <p className="font-medium">{row.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {data.accounts.find((item) => item.account_id === row.account_id)?.name}
                        </p>
                      </div>
                      <div className="flex max-w-full flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setAccount(String(row.account_id));
                            setProject(String(row.id));
                            setRenameId("");
                            setProjectName("");
                            projectCreateId.current = null;
                            setSecret("");
                            clearUsageFilters();
                          }}
                        >
                          Select project
                        </Button>
                        {data.workspaceV2 && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setAccount(String(row.account_id));
                              setProject(String(row.id));
                              setRenameId(String(row.id));
                              setProjectName(String(row.name));
                              projectCreateId.current = null;
                              clearUsageFilters();
                            }}
                          >
                            Rename
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {data ? "No projects yet." : "Loading projects…"}
                </p>
              )}
            </section>
          )}
          {section === "projects" && data?.workspaceV2 && account && (
            <form
              className="min-w-0 space-y-5 border-b border-border pb-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (!projectCreateId.current) projectCreateId.current = crypto.randomUUID();
                void mutate({
                  operation: renameId ? "rename_project" : "create_project",
                  accountId: account,
                  projectId: renameId || projectCreateId.current,
                  name: projectName,
                });
              }}
            >
              <h2 className="font-semibold">{renameId ? "Rename project" : "Create project"}</h2>
              <label className="block space-y-1 text-sm">
                Project name
                <Input
                  required
                  maxLength={80}
                  value={projectName}
                  disabled={busy}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    projectCreateId.current = null;
                  }}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || !projectName.trim()}>
                  {renameId ? "Save name" : "Create project"}
                </Button>
                {renameId && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setRenameId("");
                      setProjectName("");
                      projectCreateId.current = null;
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          )}
          <form
            hidden={section !== "projects"}
            className="min-w-0 space-y-5 border-b border-border pb-6"
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
          <section
            aria-label="Account and project selection"
            className="grid min-w-0 gap-4 border-b border-border pb-5 sm:grid-cols-2"
          >
            <div className="grid min-w-0 gap-1">
              <label htmlFor="developer-console-account">Account</label>
              <Select
                value={account || "__none__"}
                onValueChange={(value) => {
                  setAccount(value === "__none__" ? "" : value);
                  setRenameId("");
                  setProjectName("");
                  projectCreateId.current = null;
                  setProject("");
                  setSecret("");
                  clearUsageFilters();
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
            <div className="grid min-w-0 gap-1">
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
            {selected && (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Available: {selected.available_amount} {selected.currency} minor units. Reserved:{" "}
                {selected.reserved_amount}.{" "}
                {selected.suspended_at ? "This account is suspended." : ""}
              </p>
            )}
          </section>
          <section
            id="keys"
            hidden={section !== "keys" && section !== "limits"}
            className="min-w-0 scroll-mt-20 space-y-6"
          >
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {section === "keys" ? "API keys" : "Spending limits"}
            </h1>
            {section === "keys" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Manage API keys for the selected account and project.
                </p>
                <ul className="divide-y divide-border border-y border-border">
                  {data?.keys
                    .filter((row) => row.account_id === account)
                    .map((row) => (
                      <li
                        key={String(row.id)}
                        className="flex flex-wrap items-center justify-between gap-3 py-4"
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
                {!data?.keys.some((row) => row.account_id === account) && (
                  <p className="py-4 text-sm text-muted-foreground">No API keys yet.</p>
                )}
              </div>
            )}
            {secret && (
              <div role="status" className="space-y-3 rounded-lg border border-border p-4">
                <p>
                  Save this key in your server’s secret manager. It is shown once and expires in 89
                  days.
                </p>
                <Textarea readOnly aria-label="New API key" value={secret} className={fieldClass} />
                <Button onClick={() => setSecret("")}>Hide key</Button>
              </div>
            )}
            <details key={section} open={section === "limits" ? true : undefined}>
              <summary className="cursor-pointer rounded-full border border-border px-5 py-3 text-sm font-medium hover:bg-muted">
                {section === "keys" ? "Create API key" : "Configure spending limits"}
              </summary>
              <div className="mt-5 space-y-5">
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
              </div>
            </details>
          </section>
          <section id="files" hidden={section !== "files"} className="scroll-mt-4 space-y-3">
            {section === "files" && project ? (
              <DeveloperFilesPanel
                key={`${userId}:${project}`}
                userId={userId}
                projectId={project}
              />
            ) : (
              <div className="rounded-xl border p-5">
                <h2 className="text-lg font-semibold">Files</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a project in API keys &amp; projects to manage its files.
                </p>
              </div>
            )}
          </section>
          <section id="billing" hidden={section !== "billing"} className="scroll-mt-4 space-y-3">
            {section === "billing" && account ? (
              <>
                <DeveloperCreditWallet
                  key={`${userId}:${account}`}
                  userId={userId}
                  accountId={account}
                  revision={JSON.stringify(selected ?? null)}
                />
                <DeveloperFundingPanel
                  key={`${userId}:${account}`}
                  userId={userId}
                  accountId={account}
                  onBalanceChanged={load}
                />
              </>
            ) : (
              <div className="rounded-xl border p-5">
                <h2 className="text-lg font-semibold">Billing</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a credit account to manage API funding.
                </p>
              </div>
            )}
          </section>
          <section
            id="limits"
            hidden={section !== "limits"}
            className="min-w-0 scroll-mt-20 space-y-5"
          >
            <h2 className="text-lg font-semibold">Stored spending limits</h2>
            <div className="grid gap-2 md:hidden" aria-label="Mobile spending limits">
              {data?.limits.map((row) => (
                <article
                  key={`${row.account_id}:${row.scope_type}:${row.scope_id}`}
                  className="min-w-0 space-y-2 rounded-lg border border-border p-3"
                >
                  <p className="break-words text-sm font-medium">
                    {data.accounts.find((a) => a.account_id === row.account_id)?.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.scope_type} · {String(row.scope_id).slice(0, 8)}
                  </p>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    {(
                      [
                        ["Per request", row.request_limit],
                        ["Per day", row.daily_limit],
                        ["Per month", row.monthly_limit],
                        ["Concurrent", row.concurrent_limit],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="break-words font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
            <div className="hidden max-w-full min-w-0 overflow-x-auto md:block">
              <table className="w-full min-w-[520px] text-left text-sm">
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
          <section
            id="usage"
            hidden={section !== "usage" && section !== "costs" && section !== "logs"}
            className="min-w-0 scroll-mt-20 space-y-6"
          >
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {section === "logs" ? "Request logs" : section === "costs" ? "Costs" : "Usage"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Filter your API request history. Page totals cover up to 100 records; generate a
              date-range summary to see all matching records within the supported range.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span>Model ID</span>
                <div className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap">
                  <Input
                    className="min-w-0 flex-1"
                    value={modelDraft}
                    onChange={(event) => setModelDraft(event.target.value)}
                    placeholder="All models"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      setModelFilter(modelDraft.trim());
                      setUsagePage(0);
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </label>
              <label className="space-y-1 text-sm">
                <span>Service</span>
                <select
                  value={serviceFilter}
                  onChange={(event) => {
                    setServiceFilter(event.target.value);
                    setUsagePage(0);
                  }}
                  className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                >
                  <option value="">All services</option>
                  {["chat", "streaming", "image_generation", "embeddings", "files"].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    setUsagePage(0);
                  }}
                  className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                >
                  <option value="">All statuses</option>
                  {[
                    "reserved",
                    "dispatched",
                    "settled",
                    "uncertain",
                    "reconciliation_required",
                    "rejected",
                  ].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Project</span>
                <select
                  value={usageProject}
                  onChange={(event) => {
                    setUsageProject(event.target.value);
                    setUsageKey("");
                    setUsagePage(0);
                  }}
                  className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                >
                  <option value="">All projects</option>
                  {data?.projects
                    .filter((row) => !account || row.account_id === account)
                    .map((row) => (
                      <option key={String(row.id)} value={String(row.id)}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>API key</span>
                <select
                  value={usageKey}
                  onChange={(event) => {
                    setUsageKey(event.target.value);
                    setUsagePage(0);
                  }}
                  className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                >
                  <option value="">All keys (including revoked)</option>
                  {data?.keys
                    .filter(
                      (row) =>
                        (!account || row.account_id === account) &&
                        (!usageProject || row.project_id === usageProject),
                    )
                    .map((row) => (
                      <option key={String(row.id)} value={String(row.id)}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>From (UTC)</span>
                <Input
                  type="date"
                  value={dateFilter}
                  max={endDateFilter || undefined}
                  onChange={(event) => {
                    setDateFilter(event.target.value);
                    setUsagePage(0);
                  }}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Through (UTC)</span>
                <Input
                  type="date"
                  value={endDateFilter}
                  min={dateFilter || undefined}
                  onChange={(event) => {
                    setEndDateFilter(event.target.value);
                    setUsagePage(0);
                  }}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {[7, 30, 90].map((days) => (
                <Button
                  key={days}
                  variant="outline"
                  onClick={() => {
                    const today = new Date();
                    setEndDateFilter(today.toISOString().slice(0, 10));
                    today.setUTCDate(today.getUTCDate() - days + 1);
                    setDateFilter(today.toISOString().slice(0, 10));
                    setUsagePage(0);
                  }}
                >
                  Last {days} days
                </Button>
              ))}
              <Button variant="outline" onClick={clearUsageFilters}>
                Clear filters
              </Button>
              <Button
                variant="outline"
                disabled={!usageReady || !visibleUsage.length}
                onClick={() =>
                  downloadUsageCsv(visibleUsage, `kova-api-usage-page-${usagePage + 1}.csv`)
                }
              >
                Export current page
              </Button>
              <Button
                variant="outline"
                disabled={!dateFilter || !endDateFilter || dateFilter > endDateFilter || exportBusy}
                onClick={() => void exportRange()}
              >
                {exportBusy ? "Exporting…" : "Export date range"}
              </Button>
            </div>
            {exportError && (
              <p role="alert" className="text-sm text-destructive">
                {exportError}
              </p>
            )}
            {(section === "usage" || section === "costs") && (
              <section className="min-w-0 space-y-3 rounded-lg border border-border p-3 sm:p-4">
                <h2 className="font-semibold">Date-range analytics</h2>
                <p className="text-xs text-muted-foreground">
                  Choose dates (up to 93 days and 5,000 matching records). This is an observed usage
                  summary, not a financial ledger statement.
                </p>
                <Button
                  disabled={
                    !dateFilter || !endDateFilter || summaryBusy || dateFilter > endDateFilter
                  }
                  onClick={() => void loadSummary()}
                >
                  {summaryBusy ? "Calculating…" : "Calculate date-range analytics"}
                </Button>
                {summaryError && (
                  <p role="alert" className="text-sm text-destructive">
                    {summaryError}
                  </p>
                )}
                {currentSummary && (
                  <div className="min-w-0 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Read as of {new Date(currentSummary.readAt).toLocaleString()}
                    </p>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                      <div className="min-w-0 rounded-[var(--kova-radius-card)] bg-muted/40 p-4">
                        <p className="text-xs text-muted-foreground">Matching requests</p>
                        <p className="text-2xl font-semibold tabular-nums">
                          {currentSummary.data.requests.toLocaleString()}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-[var(--kova-radius-card)] bg-muted/40 p-4">
                        <p className="text-xs text-muted-foreground">
                          Recorded final charges (minor units)
                        </p>
                        {currentSummary.data.charges.map((row) => (
                          <p key={row.currency} className="font-semibold tabular-nums">
                            {row.amount} {row.currency}
                          </p>
                        ))}
                        {!currentSummary.data.charges.length && <p>—</p>}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {currentSummary.data.measuredRequests.toLocaleString()} requests with measured
                      tokens
                    </p>
                    {(["days", "models", "services", "statuses"] as const).map((group) => {
                      const rows = currentSummary.data[group];
                      const max = Math.max(1, ...rows.map((row) => row.requests));
                      return (
                        <section
                          key={group}
                          className="min-w-0 space-y-2 rounded-lg border border-border p-3"
                        >
                          <h3 className="text-sm font-medium capitalize">{group}</h3>
                          <div className="max-h-72 space-y-2 overflow-auto">
                            {rows.map((row) => (
                              <div
                                key={row.label}
                                className="grid min-w-0 gap-1 border-b border-border/40 pb-2 text-xs last:border-0"
                              >
                                <div className="flex min-w-0 flex-wrap justify-between gap-1">
                                  <span className="min-w-0 break-all">{row.label}</span>
                                  <span className="tabular-nums">
                                    {row.requests.toLocaleString()} requests
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-foreground/70"
                                    style={{ width: `${(row.requests / max) * 100}%` }}
                                  />
                                </div>
                                <p className="text-muted-foreground">
                                  {row.measuredRequests
                                    ? `${Object.values(row.tokens)
                                        .reduce((sum, value) => sum + value, 0)
                                        .toLocaleString()} measured tokens`
                                    : "No measured tokens"}
                                  {row.charges.length
                                    ? ` · ${row.charges.map((charge) => `${charge.amount} ${charge.currency} minor units`).join(" · ")}`
                                    : ""}
                                </p>
                              </div>
                            ))}
                            {!rows.length && (
                              <p className="text-xs text-muted-foreground">No matching requests.</p>
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
            {(section === "usage" || section === "costs") && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Requests on this page</p>
                  <p className="text-2xl font-semibold tracking-tight sm:text-3xl">{usageReady ? visibleUsage.length : "—"}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Recorded final charges (minor units)
                  </p>
                  {settledByCurrency.size ? (
                    [...settledByCurrency].map(([currency, amount]) => (
                      <p key={currency} className="text-xl font-semibold tabular-nums">
                        {amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {currency}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No final charges in this view.</p>
                  )}
                </div>
              </div>
            )}
            {section === "usage" && usageReady && (
              <section className="min-w-0 space-y-3 rounded-lg border border-border p-3">
                <h2 className="text-sm font-medium">Recorded token usage (current page)</h2>
                <p className="text-xs text-muted-foreground">
                  {measuredRequests} of {visibleUsage.length} requests have authoritative token
                  measurements. Cached tokens are separated from uncached input tokens.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["Uncached input", "input_tokens"],
                      ["Cached input", "cached_input_tokens"],
                      ["Image input", "image_input_tokens"],
                      ["Output", "output_tokens"],
                    ] as const
                  ).map(([label, field]) => (
                    <div key={field} className="min-w-0 rounded-md bg-muted/40 p-2.5">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">
                        {measuredRequests ? tokenTotals[field].toLocaleString() : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {section === "usage" && usageReady && activity.length > 0 && (
              <section
                className="min-w-0 rounded-lg border border-border p-3"
                aria-label="Requests by UTC day, current page"
              >
                <h2 className="text-sm font-medium">Requests by day (current page)</h2>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                  {activity.map(([day, count]) => (
                    <div
                      key={day}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-xs"
                    >
                      <span className="tabular-nums">{day}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground/70"
                          style={{ width: `${(count / peak) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {!usageReady && !error && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading usage…
              </p>
            )}
            {usageReady && !visibleUsage.length && (
              <p className="text-sm text-muted-foreground">No matching API calls on this page.</p>
            )}
            <div className="grid gap-2 md:hidden" aria-label="Mobile request history">
              {visibleUsage.map((row) => (
                <article
                  key={String(row.id)}
                  className="min-w-0 space-y-2 rounded-lg border border-border p-3"
                >
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 break-all text-sm font-medium">{row.public_model}</p>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs">
                      {row.settlement_state}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.capability} · {row.created_at}
                  </p>
                  <p className="text-sm tabular-nums">
                    {row.final_customer_charge ?? `Held: ${row.maximum_reserved_charge}`}{" "}
                    {row.currency} minor units
                  </p>
                </article>
              ))}
            </div>
            <div className="hidden max-w-full min-w-0 overflow-x-auto md:block">
              <table className="w-full min-w-[520px] text-left text-sm">
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
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={usagePage === 0 || !usageReady}
                onClick={() => setUsagePage((page) => Math.max(0, page - 1))}
              >
                Previous
              </Button>
              <span className="text-sm">Page {usagePage + 1}</span>
              <Button
                variant="outline"
                disabled={!usageReady || !data?.usageHasMore || usagePage >= 10000}
                onClick={() => setUsagePage((page) => page + 1)}
              >
                Next
              </Button>
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
