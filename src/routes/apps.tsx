import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import {
  CONNECTOR_CATALOG,
  GOOGLE_CONNECT_IDS,
  type ConnectorItem,
} from "@/lib/connectors-catalog";
import {
  Search,
  Check,
  Loader2,
  Sparkles,
  ShieldAlert,
  PanelsTopLeft,
  AlertCircle,
  X,
  LogIn,
  Github,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  getGitHubManagement,
  refreshGitHubInstallations,
  updateGitHubRepositoryGrants,
  disconnectGitHub,
  type GitHubManagement,
} from "@/lib/github.functions";
import { authFetch } from "@/lib/auth-fetch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import {
  getGoogleStatus,
  startGoogleConnect,
  disconnectGoogleAccount,
  type GoogleStatus,
} from "@/lib/google-client";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
  writePrincipalHandoff,
} from "@/lib/principal-browser-storage.mjs";

// The catalog owns which ids the Google grant actually covers.
const GOOGLE_IDS = GOOGLE_CONNECT_IDS;

// Apps that are actually wired up end-to-end today. Non-working connectors are
// intentionally hidden so navigation never exposes fake or decorative controls.
const WORKING_IDS = new Set<string>([
  "google",
  "gmail",
  "google-drive",
  "google-calendar",
  "github",
]);

const CONFIGURED_CONNECTORS = WORKING_IDS;

const RECOMMENDED_IDS = new Set([
  "google",
  "gmail",
  "google-drive",
  "google-calendar",
  "icloud-mail",
  "ms-word",
  "youtube",
  "apple",
]);

export const Route = createFileRoute("/apps")({
  component: AppsPage,
  head: () => ({
    meta: [
      { title: "KovaGPT Apps & Plugins" },
      {
        name: "description",
        content: "Connect KovaGPT to supported Google, Drive, Gmail, and Calendar services.",
      },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/apps" }],
  }),
});

type ConnState =
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "expired"
  | "reauthorize"
  | "permission_incomplete"
  | "syncing"
  | "temporarily_unavailable";

function AppLogo({ domain, label }: { domain: string; label: string }) {
  // Locally rendered brand mark using the domain's own favicon as a fallback.
  // Avoids Logo.dev entirely.
  const [failed, setFailed] = useState(false);
  const src = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
  if (!failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-10 h-10 rounded-lg object-contain bg-white border border-border shrink-0 p-1.5"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 text-xs font-semibold text-muted-foreground border border-border">
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

function StatusBadge({ state, configured }: { state: ConnState; configured: boolean }) {
  if (!configured) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <ShieldAlert className="w-3 h-3" /> Setup needed
      </span>
    );
  }
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <Check className="w-3 h-3" /> Connected
      </span>
    );
  }
  if (state === "connecting") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
        <Loader2 className="w-3 h-3 animate-spin" /> Connecting
      </span>
    );
  }

  if (state === "expired" || state === "reauthorize") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20"
        aria-label="Reauthorization required"
      >
        <ShieldAlert className="w-3 h-3" /> Reconnect
      </span>
    );
  }
  if (state === "permission_incomplete") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20"
        aria-label="Permission incomplete"
      >
        <ShieldAlert className="w-3 h-3" /> More access needed
      </span>
    );
  }
  if (state === "syncing") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20"
        aria-live="polite"
      >
        <Loader2 className="w-3 h-3 animate-spin" /> Syncing
      </span>
    );
  }
  if (state === "temporarily_unavailable") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
        aria-label="Temporarily unavailable"
      >
        <AlertCircle className="w-3 h-3" /> Temporarily unavailable
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
        <AlertCircle className="w-3 h-3" /> Failed
      </span>
    );
  }
  return null;
}

function AppCard({
  item,
  state,
  configured,
  isSignedIn,
  onConnect,
  onDisconnect,
  onRetry,
  onDetails,
  onUseInChat,
}: {
  item: ConnectorItem;
  state: ConnState;
  configured: boolean;
  isSignedIn: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  onDetails: () => void;
  onUseInChat: () => void;
}) {
  const baseBtn =
    "inline-flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-medium transition-colors shrink-0";

  let action: React.ReactNode;
  if (!configured) {
    action = (
      <button
        disabled
        title="This connector needs provider credentials before it can be linked."
        className={`${baseBtn} border border-border text-muted-foreground cursor-not-allowed opacity-70`}
      >
        Setup required
      </button>
    );
  } else if (!isSignedIn) {
    action = (
      <SignInButton mode="modal">
        <button className={`${baseBtn} bg-[#3b82f6] text-white hover:bg-[#2563eb]`}>Connect</button>
      </SignInButton>
    );
  } else if (state === "connecting") {
    action = (
      <button
        disabled
        className={`${baseBtn} bg-muted text-muted-foreground inline-flex items-center gap-1.5`}
      >
        <Loader2 className="w-3 h-3 animate-spin" /> Connecting
      </button>
    );
  } else if (state === "failed") {
    action = (
      <button
        onClick={onRetry}
        className={`${baseBtn} border border-rose-500/30 text-rose-300 hover:bg-rose-500/10`}
      >
        Try again
      </button>
    );
  } else if (state === "connected") {
    action = (
      <button
        onClick={onDisconnect}
        className={`${baseBtn} border border-border text-foreground/80 hover:bg-accent inline-flex items-center gap-1`}
        title="Manage connection"
      >
        <X className="w-3 h-3" /> Disconnect
      </button>
    );
  } else {
    action = (
      <button
        onClick={onConnect}
        className={`${baseBtn} bg-[#3b82f6] text-white hover:bg-[#2563eb]`}
      >
        Connect
      </button>
    );
  }

  return (
    <li className="kova-card kova-connector-card flex h-full flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-foreground/20 sm:flex-row">
      <AppLogo domain={item.domain} label={item.label} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold truncate">{item.label}</div>
          <StatusBadge state={state} configured={configured} />
        </div>
        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.description}</div>
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center gap-1 sm:w-auto sm:flex-col sm:items-end">
        {action}
        <button
          onClick={onDetails}
          className="inline-flex min-h-11 items-center px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Details
        </button>
        {state === "connected" && (
          <button
            onClick={onUseInChat}
            className="inline-flex min-h-11 items-center px-2 text-xs font-medium hover:underline"
          >
            Use in chat
          </button>
        )}
      </div>
    </li>
  );
}

function GitHubManager() {
  const load = useServerFn(getGitHubManagement),
    refresh = useServerFn(refreshGitHubInstallations),
    grants = useServerFn(updateGitHubRepositoryGrants),
    disconnect = useServerFn(disconnectGitHub);
  const [data, setData] = useState<GitHubManagement | null>(null),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number[]>([]);
  const [loadError, setLoadError] = useState(false);
  const reload = useCallback(() => {
    setLoadError(false);
    return load()
      .then(setData)
      .catch(() => {
        setLoadError(true);
        toast.error("GitHub status unavailable");
      });
  }, [load]);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!data && loadError)
    return (
      <section role="alert" className="rounded-xl border border-destructive/40 p-5">
        <h2 className="font-medium">GitHub connection status is unavailable</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your connection was not changed. Try loading its status again.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void reload()}>
          Try again
        </Button>
      </section>
    );
  if (!data)
    return (
      <div
        className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
        role="status"
        aria-label="Loading GitHub"
      />
    );
  const repos = data.repositories.filter((repo) => repo.full_name.includes(search.toLowerCase()));
  async function connect() {
    const response = await authFetch("/api/github/auth");
    const result = await response.json();
    if (result.url) location.assign(result.url);
    else toast.error(result.error ?? "GitHub is unavailable");
  }
  async function update(granted: boolean) {
    if (!granted) {
      setRevokeOpen(true);
      return;
    }
    await applyGrantUpdate(true);
  }
  async function applyGrantUpdate(granted: boolean) {
    setBusy(true);
    try {
      await grants({
        data: {
          repositoryIds: selected,
          granted,
          confirmed: true,
        },
      });
      setSelected([]);
      await reload();
    } catch {
      toast.error("Repository access could not be updated");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="kova-card p-5" aria-labelledby="github-manager">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <Github className="h-9 w-9" />
          <div>
            <h2 id="github-manager" className="font-semibold">
              GitHub
            </h2>
            <p className="text-sm text-muted-foreground">
              {data.configured ? data.health.replaceAll("_", " ") : "Credentials not configured"}
            </p>
          </div>
        </div>
        {!data.configured ? (
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs">
            Operator setup required
          </span>
        ) : !data.accounts.length ? (
          <button
            className="min-h-11 rounded-full bg-foreground px-4 text-sm text-background"
            onClick={() => void connect()}
          >
            Connect GitHub
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              className="min-h-11 rounded-full border px-3 text-sm"
              onClick={() => void refresh().then(reload)}
            >
              Refresh installations
            </button>
            <button
              className="min-h-11 rounded-full border px-3 text-sm text-destructive"
              onClick={() => setDisconnectOpen(true)}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
      {data.accounts.map((account) => (
        <div
          key={account.id}
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 p-3"
        >
          {account.avatar_url && (
            <img src={account.avatar_url} alt="" className="h-10 w-10 rounded-full" />
          )}
          <div>
            <p className="font-medium">@{account.login}</p>
            <p className="text-xs text-muted-foreground">
              {account.auth_type} · {account.status} · ID {account.github_user_id}
            </p>
          </div>
          <div className="ml-auto text-right text-xs text-muted-foreground">
            <p>
              Rate limit {account.rate_remaining ?? "—"} / {account.rate_limit ?? "—"}
            </p>
            <p>
              Health{" "}
              {account.last_health_at
                ? new Date(account.last_health_at).toLocaleString()
                : "not checked"}
            </p>
          </div>
        </div>
      ))}
      <ConfirmActionDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Remove repository access?"
        description="Coding Agents will immediately lose access to the selected repositories."
        confirmLabel="Remove access"
        destructive
        onConfirm={() => {
          setRevokeOpen(false);
          void applyGrantUpdate(false);
        }}
      />
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect GitHub?</DialogTitle>
            <DialogDescription>
              Repository access will be revoked. Choose whether synchronized metadata should also be
              removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDisconnectOpen(false);
                void disconnect({
                  data: { accountId: data.accounts[0].id, removeData: false },
                }).then(reload);
              }}
            >
              Disconnect only
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDisconnectOpen(false);
                void disconnect({
                  data: { accountId: data.accounts[0].id, removeData: true },
                }).then(reload);
              }}
            >
              Disconnect and remove data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {data.installations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium">Installations</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.installations.map((item) => (
              <span key={item.id} className="rounded-full border px-3 py-1 text-xs">
                {item.organization_login ?? "Personal"} · {item.repository_selection}
                {item.suspended_at ? " · suspended" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      {data.repositories.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="min-h-11 flex-1 rounded-xl border px-3"
              placeholder="Search GitHub repositories"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              disabled={!selected.length || busy}
              onClick={() => void update(true)}
              className="min-h-11 rounded-full border px-3 text-sm"
            >
              Grant selected
            </button>
            <button
              disabled={!selected.length || busy}
              onClick={() => void update(false)}
              className="min-h-11 rounded-full border px-3 text-sm text-destructive"
            >
              Remove selected
            </button>
          </div>
          <ul className="mt-3 max-h-80 divide-y overflow-y-auto rounded-xl border">
            {repos.map((repo) => (
              <li key={repo.id} className="flex min-h-12 items-center gap-3 p-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${repo.full_name}`}
                  checked={selected.includes(repo.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(repo.id)
                        ? current.filter((id) => id !== repo.id)
                        : [...current, repo.id],
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{repo.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {repo.visibility} · {repo.default_branch} ·{" "}
                    {repo.archived ? "archived" : "active"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${repo.explicitly_granted ? "bg-emerald-500/10 text-emerald-600" : "bg-muted"}`}
                >
                  {repo.explicitly_granted ? "Granted" : "Available"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function AppsPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? browserStoragePrincipal(userKey) : null;
  const activityKey = isLoaded ? principalScopedStorageKey("kova-app-activity", userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const generationRef = useRef(0);
  const [lifecycleVersion, setLifecycleVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState<Record<string, true>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<ConnectorItem | null>(null);
  const [activity, setActivity] = useState<{ app: string; action: string; at: string }[]>([]);
  const [activityPrincipal, setActivityPrincipal] = useState<string | null>(null);
  const activityReady = principal !== null && activityPrincipal === principal;
  const visibleActivity = activityReady ? activity : [];
  const visibleGoogleStatus = activityReady ? googleStatus : null;
  const visibleGoogleLoading = activityReady ? googleLoading : true;
  const visibleSelectedApp = activityReady ? selectedApp : null;

  useEffect(() => {
    generationRef.current += 1;
    setQuery("");
    setActivity([]);
    setActivityPrincipal(null);
    setGoogleStatus(null);
    setGoogleLoading(true);
    setSelectedApp(null);
    setConnecting({});
    setFailed({});
    if (!principal || !activityKey) return;
    try {
      setActivity(JSON.parse(safeBrowserStorage("localStorage")?.getItem(activityKey) ?? "[]"));
    } catch {
      setActivity([]);
    }
    setActivityPrincipal(principal);
  }, [activityKey, principal]);

  useEffect(() => {
    if (!isLoaded || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      generationRef.current += 1;
      setActivity([]);
      setActivityPrincipal(principal);
      setGoogleStatus(null);
      setGoogleLoading(true);
      setSelectedApp(null);
      setConnecting({});
      setFailed({});
      setQuery("");
      setLifecycleVersion((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);

  const recordActivity = useCallback(
    (app: string, action: string) => {
      if (!activityReady || !activityKey) return;
      setActivity((current) => {
        const next = [{ app, action, at: new Date().toISOString() }, ...current].slice(0, 50);
        safeBrowserStorage("localStorage")?.setItem(activityKey, JSON.stringify(next));
        return next;
      });
    },
    [activityKey, activityReady],
  );

  const refreshGoogle = useCallback(async () => {
    if (!isLoaded || !principal) return;
    const generation = generationRef.current;
    const requestPrincipal = principal;
    try {
      const s = await getGoogleStatus();
      if (generation !== generationRef.current || principalRef.current !== requestPrincipal) return;
      setGoogleStatus(s);
    } catch {
      if (generation !== generationRef.current || principalRef.current !== requestPrincipal) return;
      setGoogleStatus({ connected: false, state: "temporarily_unavailable" });
    } finally {
      if (generation === generationRef.current && principalRef.current === requestPrincipal) {
        setGoogleLoading(false);
      }
    }
  }, [isLoaded, principal]);

  useEffect(() => {
    if (!isSignedIn) {
      setGoogleLoading(false);
      setGoogleStatus({ connected: false, state: "disconnected" });
      return;
    }
    refreshGoogle();
  }, [isSignedIn, lifecycleVersion, refreshGoogle]);

  // Handle OAuth return params (?google_connected=1 or ?google_error=...)
  useEffect(() => {
    if (typeof window === "undefined" || !activityReady || !isSignedIn) return;
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("google_connected");
    const err = params.get("google_error");
    if (ok) {
      toast.success("Google account connected");
      recordActivity("Google", "Connected");
      refreshGoogle();
    } else if (err) {
      const msg =
        err === "access_denied"
          ? "Authentication canceled"
          : err === "invalid_state"
            ? "Session expired, try again"
            : err === "exchange_failed"
              ? "Google sign-in failed, try again"
              : "Google sign-in could not be completed";
      toast.error(msg);
    }
    if (ok || err) {
      params.delete("google_connected");
      params.delete("google_error");
      const url = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", url);
    }
  }, [activityReady, isSignedIn, recordActivity, refreshGoogle]);

  const isGoogleId = (id: string) => GOOGLE_IDS.has(id);

  const handleConnect = async (item: ConnectorItem) => {
    if (!activityReady || !principal) return;
    const generation = generationRef.current;
    const requestPrincipal = principal;
    if (isGoogleId(item.id)) {
      setConnecting((c) => ({ ...c, [item.id]: true }));
      try {
        await startGoogleConnect();
      } catch (e) {
        if (generation !== generationRef.current || principalRef.current !== requestPrincipal)
          return;
        setConnecting((c) => {
          const n = { ...c };
          delete n[item.id];
          return n;
        });
        setFailed((f) => ({ ...f, [item.id]: true }));
        toast.error(e instanceof Error ? e.message : "Could not start Google connection");
      }
      return;
    }
    toast.error(`${item.label} is not available in this deployment.`);
  };

  const handleDisconnect = async (item: ConnectorItem) => {
    if (!activityReady || !principal) return;
    const generation = generationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === generationRef.current && principalRef.current === requestPrincipal;
    if (isGoogleId(item.id)) {
      try {
        await disconnectGoogleAccount();
        if (!isCurrent()) return;
        setGoogleStatus({ connected: false, state: "disconnected" });
        recordActivity(item.label, "Disconnected");
        toast("Google account disconnected");
      } catch {
        if (isCurrent()) toast.error("Could not disconnect Google. Try again.");
      }
      return;
    }
    toast.error(`${item.label} is not available in this deployment.`);
  };

  const isGoogleConnected = (id: string): boolean => {
    if (!visibleGoogleStatus?.connected) return false;
    if (id === "google") return true;
    if (id === "gmail") return !!visibleGoogleStatus.has?.gmail;
    if (id === "google-calendar") return !!visibleGoogleStatus.has?.calendar;
    if (id === "google-drive") return !!visibleGoogleStatus.has?.drive;
    return false;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONNECTOR_CATALOG.filter((c) => WORKING_IDS.has(c.id) && c.id !== "github").filter(
      (c) => {
        if (!q) return true;
        return (
          c.label.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
        );
      },
    );
  }, [query]);

  const isConnected = (id: string) => isGoogleId(id) && isGoogleConnected(id);
  const connectedList = filtered.filter((c) => isConnected(c.id));
  const recommendedList = filtered.filter((c) => !isConnected(c.id) && RECOMMENDED_IDS.has(c.id));

  const stateOf = (id: string): ConnState => {
    if (!isSignedIn) return "idle";
    if (isGoogleId(id)) {
      if (visibleGoogleLoading) return "syncing";
      if (activityReady && connecting[id]) return "connecting";
      if (activityReady && failed[id]) return "failed";
      if (visibleGoogleStatus?.state === "temporarily_unavailable")
        return "temporarily_unavailable";
      if (visibleGoogleStatus?.state === "reauthorization_required") return "reauthorize";
      if (isGoogleConnected(id)) return "connected";
      if (visibleGoogleStatus?.connected) return "permission_incomplete";
      return "idle";
    }
    return "temporarily_unavailable";
  };

  const renderGrid = (items: ConnectorItem[]) => (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-fr">
      {items.map((item) => (
        <AppCard
          key={item.id}
          item={item}
          state={stateOf(item.id)}
          configured={CONFIGURED_CONNECTORS.has(item.id)}
          isSignedIn={!!isSignedIn}
          onConnect={() => handleConnect(item)}
          onDisconnect={() => handleDisconnect(item)}
          onRetry={() => handleConnect(item)}
          onDetails={() => setSelectedApp(item)}
          onUseInChat={() => {
            const handoff = writePrincipalHandoff(
              safeBrowserStorage("sessionStorage"),
              "kova-app-chat-context",
              isLoaded ? userKey : undefined,
              `Use my connected ${item.label} account for this request when relevant: `,
            );
            if (!handoff.ok) {
              toast.error("App context could not be prepared. Reload and try again.");
              return;
            }
            window.location.href = "/";
          }}
        />
      ))}
    </ul>
  );

  const Section = ({
    title,
    subtitle,
    icon,
    items,
  }: {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    items: ConnectorItem[];
  }) => {
    if (items.length === 0) return null;
    return (
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold tracking-wide inline-flex items-center gap-1.5">
              {icon}
              {title}
            </h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {renderGrid(items)}
      </section>
    );
  };

  return (
    <AppShell>
      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="apps-title"
        className="kova-page kova-secondary-page max-w-5xl space-y-8"
      >
        <Dialog open={!!visibleSelectedApp} onOpenChange={(open) => !open && setSelectedApp(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{visibleSelectedApp?.label}</DialogTitle>
              <DialogDescription>{visibleSelectedApp?.description}</DialogDescription>
            </DialogHeader>
            {visibleSelectedApp && (
              <div className="space-y-4 text-sm">
                <section className="rounded-xl border p-3">
                  <h3 className="font-medium">Capabilities and permissions</h3>
                  <p className="mt-1 text-muted-foreground">
                    {visibleSelectedApp.id === "gmail"
                      ? "Read message context. Sending email always requires explicit confirmation."
                      : visibleSelectedApp.id === "google-calendar"
                        ? "Read calendars and propose events. Creating an event requires explicit confirmation."
                        : visibleSelectedApp.id === "google-drive"
                          ? "Search and read files covered by the Drive scopes you granted."
                          : "Manage the Google connection shared by supported Google apps."}
                  </p>
                  {isGoogleId(visibleSelectedApp.id) && visibleGoogleStatus?.email ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Connected as {visibleGoogleStatus.email}. Only permissions granted by Google
                      are available in chat.
                    </p>
                  ) : null}
                  {isGoogleId(visibleSelectedApp.id) &&
                  visibleGoogleStatus?.state === "reauthorization_required" ? (
                    <button
                      type="button"
                      className="mt-3 min-h-11 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
                      onClick={() => void handleConnect(visibleSelectedApp)}
                    >
                      Reconnect Google
                    </button>
                  ) : null}
                </section>
                <section>
                  <h3 className="font-medium">Recent activity</h3>
                  {visibleActivity.filter((entry) =>
                    [visibleSelectedApp.label, "Google"].includes(entry.app),
                  ).length ? (
                    <ul className="mt-2 space-y-2">
                      {visibleActivity
                        .filter((entry) => [visibleSelectedApp.label, "Google"].includes(entry.app))
                        .slice(0, 5)
                        .map((entry, index) => (
                          <li key={`${entry.at}:${index}`} className="rounded-lg bg-muted/60 p-2">
                            {entry.action} · {new Date(entry.at).toLocaleString()}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted-foreground">No recorded connection activity.</p>
                  )}
                </section>
              </div>
            )}
          </DialogContent>
        </Dialog>
        <WorkspacePageHeader
          icon={PanelsTopLeft}
          title="Apps & plugins"
          titleId="apps-title"
          description="Connect the services you want KovaGPT to use. You control permissions, and write actions still require confirmation."
        />
        {!isLoaded ? (
          <section role="status" aria-labelledby="apps-loading-title" className="space-y-3">
            <h2 id="apps-loading-title" className="sr-only">
              Loading apps and plugins
            </h2>
            <div
              aria-hidden="true"
              className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
            />
          </section>
        ) : !isSignedIn ? (
          <section
            className="kova-empty-state mx-auto max-w-2xl"
            aria-labelledby="apps-sign-in-title"
          >
            <LogIn className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 id="apps-sign-in-title" className="mt-3 text-xl font-semibold">
              Sign in to connect services
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Connect Google, Gmail, Drive, Calendar, and GitHub to use authorized context across
              your workspace.
            </p>
            <SignInButton mode="modal">
              <Button className="mt-5 min-h-11">Sign in</Button>
            </SignInButton>
          </section>
        ) : (
          <>
            <label className="relative block max-w-md">
              <span className="sr-only">Search apps and plugins</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search apps and plugins"
                className="h-11 pl-9"
              />
            </label>

            <GitHubManager />

            {filtered.length === 0 ? (
              <section className="kova-empty-state" aria-labelledby="apps-empty-title">
                <Search className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <h2 id="apps-empty-title" className="mt-3 text-sm font-medium">
                  No matching apps or plugins
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">Try another service name.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 min-h-11"
                  onClick={() => setQuery("")}
                >
                  Clear search
                </Button>
              </section>
            ) : (
              <>
                <Section
                  title="Connected"
                  subtitle="Ready to use in chat."
                  icon={<Check className="h-3.5 w-3.5 text-emerald-400/90" aria-hidden="true" />}
                  items={connectedList}
                />
                <Section
                  title="Available connections"
                  subtitle="Connect only the access you want to use."
                  icon={<Sparkles className="h-3.5 w-3.5 text-foreground/70" aria-hidden="true" />}
                  items={recommendedList}
                />
              </>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
