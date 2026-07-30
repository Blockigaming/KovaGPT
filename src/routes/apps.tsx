import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import {
  CONNECTOR_CATALOG,
  type ConnectorItem,
  type ConnectorCategory,
} from "@/lib/connectors-catalog";
import {
  Link2,
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
import { toast } from "sonner";
import {
  getGoogleStatus,
  startGoogleConnect,
  disconnectGoogleAccount,
  type GoogleStatus,
} from "@/lib/google-client";

const GOOGLE_IDS = new Set(["google", "gmail", "google-drive", "google-calendar"]);

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

const FILTER_CATEGORIES: (ConnectorCategory | "All")[] = [
  "All",
  "Productivity",
  "Email",
  "Storage & Files",
  "Calendar",
  "Notes & Docs",
  "Communication",
  "Education",
  "Social & Media",
  "Development",
];

export const Route = createFileRoute("/apps")({
  component: AppsPage,
  head: () => ({
    meta: [
      { title: "Apps | KovaGPT" },
      {
        name: "description",
        content: "Connect KovaGPT to supported Google, Drive, Gmail, and Calendar services.",
      },
      { name: "robots", content: "noindex" },
    ],
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
    "text-xs px-3 py-1.5 rounded-full transition active:scale-[0.97] shrink-0 font-medium";

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
    <li className="kova-card kova-connector-card rounded-xl border border-border bg-card p-4 flex items-start gap-3 hover:border-foreground/20 transition h-full">
      <AppLogo domain={item.domain} label={item.label} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold truncate">{item.label}</div>
          <StatusBadge state={state} configured={configured} />
        </div>
        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.description}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {action}
        <button onClick={onDetails} className="text-xs text-muted-foreground hover:text-foreground">
          Details
        </button>
        {state === "connected" && (
          <button onClick={onUseInChat} className="text-xs font-medium hover:underline">
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
  const reload = useCallback(
    () =>
      load()
        .then(setData)
        .catch(() => toast.error("GitHub status unavailable")),
    [load],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!data)
    return (
      <div
        className="h-28 animate-pulse rounded-2xl bg-muted"
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
    setBusy(true);
    try {
      await grants({
        data: {
          repositoryIds: selected,
          granted,
          confirmed:
            granted ||
            confirm("Remove selected GitHub repositories? Coding Agents will lose access."),
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
            className="rounded-full bg-foreground px-4 py-2 text-sm text-background"
            onClick={() => void connect()}
          >
            Connect GitHub
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              className="rounded-full border px-3 py-2 text-sm"
              onClick={() => void refresh().then(reload)}
            >
              Refresh installations
            </button>
            <button
              className="rounded-full border px-3 py-2 text-sm text-destructive"
              onClick={() =>
                void disconnect({
                  data: {
                    accountId: data.accounts[0].id,
                    removeData: confirm("Also remove synchronized GitHub metadata?"),
                  },
                }).then(reload)
              }
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
              className="min-h-10 flex-1 rounded-xl border px-3"
              placeholder="Search GitHub repositories"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              disabled={!selected.length || busy}
              onClick={() => void update(true)}
              className="rounded-full border px-3 text-sm"
            >
              Grant selected
            </button>
            <button
              disabled={!selected.length || busy}
              onClick={() => void update(false)}
              className="rounded-full border px-3 text-sm text-destructive"
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
  const { isSignedIn } = useUser();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConnectorCategory | "All">("All");
  const [connecting, setConnecting] = useState<Record<string, true>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<ConnectorItem | null>(null);
  const [activity, setActivity] = useState<{ app: string; action: string; at: string }[]>([]);

  useEffect(() => {
    try {
      setActivity(JSON.parse(localStorage.getItem("kova-app-activity-v1") ?? "[]"));
    } catch {
      setActivity([]);
    }
  }, []);

  const recordActivity = (app: string, action: string) => {
    setActivity((current) => {
      const next = [{ app, action, at: new Date().toISOString() }, ...current].slice(0, 50);
      localStorage.setItem("kova-app-activity-v1", JSON.stringify(next));
      return next;
    });
  };

  const refreshGoogle = useCallback(async () => {
    try {
      const s = await getGoogleStatus();
      setGoogleStatus(s);
    } catch {
      setGoogleStatus({ connected: false, state: "temporarily_unavailable" });
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setGoogleLoading(false);
      setGoogleStatus({ connected: false, state: "disconnected" });
      return;
    }
    refreshGoogle();
  }, [isSignedIn, refreshGoogle]);

  // Handle OAuth return params (?google_connected=1 or ?google_error=...)
  useEffect(() => {
    if (typeof window === "undefined") return;
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
              : `Google error: ${err}`;
      toast.error(msg);
    }
    if (ok || err) {
      params.delete("google_connected");
      params.delete("google_error");
      const url = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", url);
    }
  }, [refreshGoogle]);

  const isGoogleId = (id: string) => GOOGLE_IDS.has(id);

  const handleConnect = async (item: ConnectorItem) => {
    if (isGoogleId(item.id)) {
      setConnecting((c) => ({ ...c, [item.id]: true }));
      try {
        await startGoogleConnect();
      } catch (e) {
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
    if (isGoogleId(item.id)) {
      try {
        await disconnectGoogleAccount();
        setGoogleStatus({ connected: false, state: "disconnected" });
        recordActivity(item.label, "Disconnected");
        toast("Google account disconnected");
      } catch {
        toast.error("Could not disconnect Google. Try again.");
      }
      return;
    }
    toast.error(`${item.label} is not available in this deployment.`);
  };

  const isGoogleConnected = (id: string): boolean => {
    if (!googleStatus?.connected) return false;
    if (id === "google") return true;
    if (id === "gmail") return !!googleStatus.has?.gmail;
    if (id === "google-calendar") return !!googleStatus.has?.calendar;
    if (id === "google-drive") return !!googleStatus.has?.drive;
    return false;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONNECTOR_CATALOG.filter((c) => WORKING_IDS.has(c.id) && c.id !== "github").filter(
      (c) => {
        if (category !== "All" && c.category !== category) return false;
        if (!q) return true;
        return (
          c.label.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
        );
      },
    );
  }, [query, category]);

  const isConnected = (id: string) => isGoogleId(id) && isGoogleConnected(id);
  const connectedList = filtered.filter((c) => isConnected(c.id));
  const recommendedList = filtered.filter((c) => !isConnected(c.id) && RECOMMENDED_IDS.has(c.id));
  const otherList = filtered.filter((c) => !isConnected(c.id) && !RECOMMENDED_IDS.has(c.id));

  const stateOf = (id: string): ConnState => {
    if (!isSignedIn) return "idle";
    if (isGoogleId(id)) {
      if (googleLoading) return "syncing";
      if (connecting[id]) return "connecting";
      if (failed[id]) return "failed";
      if (googleStatus?.state === "temporarily_unavailable") return "temporarily_unavailable";
      if (googleStatus?.state === "reauthorization_required") return "reauthorize";
      if (isGoogleConnected(id)) return "connected";
      if (googleStatus?.connected) return "permission_incomplete";
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
            sessionStorage.setItem(
              "kova-app-chat-context",
              `Use my connected ${item.label} account for this request when relevant: `,
            );
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

  const showAllApps = query.trim().length > 0 || category !== "All";

  return (
    <AppShell>
      <main className="kova-page kova-secondary-page max-w-5xl space-y-8">
        <Dialog open={!!selectedApp} onOpenChange={(open) => !open && setSelectedApp(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedApp?.label}</DialogTitle>
              <DialogDescription>{selectedApp?.description}</DialogDescription>
            </DialogHeader>
            {selectedApp && (
              <div className="space-y-4 text-sm">
                <section className="rounded-xl border p-3">
                  <h3 className="font-medium">Capabilities and permissions</h3>
                  <p className="mt-1 text-muted-foreground">
                    {selectedApp.id === "gmail"
                      ? "Read message context. Sending email always requires explicit confirmation."
                      : selectedApp.id === "google-calendar"
                        ? "Read calendars and propose events. Creating an event requires explicit confirmation."
                        : selectedApp.id === "google-drive"
                          ? "Search and read files covered by the Drive scopes you granted."
                          : "Manage the Google connection shared by supported Google apps."}
                  </p>
                  {isGoogleId(selectedApp.id) && googleStatus?.email ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Connected as {googleStatus.email}. Only permissions granted by Google are
                      available in chat.
                    </p>
                  ) : null}
                  {isGoogleId(selectedApp.id) &&
                  googleStatus?.state === "reauthorization_required" ? (
                    <button
                      type="button"
                      className="mt-3 min-h-11 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
                      onClick={() => void handleConnect(selectedApp)}
                    >
                      Reconnect Google
                    </button>
                  ) : null}
                </section>
                <section>
                  <h3 className="font-medium">Recent activity</h3>
                  {activity.filter((entry) => [selectedApp.label, "Google"].includes(entry.app))
                    .length ? (
                    <ul className="mt-2 space-y-2">
                      {activity
                        .filter((entry) => [selectedApp.label, "Google"].includes(entry.app))
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
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-500 text-white shadow-sm">
              <PanelsTopLeft className="h-4 w-4" />
            </span>
            Apps
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Your KovaGPT workspace</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Link Google once to enable Gmail, Calendar, and Drive capabilities according to the
            scopes you grant. KovaGPT never stores connector tokens in browser storage, and write
            actions require confirmation.
          </p>
        </header>

        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps"
              className="h-10 pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_CATEGORIES.map((c) => {
              const active = category === c;
              return (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    active
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {!isSignedIn && (
          <div className="rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground flex items-start gap-3">
            <LogIn className="w-4 h-4 mt-0.5 text-[#3b82f6] shrink-0" />
            <div>
              Sign in to connect apps. Your connections are saved to your KovaGPT account so they
              follow you across devices.
            </div>
          </div>
        )}

        {isSignedIn && <GitHubManager />}

        {filtered.length === 0 ? (
          <div className="kova-empty-state">
            <Search className="w-5 h-5 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">No apps match your filters</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different name or category.</p>
            <button
              onClick={() => {
                setQuery("");
                setCategory("All");
              }}
              className="mt-3 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-accent"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {connectedList.length === 0 && !query && category === "All" && (
              <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
                You haven't connected any apps yet. Start with a recommended one below.
              </div>
            )}
            <Section
              title="Connected"
              subtitle="Apps that are ready to use in chat."
              icon={<Check className="w-3.5 h-3.5 text-emerald-400/90" />}
              items={connectedList}
            />
            <Section
              title="Recommended"
              subtitle="The most useful starting points."
              icon={<Sparkles className="w-3.5 h-3.5 text-foreground/70" />}
              items={recommendedList}
            />
            {showAllApps ? (
              <Section
                title={category === "All" ? "All apps" : category}
                subtitle="Connected Google apps are available to the assistant in chat."
                icon={<Link2 className="w-3.5 h-3.5 text-foreground/60" />}
                items={otherList}
              />
            ) : (
              otherList.length > 0 && (
                <div className="rounded-xl border border-border p-5 text-sm text-muted-foreground flex items-center justify-between gap-3">
                  <span>Browse the full catalog by picking a category above or searching.</span>
                </div>
              )
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
