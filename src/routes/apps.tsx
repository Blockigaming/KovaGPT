import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { useTier } from "@/hooks/useTier";
import { GOOGLE_CONNECT_IDS, type ConnectorItem } from "@/lib/connectors-catalog";
import { masterConnectorSearchText } from "@/lib/connector-master-list.mjs";
import { MASTER_PLUGIN_REVIEW_CATALOG, getPluginReview } from "@/lib/plugin-review-catalog";
import { getConnectorPageProfile } from "@/lib/connector-page-profiles";
import {
  Search,
  Check,
  Loader2,
  ShieldAlert,
  FileText,
  PanelsTopLeft,
  AlertCircle,
  LogIn,
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  Ellipsis,
  Link2,
  Sparkles,
  Layers3,
  Folder,
  Calendar,
  Mail,
  MessageSquare,
  StickyNote,
  Code2,
  Image,
  Settings,
  CircleCheck,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  getGitHubManagement,
  refreshGitHubInstallations,
  updateGitHubRepositoryGrants,
  disconnectGitHub,
  type GitHubManagement,
} from "@/lib/github.functions";
import { authFetch, fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { ComposerDrawingDialog } from "@/components/ComposerDrawingDialog";
import { ConnectedAccountManager } from "@/components/ConnectedAccountManager";
import { ConnectorWriteControls } from "@/components/ConnectorWriteControls";
import {
  ConnectorDirectoryBuilder,
  ConnectorDirectorySubmissions,
  PublishedConnectorListings,
} from "@/components/ConnectorDirectorySubmissions";
import { BankConnectionsPanel } from "@/components/BankConnectionsPanel";
import { HealthConnectionsPanel } from "@/components/HealthConnectionsPanel";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import {
  CONNECTION_FLOWS,
  canReadConnection,
  connectionAccounts,
  connectionAuthorizationUrl,
  hasConnectionScopes,
} from "@/integrations/connection-flows.mjs";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppShell } from "@/components/AppShell";
import { usePrincipalSessionPreferences } from "@/hooks/use-principal-session-preferences";
import {
  MAX_MANAGEMENT_QUERY_LENGTH,
  parsePluginListPreferences,
  PLUGIN_LIST_STORAGE_BASE,
} from "@/lib/management-list-preferences.mjs";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import "@/styles/spec400-plugins.css";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { listScheduledTasks, listScheduledTaskConnections } from "@/lib/scheduled-tasks.functions";
import {
  findKnownGoogleScheduleDependencies,
  type GoogleScheduleDependencies,
} from "@/lib/google-schedule-dependencies";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import {
  getGoogleStatus,
  startGoogleConnect,
  disconnectGoogleAccount,
  selectGoogleAccount,
  type GoogleAccountStatus,
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

// Only these existing adapters can expose connection actions. Planned launch
// providers have readable details, never a pretend live connection button.
const WORKING_IDS = new Set<string>([
  "google",
  "gmail",
  "google-drive",
  "google-calendar",
  "github",
  "plaid",
  "excalidraw",
  ...Object.keys(CONNECTION_FLOWS),
]);

const CONFIGURED_CONNECTORS = WORKING_IDS;
const NATIVE_HEALTH_IDS = new Set(["apple-health", "android-health-connect"]);
const PLUGIN_CATEGORIES = [
  ...new Set(MASTER_PLUGIN_REVIEW_CATALOG.map((entry) => entry.connector.category)),
].sort();
const parsePluginFilters = (raw: string | null) =>
  parsePluginListPreferences(raw, PLUGIN_CATEGORIES);
const categoryIcons: Partial<Record<ConnectorItem["category"], typeof Layers3>> = {
  Productivity: Layers3,
  "Storage & Files": Folder,
  Calendar,
  Email: Mail,
  Communication: MessageSquare,
  "Notes & Docs": StickyNote,
  Development: Code2,
  "Social & Media": Image,
};

export const Route = createFileRoute("/apps")({
  component: AppsPage,
  head: () => ({
    meta: [
      { title: "Connections | KovaGPT" },
      {
        name: "description",
        content: "Browse plugins and manage supported connections in KovaGPT.",
      },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/apps" }],
  }),
});

type ConnState =
  | "available"
  | "local_files"
  | "native_app"
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "expired"
  | "reauthorize"
  | "permission_incomplete"
  | "syncing"
  | "temporarily_unavailable";

function googleServiceAccess(id: string, account: GoogleAccountStatus | null) {
  const scopes = account?.connected ? account.has : undefined;
  switch (id) {
    case "gmail":
      return { read: Boolean(scopes?.gmail), write: Boolean(scopes?.gmailWrite) };
    case "google-calendar":
      return { read: Boolean(scopes?.calendar), write: Boolean(scopes?.calendarWrite) };
    case "google-drive":
      return { read: Boolean(scopes?.drive), write: Boolean(scopes?.driveWrite) };
    default:
      return {};
  }
}

type AppActivity = { app: string; action: string; at: string };
const MAX_APP_ACTIVITY = 50;

function parseAppActivity(raw: string | null): AppActivity[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const activity: AppActivity[] = [];
    for (const candidate of parsed) {
      if (activity.length >= MAX_APP_ACTIVITY) break;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const entry = candidate as Record<string, unknown>;
      if (
        typeof entry.app !== "string" ||
        entry.app.length === 0 ||
        entry.app.length > 120 ||
        typeof entry.action !== "string" ||
        entry.action.length === 0 ||
        entry.action.length > 240 ||
        typeof entry.at !== "string" ||
        !Number.isFinite(Date.parse(entry.at))
      ) {
        continue;
      }
      activity.push({ app: entry.app, action: entry.action, at: entry.at });
    }
    return activity;
  } catch {
    return [];
  }
}

function parseGitHubAuthorizationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.hostname !== "github.com" ||
      url.pathname !== "/login/oauth/authorize"
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function AppLogo({ id }: { id: string }) {
  const asset = getPluginReview(id)?.brandAsset.src;
  return (
    <span className="spec400-plugin-logo" data-logo={id} aria-hidden="true">
      {asset ? <img src={asset} alt="" /> : id === "google-docs" ? <FileText /> : <PanelsTopLeft />}
    </span>
  );
}

function StatusBadge({ state, configured }: { state: ConnState; configured: boolean }) {
  const labels: Record<ConnState, string> = {
    available: "Available",
    local_files: "File exchange",
    native_app: "Native app required",
    idle: "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    failed: "Connection failed",
    expired: "Connection expired",
    reauthorize: "Reconnect required",
    permission_incomplete: "More access needed",
    syncing: "Checking connection…",
    temporarily_unavailable: "Status unavailable",
  };
  if (!configured) return <span className="kova-connection-coming-soon">Coming soon</span>;
  const Icon =
    state === "connected"
      ? Check
      : state === "syncing" || state === "connecting"
        ? Loader2
        : ["failed", "temporarily_unavailable"].includes(state)
          ? AlertCircle
          : ["expired", "reauthorize", "permission_incomplete"].includes(state)
            ? ShieldAlert
            : null;
  return (
    <span className="spec400-plugin-status" data-state={state}>
      {Icon && (
        <Icon
          className={
            state === "syncing" || state === "connecting"
              ? "animate-spin motion-reduce:animate-none"
              : undefined
          }
          aria-hidden="true"
        />
      )}
      {labels[state]}
    </span>
  );
}

function AppCard({
  item,
  state,
  configured,
  onDetails,
  onConnect,
}: {
  item: ConnectorItem;
  state: ConnState;
  configured: boolean;
  onDetails: (source: "title" | "action") => void;
  onConnect?: () => void;
}) {
  const pending = state === "connecting" || state === "syncing";
  const reconnect = ["expired", "reauthorize", "permission_incomplete", "failed"].includes(state);
  const action = !configured
    ? "Coming soon"
    : state === "available" || state === "local_files" || state === "native_app"
      ? "Details"
      : state === "temporarily_unavailable"
        ? "Unavailable"
        : state === "connected"
          ? "Connected"
          : reconnect
            ? "Reconnect"
            : pending
              ? "Checking…"
              : "Connect";
  return (
    <li className="spec400-plugin-card" data-plugin-id={item.id}>
      <div className="spec400-plugin-card-heading">
        <AppLogo id={item.id} />
        <div>
          <h3>
            <a
              href={`/apps?plugin=${encodeURIComponent(item.id)}`}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onDetails("title");
              }}
            >
              {item.label}
            </a>
          </h3>
          <p className="spec400-plugin-purpose">
            {state === "connected" ? item.category : item.description}
          </p>
        </div>
      </div>
      <div className="spec400-plugin-card-footer">
        <StatusBadge state={state} configured={configured} />
        {configured && (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onConnect && (action === "Connect" || action === "Reconnect")
                ? onConnect()
                : onDetails("action")
            }
            aria-label={`${action} ${item.label}`}
            className="spec400-plugin-card-action"
            data-connection-action={
              state === "connected" ? "connected" : reconnect ? "reconnect" : undefined
            }
          >
            {state === "connected" ? <Ellipsis aria-hidden="true" /> : action}
          </Button>
        )}
      </div>
    </li>
  );
}

function GitHubManager({
  data,
  loadError,
  reload,
}: {
  data: GitHubManagement | null;
  loadError: boolean;
  reload: (showError?: boolean) => Promise<boolean>;
}) {
  const refresh = useServerFn(refreshGitHubInstallations),
    grants = useServerFn(updateGitHubRepositoryGrants),
    disconnect = useServerFn(disconnectGitHub);
  const [busyAction, setBusyAction] = useState<
    "connect" | "refresh" | "grant" | "disconnect" | null
  >(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const busy = busyAction !== null || loadError;
  useEffect(() => {
    if (!data) return;
    const activeAccountIds = new Set(
      data.accounts
        .filter((account) => ["connected", "degraded"].includes(account.status))
        .map((account) => account.id),
    );
    const activeInstallationIds = new Set(
      data.installations
        .filter(
          (installation) =>
            activeAccountIds.has(installation.account_id) && !installation.suspended_at,
        )
        .map((installation) => String(installation.id)),
    );
    const activeRepositoryIds = new Set(
      data.repositories
        .filter((repository) => activeInstallationIds.has(String(repository.installation_id)))
        .map((repository) => repository.id),
    );
    setSelected((current) => current.filter((id) => activeRepositoryIds.has(id)));
  }, [data]);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [disconnectAccount, setDisconnectAccount] = useState<{
    id: string;
    login: string;
  } | null>(null);
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
  const activeAccounts = data.accounts.filter((account) =>
    ["connected", "degraded"].includes(account.status),
  );
  const activeAccountIds = new Set(activeAccounts.map((account) => account.id));
  const activeInstallations = data.installations.filter(
    (installation) => activeAccountIds.has(installation.account_id) && !installation.suspended_at,
  );
  const activeInstallationIds = new Set(
    activeInstallations.map((installation) => String(installation.id)),
  );
  const repos = data.repositories.filter(
    (repo) =>
      activeInstallationIds.has(String(repo.installation_id)) &&
      repo.full_name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  async function connect() {
    if (busy) return;
    setBusyAction("connect");
    try {
      const response = await authFetch("/api/github/auth");
      const result = (await response.json().catch(() => null)) as {
        url?: unknown;
      } | null;
      const authorizationUrl = parseGitHubAuthorizationUrl(result?.url);
      if (!response.ok || !authorizationUrl) throw new Error("github_authorization_unavailable");
      location.assign(authorizationUrl);
    } catch {
      toast.error("GitHub authorization could not be started. Try again.");
    } finally {
      setBusyAction(null);
    }
  }

  async function refreshInstallations() {
    if (busy) return;
    setBusyAction("refresh");
    try {
      await refresh();
      if (await reload(false)) {
        toast.success("GitHub installations refreshed.");
      } else {
        toast.warning("Installations refreshed, but their current status could not be loaded.");
      }
    } catch {
      toast.error("GitHub installations could not be refreshed. Try again.");
    } finally {
      setBusyAction(null);
    }
  }

  async function update(granted: boolean) {
    if (busy) return;
    if (!granted) {
      setRevokeOpen(true);
      return;
    }
    await applyGrantUpdate(true);
  }
  async function applyGrantUpdate(granted: boolean) {
    if (busy) return;
    setBusyAction("grant");
    try {
      await grants({
        data: {
          repositoryIds: selected,
          granted,
          confirmed: true,
        },
      });
      setSelected([]);
      if (!(await reload(false))) {
        toast.warning("Repository access changed, but its current status could not be loaded.");
      }
    } catch {
      toast.error("Repository access could not be updated");
    } finally {
      setBusyAction(null);
    }
  }

  async function performDisconnect() {
    if (!disconnectAccount || busy) return;
    const accountId = disconnectAccount.id;
    setSelected([]);
    setBusyAction("disconnect");
    try {
      await disconnect({ data: { accountId, removeData: false } });
      setDisconnectAccount(null);
      if (await reload(false)) {
        toast.success("GitHub disconnected.");
      } else {
        toast.warning("GitHub disconnected, but its current status could not be loaded.");
      }
    } catch {
      setDisconnectAccount(null);
      const statusLoaded = await reload(false);
      toast.error(
        statusLoaded
          ? "The disconnect outcome could not be confirmed. Review the current GitHub status before retrying."
          : "The disconnect outcome and current GitHub status could not be confirmed. Reload before retrying.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section
      className="spec400-plugin-management"
      aria-labelledby="github-manager"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <AppLogo id="github" />
          <div>
            <h2 id="github-manager" className="font-semibold">
              GitHub accounts
            </h2>
            <p className="text-sm text-muted-foreground">
              {data.configured
                ? "Manage connected accounts and repository access."
                : "Connection is unavailable in this deployment."}
            </p>
          </div>
        </div>
        {!data.configured ? (
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-300">
            Coming soon
          </span>
        ) : !activeAccounts.length ? (
          <Button
            variant="default"
            disabled={busy}
            className="bg-foreground text-sm text-background disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void connect()}
          >
            {busyAction === "connect" ? "Connecting…" : "Connect"}
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={busy}
            className="border text-sm disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void refreshInstallations()}
          >
            {busyAction === "refresh" ? "Refreshing…" : "Refresh installations"}
          </Button>
        )}
      </div>
      {loadError && (
        <div role="alert" className="spec400-plugin-notice">
          <p>
            GitHub status could not be refreshed. These are the last known accounts; refresh status
            before changing access.
          </p>
          <Button variant="outline" onClick={() => void reload()}>
            Refresh status
          </Button>
        </div>
      )}
      {data.accounts.map((account) => {
        const isActive = activeAccountIds.has(account.id);
        return (
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
                {account.auth_type} · {account.status.replaceAll("_", " ")}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Current permissions:{" "}
                {Array.isArray(account.scopes)
                  ? account.scopes.join(", ") || "No scopes reported"
                  : typeof account.scopes === "string" && account.scopes
                    ? account.scopes
                    : "No scopes reported"}
              </p>
              {!isActive && (
                <p className="mt-2 text-sm text-muted-foreground">
                  This connection record is retained. Reconnect to restore access.
                </p>
              )}
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
            {isActive ? (
              <>
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy || !data.configured}
                  className="border text-sm"
                  onClick={() => void connect()}
                  aria-label={`Reconnect GitHub account @${account.login}`}
                >
                  Reconnect
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy}
                  className="border text-sm text-destructive"
                  onClick={() => setDisconnectAccount({ id: account.id, login: account.login })}
                  aria-label={`Disconnect GitHub account @${account.login}`}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                className="border text-sm"
                onClick={() => void connect()}
                aria-label={`Reconnect GitHub account @${account.login}`}
              >
                Reconnect
              </Button>
            )}
          </div>
        );
      })}
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
      <Dialog
        open={disconnectAccount !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectAccount(null);
        }}
      >
        <DialogContent className="spec400-connection-dialog max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect @{disconnectAccount?.login ?? "GitHub account"}?</DialogTitle>
            <DialogDescription>
              This disconnects only the selected account. Existing synchronized metadata is kept
              because account-scoped data removal is not available yet. Coding tasks and any
              scheduled tasks or projects using this account will lose access to its repositories. A
              list of dependent workflows is not available here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"

              onClick={() => setDisconnectAccount(null)}
            >
              {busyAction === "disconnect" ? "Close" : "Cancel"}
            </Button>
            <Button
              variant="destructive"

              disabled={busy}
              onClick={() => void performDisconnect()}
            >
              {busyAction === "disconnect" ? "Disconnecting…" : "Disconnect account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {activeInstallations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium">Installations</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {activeInstallations.map((item) => (
              <span key={item.id} className="rounded-full border px-3 py-1 text-xs">
                {item.organization_login ?? "Personal"} · {item.repository_selection}
                {item.suspended_at ? " · suspended" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      {activeInstallations.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              className="min-h-11 flex-1 border"
              placeholder="Search GitHub repositories"
              aria-label="Search GitHub repositories"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={!selected.length || busy}
              onClick={() => void update(true)}
              className="border text-sm"
            >
              Grant selected
            </Button>
            <Button
              variant="outline"
              disabled={!selected.length || busy}
              onClick={() => void update(false)}
              className="border text-sm text-destructive"
            >
              Remove selected
            </Button>
          </div>
          <ul className="mt-3 max-h-80 divide-y overflow-y-auto rounded-xl border">
            {repos.map((repo) => (
              <li key={repo.id} className="flex min-h-12 flex-wrap items-center gap-3 p-3">
                <label className="flex min-h-11 min-w-11 items-center justify-center">
                  <input
                    data-ui-reference="chatgpt.checkbox"
                    type="checkbox"
                    className="h-4 w-4 kova-native-check"
                    disabled={busy}
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
                </label>
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
                {repo.explicitly_granted && (
                  <ConnectorWriteControls
                    connector="github"
                    target={String(repo.id)}
                    label={repo.full_name}
                    providerCanWrite={
                      !repo.archived &&
                      (repo.permissions.push === true || repo.permissions.admin === true)
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function GoogleDisconnectSchedules({
  userId,
  connectionId,
}: {
  userId: string;
  connectionId: string;
}) {
  const listTasks = useServerFn(listScheduledTasks);
  const listConnections = useServerFn(listScheduledTaskConnections);
  const [attempt, setAttempt] = useState(0);
  const [review, setReview] = useState<
    { kind: "loading" } | { kind: "unavailable" } | ({ kind: "ready" } & GoogleScheduleDependencies)
  >({ kind: "loading" });

  useEffect(() => {
    let current = true;
    setReview({ kind: "loading" });
    // Two bounded owner reads, never a per-task/provider request fan-out.
    const timer = window.setTimeout(() => {
      if (!current) return;
      current = false;
      setReview({ kind: "unavailable" });
    }, 15_000);
    void Promise.all([
      listTasks({ data: { expectedUserId: userId } }),
      listConnections({ data: { expectedUserId: userId } }),
    ])
      .then(([tasks, connections]) => {
        if (!current) return;
        const result = findKnownGoogleScheduleDependencies(connectionId, tasks, connections.grants);
        setReview({ kind: "ready", ...result });
      })
      .catch(() => {
        if (current) setReview({ kind: "unavailable" });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [userId, connectionId, attempt, listTasks, listConnections]);

  return (
    <section aria-label="Known schedule dependencies" className="space-y-3 text-sm">
      <h3 className="font-medium">Known schedules using this account</h3>
      <p className="text-muted-foreground">
        Partial coverage: this check only identifies schedules linked through active, unexpired
        Gmail task grants. Expired or revoked grants and project dependencies are not included.
      </p>
      <div aria-live="polite" aria-busy={review.kind === "loading"}>
        {review.kind === "loading" ? (
          <p role="status">Checking known scheduled tasks…</p>
        ) : review.kind === "unavailable" ? (
          <div className="space-y-2">
            <p role="status">
              Known schedule dependencies could not be checked. Review your schedules before
              disconnecting; other dependencies may exist.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry schedule check
            </Button>
          </div>
        ) : review.schedules.length ? (
          <>
            <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
              {review.schedules.map((task) => (
                <li key={task.id}>
                  <a href={task.href} className="break-words underline underline-offset-2">
                    {task.title}
                  </a>
                </li>
              ))}
            </ul>
            {review.knownCount > review.schedules.length && (
              <p className="mt-2 text-muted-foreground">
                Showing {review.schedules.length} of {review.knownCount} known matching schedules.
                Open Tasks to review the rest.
              </p>
            )}
          </>
        ) : (
          <p>
            No known matching schedules were found in this limited check. Other dependencies may
            still exist.
          </p>
        )}
      </div>
      <a href="/scheduled-tasks" className="inline-block underline underline-offset-2">
        Review all saved schedules
      </a>
    </section>
  );
}

function AppsPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { tier, status: tierStatus } = useTier();
  const userKey = user?.id ?? null;
  const workflowSkillsAvailable = user?.primaryEmailAddress?.verification?.status === "verified";
  const principal = isLoaded ? browserStoragePrincipal(userKey) : null;
  const otherConnections = useConnectedAccounts(principal, Boolean(isLoaded && isSignedIn));
  const refreshOtherConnections = otherConnections.reload;
  const activityKey = isLoaded ? principalScopedStorageKey("kova-app-activity", userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const generationRef = useRef(0);
  const [lifecycleVersion, setLifecycleVersion] = useState(0);
  const [{ query, category, connectionFilter }, setListPreferences] =
    usePrincipalSessionPreferences(
      PLUGIN_LIST_STORAGE_BASE,
      isLoaded ? userKey : undefined,
      parsePluginFilters,
    );
  const navigate = useNavigate({ from: "/apps" });
  const searchString = useLocation({ select: (location) => location.searchStr });
  const routeSearch = new URLSearchParams(searchString);
  const connectionView = routeSearch.get("connection_view");
  const connectionGroup =
    routeSearch.has("oauth_state_id") || connectionView === "finances"
      ? "finances"
      : connectionView === "health" ||
          ["oura", "whoop"].includes(routeSearch.get("integration_connected") ?? "")
        ? "health"
        : null;
  const setQuery = (query: string) => setListPreferences({ query });
  const setConnectionFilter = (value: string) =>
    setListPreferences({ connectionFilter: value === "connected" ? "connected" : "all" });
  const loadGitHub = useServerFn(getGitHubManagement);
  const [githubData, setGithubData] = useState<GitHubManagement | null>(null);
  const [githubLoading, setGithubLoading] = useState(true);
  const [githubLoadError, setGithubLoadError] = useState(false);
  const githubRequestRef = useRef(0);
  const googleDisconnectReturnRef = useRef<{
    trigger: HTMLButtonElement;
    url: string;
    principal: string | null;
    generation: number;
  } | null>(null);
  const [pendingGoogleDisconnect, setPendingGoogleDisconnect] = useState<{
    id: string;
    email: string;
  } | null>(null);
  const [connecting, setConnecting] = useState<Record<string, true>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const googleBusyRef = useRef(false);
  const googleRequestRef = useRef(0);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const directoryRef = useRef<HTMLElement>(null);
  const previousDetailsRef = useRef<{ id: string; principal: string | null } | null>(null);
  const detailTriggerRef = useRef<{
    id: string;
    source: "title" | "action";
    principal: string | null;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [activity, setActivity] = useState<AppActivity[]>([]);
  const activityRef = useRef<AppActivity[]>([]);
  const [activityPrincipal, setActivityPrincipal] = useState<string | null>(null);
  const [activityPersistenceError, setActivityPersistenceError] = useState(false);
  const activityReady = principal !== null && activityPrincipal === principal;
  const visibleActivity = activityReady ? activity : [];
  const visibleGoogleStatus = activityReady ? googleStatus : null;
  const visibleGoogleLoading = activityReady ? googleLoading : true;
  const pluginId = routeSearch.get("plugin");
  const selectedReview =
    isLoaded && activityReady && pluginId ? getPluginReview(pluginId) : undefined;
  const visibleSelectedApp = selectedReview?.connector;
  const detailId = visibleSelectedApp?.id;
  const teamsMessagesAfterConsent = routeSearch.get("teams_view") === "messages";
  useEffect(() => {
    if (!activityReady) return;
    const previous = previousDetailsRef.current;
    if (detailId) {
      previousDetailsRef.current = { id: detailId, principal };
      directoryRef.current?.scrollIntoView({ block: "start" });
      detailsHeadingRef.current?.focus({ preventScroll: true });
      // The router restores scroll after this effect on some viewports; settle once more.
      const frame = requestAnimationFrame(() => {
        directoryRef.current?.scrollIntoView({ block: "start" });
        detailsHeadingRef.current?.scrollIntoView({ block: "nearest" });
      });
      return () => cancelAnimationFrame(frame);
    } else if (previous) {
      previousDetailsRef.current = null;
      if (previous.principal !== principal || connectionGroup) return;
      const trigger = detailTriggerRef.current;
      detailTriggerRef.current = null;
      const fromAction =
        trigger?.id === previous.id &&
        trigger.principal === principal &&
        trigger.source === "action";
      const target = directoryRef.current
        ?.querySelector(`[data-plugin-id="${previous.id}"]`)
        ?.querySelector<HTMLElement>(fromAction ? ".spec400-plugin-card-action" : "h3 a");
      (target ?? searchRef.current)?.focus();
    }
  }, [activityReady, connectionGroup, detailId, principal]);
  useEffect(() => setPendingGoogleDisconnect(null), [detailId]);
  const googleStatusRef = useRef<HTMLElement>(null);
  const googleRefreshContext = `${principal}:${visibleSelectedApp?.id ?? "closed"}:${lifecycleVersion}`;
  const googleRefreshScopeRef = useRef({ context: googleRefreshContext, epoch: 0 });
  if (googleRefreshScopeRef.current.context !== googleRefreshContext) {
    googleRefreshScopeRef.current = {
      context: googleRefreshContext,
      epoch: googleRefreshScopeRef.current.epoch + 1,
    };
  }
  useEffect(
    () => () => {
      googleRefreshScopeRef.current.epoch += 1;
    },
    [],
  );

  const resendWorkflowVerification = async () => {
    const email = user?.primaryEmailAddress?.emailAddress;
    if (!email || verificationBusy) return;
    const generation = generationRef.current;
    setVerificationBusy(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (generation !== generationRef.current) return;
      if (error) throw error;
      toast.success("Verification email sent. Follow its link, then refresh this page.");
    } catch {
      if (generation !== generationRef.current) return;
      toast.error("Verification email could not be sent. Try again shortly.");
    } finally {
      if (generation === generationRef.current) setVerificationBusy(false);
    }
  };

  useEffect(() => {
    generationRef.current += 1;
    googleRequestRef.current += 1;
    googleBusyRef.current = false;
    setGoogleBusy(false);
    setGithubData(null);
    setGithubLoading(true);
    setGithubLoadError(false);
    setPendingGoogleDisconnect(null);
    activityRef.current = [];
    setActivity([]);
    setActivityPrincipal(null);
    setActivityPersistenceError(false);
    setGoogleStatus(null);
    setGoogleLoading(true);
    setConnecting({});
    setFailed({});
    if (!principal || !activityKey) return;
    let storedActivity: AppActivity[] = [];
    try {
      const storage = safeBrowserStorage("localStorage");
      if (storage) {
        storedActivity = parseAppActivity(storage.getItem(activityKey));
      } else {
        setActivityPersistenceError(true);
      }
    } catch {
      setActivityPersistenceError(true);
    }
    activityRef.current = storedActivity;
    setActivity(storedActivity);
    setActivityPrincipal(principal);
  }, [activityKey, principal]);

  useEffect(() => {
    if (!isLoaded || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      generationRef.current += 1;
      googleRequestRef.current += 1;
      googleBusyRef.current = false;
      setGoogleBusy(false);
      activityRef.current = [];
      setActivity([]);
      setActivityPrincipal(principal);
      setActivityPersistenceError(false);
      setGoogleStatus(null);
      setGoogleLoading(true);
      setConnecting({});
      setFailed({});
      setGithubData(null);
      setGithubLoading(true);
      setGithubLoadError(false);
      setPendingGoogleDisconnect(null);
      setLifecycleVersion((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);

  const recordActivity = useCallback(
    (app: string, action: string) => {
      if (!activityReady || !activityKey) return;
      const next = [{ app, action, at: new Date().toISOString() }, ...activityRef.current].slice(
        0,
        MAX_APP_ACTIVITY,
      );
      activityRef.current = next;
      setActivity(next);
      try {
        const storage = safeBrowserStorage("localStorage");
        if (!storage) throw new Error("browser_storage_unavailable");
        storage.setItem(activityKey, JSON.stringify(next));
        setActivityPersistenceError(false);
      } catch {
        setActivityPersistenceError(true);
      }
    },
    [activityKey, activityReady],
  );

  const refreshGoogle = useCallback(async () => {
    if (!isLoaded || !principal || !userKey) return;
    const generation = generationRef.current;
    const requestPrincipal = principal;
    const requestId = ++googleRequestRef.current;
    const isCurrent = () =>
      generation === generationRef.current &&
      principalRef.current === requestPrincipal &&
      requestId === googleRequestRef.current;
    setGoogleLoading(true);
    try {
      const status = await getGoogleStatus(userKey);
      if (isCurrent()) {
        setGoogleStatus(status);
        return status;
      }
    } catch {
      if (isCurrent()) setGoogleStatus({ connected: false, state: "temporarily_unavailable" });
    } finally {
      if (isCurrent()) setGoogleLoading(false);
    }
  }, [isLoaded, principal, userKey]);

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
      toast.info("Checking Google connection…");
      void refreshGoogle().then((status) => {
        if (!status) return;
        if (status.connected && status.state === "connected") {
          toast.success("Google connection verified");
          recordActivity("Google", "Connection verified");
        } else {
          toast.warning(
            "Google authorization returned. Review the account status before using this connection.",
          );
        }
      });
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

  const googleRefreshEpoch = googleRefreshScopeRef.current.epoch;
  const googleRefreshGeneration = generationRef.current;
  const googleRefreshRequest = googleRequestRef.current;
  const googleRefreshUrl = typeof window === "undefined" ? null : window.location.href;
  const refreshGoogleStatus = (event: React.MouseEvent<HTMLButtonElement>) => {
    const trigger = event.currentTarget;
    if (
      !isLoaded ||
      !isSignedIn ||
      !activityReady ||
      !visibleSelectedApp ||
      !isGoogleId(visibleSelectedApp.id) ||
      visibleGoogleLoading ||
      googleBusyRef.current ||
      googleRefreshScopeRef.current.epoch !== googleRefreshEpoch ||
      generationRef.current !== googleRefreshGeneration ||
      googleRequestRef.current !== googleRefreshRequest ||
      principalRef.current !== principal ||
      window.location.href !== googleRefreshUrl ||
      !trigger.isConnected ||
      trigger.disabled
    )
      return;
    const target = googleStatusRef.current;
    // Move focus before Refresh becomes disabled; completion never takes it back.
    if (
      target?.isConnected &&
      target.getClientRects().length &&
      !target.closest('[inert], [aria-hidden="true"]') &&
      (document.activeElement === trigger || document.activeElement === document.body)
    ) {
      target.focus({ preventScroll: true });
    }
    void refreshGoogle();
  };

  const connectGoogle = async (
    connectionId?: string,
    itemId = "gmail",
    access: "read" | "read-write" = "read",
  ) => {
    if (!activityReady || !principal || !userKey || googleBusyRef.current || googleLoading) return;
    const generation = generationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === generationRef.current && principalRef.current === requestPrincipal;
    googleBusyRef.current = true;
    setGoogleBusy(true);
    setConnecting((current) => ({ ...current, [itemId]: true }));
    setFailed((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    try {
      await startGoogleConnect(
        connectionId,
        userKey,
        itemId === "google" ? "gmail" : itemId,
        access,
      );
    } catch (error) {
      if (isCurrent()) {
        setFailed((current) => ({ ...current, [itemId]: true }));
        toast.error(error instanceof Error ? error.message : "Could not start Google connection.");
      }
    } finally {
      if (isCurrent()) {
        googleBusyRef.current = false;
        setGoogleBusy(false);
        setConnecting((current) => {
          const next = { ...current };
          delete next[itemId];
          return next;
        });
      }
    }
  };

  const changeGoogleAccount = async (action: "select" | "disconnect", connectionId: string) => {
    if (
      !activityReady ||
      !principal ||
      !userKey ||
      googleBusyRef.current ||
      googleLoading ||
      !googleStatus?.accounts?.some((account) => account.id === connectionId)
    )
      return;
    const generation = generationRef.current;
    const requestPrincipal = principal;
    const isCurrent = () =>
      generation === generationRef.current && principalRef.current === requestPrincipal;
    const revision = googleStatus.selectionRevision;
    if (action === "select" && (!Number.isSafeInteger(revision) || (revision ?? -1) < 0)) {
      await refreshGoogle();
      return;
    }
    googleBusyRef.current = true;
    googleRequestRef.current += 1;
    setGoogleBusy(true);
    try {
      if (action === "select") await selectGoogleAccount(connectionId, revision!, userKey);
      else
        await disconnectGoogleAccount(
          connectionId,
          googleStatus.accounts!.find((account) => account.id === connectionId)!.connectionRevision,
          userKey,
        );
      if (!isCurrent()) return;
      recordActivity(
        "Google",
        action === "select" ? "Selected account for new requests" : "Disconnected account",
      );
      toast.success(
        action === "select" ? "Google account selected" : "Google account disconnected",
      );
    } catch (error) {
      if (isCurrent())
        toast.error(error instanceof Error ? error.message : "Google account change failed.");
    } finally {
      if (isCurrent()) {
        await refreshGoogle();
        if (isCurrent()) {
          googleBusyRef.current = false;
          setGoogleBusy(false);
        }
      }
    }
  };

  const handleConnect = async (item: ConnectorItem) => {
    if (isGoogleId(item.id)) {
      const state = stateOf(item.id);
      const existing =
        state === "reauthorize" || state === "permission_incomplete"
          ? (visibleGoogleStatus?.selectedConnectionId ?? undefined)
          : undefined;
      await connectGoogle(existing, item.id);
      return;
    }
    toast.error(`${item.label} is not available in this deployment.`);
  };

  const cardConnectBusyRef = useRef(false);
  const canConnectFromCard = (id: string) => {
    if (!isSignedIn || !userKey) return false;
    if (id === "gmail") return tierStatus === "ready" && tier !== "free";
    if (isGoogleId(id) || id === "github") return true;
    const flow = CONNECTION_FLOWS[id];
    return Boolean(
      flow && flow.authentication !== "api-key" && id !== "notion" && id !== "notion-private",
    );
  };
  // Starts the provider's own sign-in straight from the directory card.
  const startCardConnect = async (item: ConnectorItem) => {
    if (cardConnectBusyRef.current || !userKey) return;
    cardConnectBusyRef.current = true;
    try {
      if (isGoogleId(item.id)) {
        await handleConnect(item);
        return;
      }
      if (item.id === "github") {
        const response = await authFetch("/api/github/auth");
        const result = (await response.json().catch(() => null)) as { url?: unknown } | null;
        const authorizationUrl = parseGitHubAuthorizationUrl(result?.url);
        if (!response.ok || !authorizationUrl) throw new Error("github_authorization_unavailable");
        window.location.assign(authorizationUrl);
        return;
      }
      const flow = CONNECTION_FLOWS[item.id];
      if (!flow) throw new Error("connection_unavailable");
      const response = await fetchWithTimeoutAuthenticated("/api/integrations/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kova-Owner": userKey },
        body: JSON.stringify({
          provider: flow.provider,
          optionalScopes: flow.scopes,
          returnPath: `/apps?connection_view=${item.id}`,
        }),
      });
      const body = await response.json();
      const url = connectionAuthorizationUrl(flow.provider, body.url);
      if (!response.ok || !url) throw new Error("connection_start_failed");
      window.location.assign(url);
    } catch {
      toast.error(`Could not start the ${item.label} connection. Try again.`);
    } finally {
      cardConnectBusyRef.current = false;
    }
  };

  const isGoogleConnected = (id: string): boolean => {
    if (!visibleGoogleStatus?.connected) return false;
    if (id === "google") return true;
    return googleServiceAccess(id, visibleGoogleStatus).read === true;
  };

  const refreshGitHub = useCallback(
    async (showError = true): Promise<boolean> => {
      if (!isLoaded || !principal || !userKey) return false;
      const generation = generationRef.current;
      const requestPrincipal = principal;
      const requestId = ++githubRequestRef.current;
      const isCurrent = () =>
        generation === generationRef.current &&
        principalRef.current === requestPrincipal &&
        requestId === githubRequestRef.current;
      setGithubLoading(true);
      setGithubLoadError(false);
      try {
        const next = await loadGitHub();
        if (!isCurrent()) return false;
        if (
          !next ||
          typeof next.configured !== "boolean" ||
          !Array.isArray(next.accounts) ||
          !Array.isArray(next.installations) ||
          !Array.isArray(next.repositories) ||
          !["healthy", "degraded", "reconnect_required", "credentials_not_configured"].includes(
            next.health,
          )
        )
          throw new Error("GitHub status was invalid");
        setGithubData(next);
        return true;
      } catch {
        if (isCurrent()) {
          setGithubLoadError(true);
          if (showError) toast.error("GitHub status unavailable");
        }
        return false;
      } finally {
        if (isCurrent()) setGithubLoading(false);
      }
    },
    [isLoaded, principal, userKey, loadGitHub],
  );

  useEffect(() => {
    if (!isSignedIn) {
      setGithubData(null);
      setGithubLoading(false);
      return;
    }
    void refreshGitHub(false);
  }, [isSignedIn, lifecycleVersion, refreshGitHub]);

  const visibleGithubData = activityReady ? githubData : null;
  const selectedProfile = detailId ? getConnectorPageProfile(detailId) : undefined;

  useEffect(() => {
    if (!activityReady || !isSignedIn) return;
    const url = new URL(window.location.href);
    if (
      !url.searchParams.has("integration_connected") &&
      !url.searchParams.has("integration_error")
    )
      return;
    const id = url.searchParams.get("connection_view");
    if (id && Object.hasOwn(CONNECTION_FLOWS, id)) {
      url.searchParams.delete("connection_view");
      const messages = id === "ms-teams-messages";
      const item = MASTER_PLUGIN_REVIEW_CATALOG.find(
        (entry) => entry.connector.id === (messages ? "ms-teams" : id),
      )?.connector;
      if (item) {
        url.searchParams.set("plugin", item.id);
        if (messages) url.searchParams.set("teams_view", "messages");
      }
    }
    if (url.searchParams.has("integration_error"))
      toast.error(
        "The provider connection was not completed. Review the account status and try again.",
      );
    else toast.message("Authorization returned. Review the account and search to verify access.");
    for (const key of ["integration_connected", "integration_error"]) url.searchParams.delete(key);
    void navigate({ search: Object.fromEntries(url.searchParams) as never, replace: true });
    void refreshOtherConnections();
  }, [activityReady, isSignedIn, navigate, refreshOtherConnections]);

  const notionKeyConfigured =
    otherConnections.data?.configuredProviders.some(({ id }) => id === "notion-private") === true;
  const notionOAuthConfigured =
    otherConnections.data?.configuredProviders.some(({ id }) => id === "notion") === true;
  const configuredOf = (id: string) => {
    if (id === "github") return visibleGithubData?.configured !== false;
    if (id === "notion") return notionKeyConfigured || notionOAuthConfigured;
    if (NATIVE_HEALTH_IDS.has(id)) return true;
    if (id === "oura")
      return (
        otherConnections.data?.configuredProviders.some((provider) => provider.id === id) === true
      );
    const flow = CONNECTION_FLOWS[id];
    if (flow)
      return (
        otherConnections.data?.configuredProviders.some(
          (provider) => provider.id === flow.provider,
        ) === true
      );
    return CONFIGURED_CONNECTORS.has(id);
  };

  const stateOf = (id: string): ConnState => {
    if (id === "plaid") return "available";
    if (id === "excalidraw") return "local_files";
    if (NATIVE_HEALTH_IDS.has(id)) return "native_app";
    if (!isSignedIn) return "idle";
    if (isGoogleId(id)) {
      if (visibleGoogleLoading || googleBusy) return "syncing";
      if (activityReady && connecting[id]) return "connecting";
      if (activityReady && failed[id]) return "failed";
      if (visibleGoogleStatus?.state === "temporarily_unavailable")
        return "temporarily_unavailable";
      if (visibleGoogleStatus?.state === "reauthorization_required") return "reauthorize";
      const { read, write } = googleServiceAccess(id, visibleGoogleStatus);
      if (read) return "connected";
      if (read || write) return "permission_incomplete";
      return "idle";
    }
    if (id === "github") {
      if (!activityReady || githubLoading) return "syncing";
      if (githubLoadError || !visibleGithubData?.configured) return "temporarily_unavailable";
      if (visibleGithubData.health === "reconnect_required") return "reauthorize";
      if (visibleGithubData.health === "degraded") return "permission_incomplete";
      if (visibleGithubData.accounts.some((account) => account.status === "connected"))
        return "connected";
      return "idle";
    }
    if (id === "oura") {
      if (otherConnections.loading) return "syncing";
      if (otherConnections.error || !configuredOf(id)) return "temporarily_unavailable";
      const accounts =
        otherConnections.data?.accounts.filter((account) => account.provider_id === id) ?? [];
      if (
        accounts.some(
          (account) =>
            account.status === "connected" &&
            (!account.token_expires_at || Date.parse(account.token_expires_at) > Date.now()),
        )
      )
        return "connected";
      return accounts.length ? "reauthorize" : "idle";
    }
    if (CONNECTION_FLOWS[id]) {
      if (otherConnections.loading) return "syncing";
      if (otherConnections.error || !configuredOf(id)) return "temporarily_unavailable";
      if (
        id === "notion" &&
        notionKeyConfigured &&
        otherConnections.data?.accounts.some((account) =>
          canReadConnection(account, "notion-private"),
        )
      )
        return "connected";
      const accounts = connectionAccounts(otherConnections.data?.accounts ?? [], id);
      if (
        accounts.some(
          (account) =>
            canReadConnection(account, id) ||
            (id === "ms-teams" && canReadConnection(account, "ms-teams-messages")),
        )
      )
        return "connected";
      if (
        accounts.some(
          (account) =>
            account.status === "expired" ||
            (account.token_expires_at &&
              Date.parse(account.token_expires_at) <= Date.now() + 30_000),
        )
      )
        return "reauthorize";
      return accounts.length ? "permission_incomplete" : "idle";
    }
    return "temporarily_unavailable";
  };

  // Connection records requiring attention stay reachable from Connected.
  const hasConnection = (id: string) => {
    if (isGoogleId(id))
      return (
        isGoogleConnected(id) ||
        !!visibleGoogleStatus?.accounts?.some((account) => account.state !== "disconnected")
      );
    if (id === "github")
      return !!visibleGithubData?.accounts.some((account) => account.status !== "disconnected");
    if (
      id === "notion" &&
      otherConnections.data?.accounts.some(
        (account) => account.provider_id === "notion-private" && account.status !== "revoked",
      )
    )
      return true;
    if (id === "oura")
      return (
        otherConnections.data?.accounts.some(
          (account) => account.provider_id === id && account.status !== "revoked",
        ) === true
      );
    if (CONNECTION_FLOWS[id])
      return connectionAccounts(otherConnections.data?.accounts ?? [], id).some(
        (account) =>
          account.status !== "revoked" &&
          (hasConnectionScopes(account.granted_scopes, CONNECTION_FLOWS[id].scopes) ||
            (id === "ms-teams" &&
              hasConnectionScopes(
                account.granted_scopes,
                CONNECTION_FLOWS["ms-teams-messages"].scopes,
              ))),
      );
    return false;
  };
  const popularity = [
    "gmail",
    "google-drive",
    "google-calendar",
    "github",
    "notion",
    "slack",
    "outlook",
    "outlook-calendar",
    "ms-teams",
    "onedrive",
    "figma",
    "canva",
    "box",
    "linear",
  ];
  const priority = (id: string) => {
    const index = popularity.indexOf(id);
    return index < 0 ? popularity.length : index;
  };
  const groupOf = (id: string) => {
    const state = stateOf(id);
    if (state === "connected") return 0;
    if (["expired", "reauthorize", "permission_incomplete", "failed"].includes(state)) return 1;
    return configuredOf(id) ? 2 : 3;
  };
  const catalog = MASTER_PLUGIN_REVIEW_CATALOG.map((entry) => entry.connector).sort(
    (a, b) =>
      groupOf(a.id) - groupOf(b.id) ||
      priority(a.id) - priority(b.id) ||
      a.label.localeCompare(b.label),
  );
  const connectionCountState = !isLoaded
    ? "unknown"
    : !isSignedIn
      ? "ready"
      : !activityReady ||
          visibleGoogleLoading ||
          googleBusy ||
          githubLoading ||
          otherConnections.loading
        ? "checking"
        : githubLoadError ||
            otherConnections.error ||
            [...WORKING_IDS]
              // Bank status belongs to the separate Finances panel, not this
              // directory's Google/GitHub/provider-account status sources.
              .filter(
                (id) =>
                  isGoogleId(id) || id === "github" || (CONNECTION_FLOWS[id] && configuredOf(id)),
              )
              .some((id) => stateOf(id) === "temporarily_unavailable")
          ? "unavailable"
          : !visibleGoogleStatus || !visibleGithubData
            ? "unknown"
            : "ready";
  const connectedStatusMessage =
    connectionCountState === "checking"
      ? "Checking connections…"
      : connectionCountState === "unavailable"
        ? "Connected plugin count is unavailable. Refresh a provider’s status to try again."
        : "Connected plugin count is not known yet.";
  const connectedStatusUnverified =
    connectionFilter === "connected" && connectionCountState !== "ready";
  const filtered = catalog.filter((c) => {
    if (connectionFilter === "connected" && !hasConnection(c.id)) return false;
    if (category !== "all" && c.category !== category) return false;
    const q = query.trim().toLowerCase();
    return (
      !q ||
      [c.label, c.description, c.category, masterConnectorSearchText(c.id)].some((value) =>
        value.toLowerCase().includes(q),
      )
    );
  });
  const browsing = connectionFilter === "all" && !query.trim() && category === "all";
  const featured = browsing
    ? filtered.filter((item) => groupOf(item.id) === 2 && priority(item.id) < 6).slice(0, 4)
    : [];
  const featuredIds = new Set(featured.map(({ id }) => id));

  const handleUseInChat = (item: ConnectorItem) => {
    const handoff = writePrincipalHandoff(
      safeBrowserStorage("sessionStorage"),
      "kova-app-chat-context",
      isLoaded ? userKey : undefined,
      `Use my connected ${item.label} account for this request when relevant: `,
    );
    if (!handoff.ok) {
      toast.error("Plugin context could not be prepared. Reload and try again.");
      return;
    }
    window.location.href = "/";
  };

  const renderGrid = (items: ConnectorItem[], singleColumn = false) => (
    <ul
      className="spec400-plugin-grid kova-directory-rows"
      data-single-column={singleColumn || undefined}
      aria-label="Connection directory"
    >
      {items.map((item) => (
        <AppCard
          key={item.id}
          item={item}
          state={stateOf(item.id)}
          configured={configuredOf(item.id)}
          onDetails={(source) => {
            detailTriggerRef.current = { id: item.id, source, principal };
            void navigate({ search: { plugin: item.id } as never });
          }}
          onConnect={canConnectFromCard(item.id) ? () => void startCardConnect(item) : undefined}
        />
      ))}
    </ul>
  );

  const related = visibleSelectedApp
    ? [
        ...(selectedProfile?.related.flatMap((id) => {
          const item = catalog.find((connector) => connector.id === id && id !== detailId);
          return item ? [item] : [];
        }) ?? []),
        ...catalog.filter(
          (item) =>
            item.id !== detailId &&
            item.category === visibleSelectedApp.category &&
            !selectedProfile?.related.includes(item.id),
        ),
      ].slice(0, 4)
    : [];
  const developerView = routeSearch.get("directory");
  if (developerView === "submissions" || developerView === "guide")
    return (
      <AppShell hideUtilities>
        <main
          id="main-content"
          tabIndex={-1}
          className="kova-page kova-secondary-page spec400-plugins"
        >
          <ConnectorDirectorySubmissions
            key={principal ?? "guest"}
            owner={isLoaded && isSignedIn ? userKey : null}
            guide={developerView === "guide"}
          />
        </main>
      </AppShell>
    );

  return (
    <AppShell hideUtilities>
      <main
        id="main-content"
        tabIndex={-1}
        ref={directoryRef}
        aria-labelledby={visibleSelectedApp ? "connection-title" : "apps-title"}
        className="kova-page kova-secondary-page spec400-plugins"
        data-ui-reference={visibleSelectedApp ? undefined : "kova.connections.directory"}
      >
        {visibleSelectedApp && selectedProfile && (
          <article
            key={`${principal}:${visibleSelectedApp.id}`}
            className="kova-connection-page"
            style={{ "--connection-accent": selectedReview?.brandAsset.accent } as CSSProperties}
            data-ui-reference="kova.connections.details"
            aria-labelledby="connection-title"
          >
            <Button
              type="button"
              variant="ghost"
              className="kova-connection-back"
              onClick={() => void navigate({ search: {} as never, resetScroll: false })}
            >
              <ArrowLeft aria-hidden="true" /> Back to Connections
            </Button>
            <header className="kova-connection-hero">
              <div className="kova-connection-hero-top">
                <AppLogo id={visibleSelectedApp.id} />
                <div className="kova-connection-header-actions">
                  <StatusBadge
                    state={stateOf(visibleSelectedApp.id)}
                    configured={configuredOf(visibleSelectedApp.id)}
                  />
                  {configuredOf(visibleSelectedApp.id) &&
                    canConnectFromCard(visibleSelectedApp.id) &&
                    stateOf(visibleSelectedApp.id) !== "connected" && (
                      <Button
                        type="button"
                        className="kova-connection-primary"
                        disabled={["connecting", "syncing"].includes(
                          stateOf(visibleSelectedApp.id),
                        )}
                        onClick={() => void startCardConnect(visibleSelectedApp)}
                      >
                        {["expired", "reauthorize", "permission_incomplete", "failed"].includes(
                          stateOf(visibleSelectedApp.id),
                        )
                          ? "Reconnect"
                          : "Connect"}
                      </Button>
                    )}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copy connection link"
                    title="Copy connection link"
                    onClick={async () => {
                      const link = new URL("/apps", window.location.origin);
                      link.searchParams.set("plugin", visibleSelectedApp.id);
                      try {
                        await navigator.clipboard.writeText(link.href);
                        toast.success("Connection link copied");
                      } catch {
                        toast.error(
                          "Could not copy the link. Use your address bar to share this page.",
                        );
                      }
                    }}
                  >
                    <Link2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <h1 id="connection-title" ref={detailsHeadingRef} tabIndex={-1}>
                {visibleSelectedApp.label}
              </h1>
              <p className="kova-connection-meta">
                By {selectedProfile.publisher ?? visibleSelectedApp.label} ·{" "}
                {visibleSelectedApp.description}
              </p>
            </header>
            <Tabs defaultValue="overview" className="kova-connection-tabs">
              <TabsList className="kova-connection-tablist" aria-label="Connection information">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="access">Permissions</TabsTrigger>
              </TabsList>
              <div className="kova-connection-layout">
                <div className="kova-connection-content">
                  <TabsContent value="overview" forceMount className="kova-connection-tab">
                    <p className="kova-connection-overview">{selectedProfile.overview}</p>
                    <section
                      className="kova-connection-gallery"
                      aria-label="What this connector does"
                    >
                      {selectedProfile.gallery ? (
                        selectedProfile.gallery.map((image) => (
                          <figure key={image.src}>
                            <img src={image.src} alt={image.alt} loading="lazy" />
                            <figcaption className="kova-connection-prompt">
                              {image.caption}
                            </figcaption>
                          </figure>
                        ))
                      ) : (
                        <>
                          {selectedProfile.example && (
                            <figure>
                              <p>{selectedProfile.exampleResult}</p>
                              <figcaption className="kova-connection-prompt">
                                {selectedProfile.example}
                              </figcaption>
                            </figure>
                          )}
                          {selectedProfile.write.length > 0 && (
                            <figure>
                              <ul>
                                {selectedProfile.write.slice(0, 3).map((label) => (
                                  <li key={label}>{label}</li>
                                ))}
                              </ul>
                              <figcaption>Optional write access</figcaption>
                            </figure>
                          )}
                        </>
                      )}
                    </section>
                    {configuredOf(visibleSelectedApp.id) && (
                      <section
                        className="kova-connection-account"
                        aria-labelledby="connection-account-title"
                      >
                        <h2 id="connection-account-title">
                          <Settings aria-hidden="true" /> Connector setup
                        </h2>
                        {["gmail", "google-docs"].includes(visibleSelectedApp.id) &&
                          tierStatus === "ready" &&
                          tier === "free" && (
                            <p role="status" className="spec400-plugin-notice">
                              {visibleSelectedApp.label} requires Kova Plus or Pro.
                            </p>
                          )}
                        {!isSignedIn ? (
                          <section className="spec400-plugin-detail-section">
                            <h3>Account</h3>
                            <p>
                              Sign in to Kova before connecting an account. You’ll choose the
                              provider account after selecting Connect.
                            </p>
                            {CONFIGURED_CONNECTORS.has(visibleSelectedApp.id) && (
                              <SignInButton mode="modal">
                                <Button>Sign in to connect</Button>
                              </SignInButton>
                            )}
                          </section>
                        ) : isGoogleId(visibleSelectedApp.id) ? (
                          <section
                            ref={googleStatusRef}
                            className="spec400-plugin-detail-section"
                            role="region"
                            aria-label="Google connection status"
                            aria-busy={visibleGoogleLoading || googleBusy}
                            tabIndex={-1}
                          >
                            <h3 id="google-accounts-title">Google accounts</h3>
                            <p>
                              Choose the account for new Gmail, Calendar and Drive requests.
                              Existing confirmed actions remain bound to their original account.
                            </p>
                            {visibleGoogleLoading || googleBusy ? (
                              <p role="status">Updating Google accounts…</p>
                            ) : null}
                            {visibleGoogleStatus?.state === "temporarily_unavailable" && (
                              <p role="status">
                                Google account status is unavailable. Refresh to try again.
                              </p>
                            )}
                            {visibleGoogleStatus?.state === "reauthorization_required" && (
                              <p role="status">
                                Your connection record is retained, but Google authorization has
                                expired or was revoked. Reconnect to restore access.
                              </p>
                            )}
                            {stateOf(visibleSelectedApp.id) === "permission_incomplete" && (
                              <p role="status">
                                Some requested permissions are missing. Reconnect and review the
                                required access.
                              </p>
                            )}
                            {(visibleGoogleStatus?.accounts?.length ?? 0) > 0 ? (
                              <ul className="spec400-plugin-account-list">
                                {visibleGoogleStatus!.accounts!.map((account) => {
                                  const { read, write } = googleServiceAccess(
                                    visibleSelectedApp.id,
                                    account,
                                  );
                                  return (
                                    <li key={account.id}>
                                      <div className="spec400-plugin-account-heading">
                                        <strong>{account.email || "Google account"}</strong>
                                        <span>
                                          {account.id === visibleGoogleStatus?.selectedConnectionId
                                            ? "Selected for new requests · "
                                            : ""}
                                          {account.connected
                                            ? "Google authorization active"
                                            : account.state.replaceAll("_", " ")}
                                        </span>
                                      </div>
                                      {account.connected && read !== undefined && (
                                        <p>
                                          Read {read ? "granted" : "not granted"}
                                          {write !== undefined &&
                                            ` · Provider write scope ${write ? "granted" : "not granted"}`}
                                        </p>
                                      )}
                                      <div className="spec400-plugin-scope-list">
                                        <h4>Current permission scope</h4>
                                        {account.scopes?.length ? (
                                          <ul>
                                            {account.scopes.map((scope) => (
                                              <li key={scope}>{scope}</li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p>
                                            No scopes reported. Refresh the account status before
                                            relying on access.
                                          </p>
                                        )}
                                      </div>
                                      <div className="spec400-plugin-actions">
                                        {account.connected &&
                                          read &&
                                          (visibleSelectedApp.id === "gmail" ||
                                            visibleSelectedApp.id === "google-calendar" ||
                                            visibleSelectedApp.id === "google-drive") && (
                                            <ConnectorWriteControls
                                              connector={visibleSelectedApp.id}
                                              target={account.id}
                                              label={account.email || visibleSelectedApp.label}
                                              providerCanWrite={write === true}
                                              authorizeWrite={() =>
                                                void connectGoogle(
                                                  account.id,
                                                  visibleSelectedApp.id,
                                                  "read-write",
                                                )
                                              }
                                            />
                                          )}
                                        <Button
                                          variant="outline"
                                          className="spec400-plugin-use-account"
                                          disabled={
                                            googleBusy ||
                                            visibleGoogleLoading ||
                                            !account.connected ||
                                            account.id === visibleGoogleStatus?.selectedConnectionId
                                          }
                                          onClick={() =>
                                            void changeGoogleAccount("select", account.id)
                                          }
                                          aria-label={`Use ${account.email || "Google account"} for new requests`}
                                        >
                                          Use account
                                        </Button>
                                        <Button
                                          variant="outline"
                                          disabled={
                                            googleBusy ||
                                            visibleGoogleLoading ||
                                            (visibleSelectedApp.id === "gmail" &&
                                              (tierStatus !== "ready" || tier === "free"))
                                          }
                                          onClick={() =>
                                            void connectGoogle(account.id, visibleSelectedApp.id)
                                          }
                                          aria-label={`Reconnect ${account.email || "Google account"}`}
                                        >
                                          Reconnect
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          disabled={googleBusy || visibleGoogleLoading}
                                          onClick={(event) => {
                                            googleDisconnectReturnRef.current = {
                                              trigger: event.currentTarget,
                                              url: window.location.href,
                                              principal: principalRef.current,
                                              generation: generationRef.current,
                                            };
                                            setPendingGoogleDisconnect({
                                              id: account.id,
                                              email: account.email || "Google account",
                                            });
                                          }}
                                          aria-label={`Disconnect ${account.email || "Google account"}`}
                                        >
                                          Disconnect
                                        </Button>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : !visibleGoogleLoading &&
                              visibleGoogleStatus?.state !== "temporarily_unavailable" ? (
                              <p>
                                No Google accounts are connected. You’ll choose the account on
                                Google’s sign-in screen.
                              </p>
                            ) : null}
                            <div className="spec400-plugin-actions">
                              <Button
                                disabled={
                                  googleBusy ||
                                  visibleGoogleLoading ||
                                  (visibleSelectedApp.id === "gmail" &&
                                    (tierStatus !== "ready" || tier === "free")) ||
                                  visibleGoogleStatus?.state === "temporarily_unavailable"
                                }
                                onClick={() => void handleConnect(visibleSelectedApp)}
                              >
                                {["reauthorize", "permission_incomplete"].includes(
                                  stateOf(visibleSelectedApp.id),
                                )
                                  ? "Reconnect"
                                  : (visibleGoogleStatus?.accounts?.length ?? 0) > 0
                                    ? "Connect another account"
                                    : "Connect"}
                              </Button>
                              <Button
                                variant="outline"
                                disabled={googleBusy || visibleGoogleLoading}
                                onClick={refreshGoogleStatus}
                              >
                                Refresh status
                              </Button>
                              {isGoogleConnected(visibleSelectedApp.id) && (
                                <Button
                                  variant="ghost"
                                  onClick={() => handleUseInChat(visibleSelectedApp)}
                                >
                                  Use in chat
                                </Button>
                              )}
                            </div>
                          </section>
                        ) : visibleSelectedApp.id === "github" ? (
                          <GitHubManager
                            key={principal ?? "unresolved"}
                            data={visibleGithubData}
                            loadError={githubLoadError}
                            reload={refreshGitHub}
                          />
                        ) : NATIVE_HEALTH_IDS.has(visibleSelectedApp.id) ||
                          visibleSelectedApp.id === "oura" ||
                          visibleSelectedApp.id === "plaid" ? (
                          <Button
                            onClick={() => {
                              const id = visibleSelectedApp.id;
                              const view = id === "plaid" ? "finances" : "health";
                              void navigate({
                                search: {
                                  connection_view: view,
                                  ...(id === "oura" && { health_provider: id }),
                                } as never,
                              });
                            }}
                          >
                            {visibleSelectedApp.id === "plaid" ? "Open Finances" : "Open Health"}
                          </Button>
                        ) : visibleSelectedApp.id === "excalidraw" ? (
                          <section className="spec400-plugin-detail-section">
                            <h3>Use Excalidraw files in chat</h3>
                            <p>
                              Attach a .excalidraw file to share the diagram’s text and layout
                              summary. To export a Kova sketch, open Drawing and choose Download
                              Excalidraw file.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button onClick={() => void navigate({ to: "/" })}>Open chat</Button>
                              <ExcalidrawExportButton />
                            </div>
                          </section>
                        ) : visibleSelectedApp.id === "notion" && notionKeyConfigured ? (
                          <>
                            {notionOAuthConfigured && (
                              <ConnectedAccountManager
                                key={`${principal}:notion`}
                                id="notion"
                                data={otherConnections.data}
                                loading={otherConnections.loading}
                                error={otherConnections.error}
                                reload={otherConnections.reload}
                              />
                            )}
                            <ConnectedAccountManager
                              key={`${principal}:notion-private`}
                              id="notion-private"
                              data={otherConnections.data}
                              loading={otherConnections.loading}
                              error={otherConnections.error}
                              reload={otherConnections.reload}
                            />
                          </>
                        ) : CONNECTION_FLOWS[visibleSelectedApp.id] ? (
                          <ConnectedAccountManager
                            key={`${principal}:${visibleSelectedApp.id}`}
                            id={visibleSelectedApp.id}
                            initiallySearchTeamsMessages={teamsMessagesAfterConsent}
                            data={otherConnections.data}
                            loading={otherConnections.loading}
                            error={otherConnections.error}
                            reload={otherConnections.reload}
                          />
                        ) : null}
                        <section className="spec400-plugin-detail-section">
                          <h3>Recent activity</h3>
                          {visibleActivity.filter((entry) =>
                            [
                              visibleSelectedApp.label,
                              ...(isGoogleId(visibleSelectedApp.id) ? ["Google"] : []),
                            ].includes(entry.app),
                          ).length ? (
                            <ul className="spec400-plugin-activity">
                              {visibleActivity
                                .filter((entry) =>
                                  [
                                    visibleSelectedApp.label,
                                    ...(isGoogleId(visibleSelectedApp.id) ? ["Google"] : []),
                                  ].includes(entry.app),
                                )
                                .slice(0, 5)
                                .map((entry, index) => (
                                  <li key={`${entry.at}:${index}`}>
                                    {entry.action} · {new Date(entry.at).toLocaleString()}
                                  </li>
                                ))}
                            </ul>
                          ) : (
                            <p>No recorded connection activity.</p>
                          )}
                        </section>
                      </section>
                    )}
                  </TabsContent>
                  <TabsContent value="access" forceMount className="kova-connection-tab">
                    <section
                      className="kova-connection-permissions"
                      aria-labelledby="connection-permissions"
                    >
                      <h2 id="connection-permissions">Capabilities and permissions</h2>
                      {selectedProfile.read.length > 0 && (
                        <div>
                          <h3>Read access</h3>
                          <ul>
                            {selectedProfile.read.map((capability) => (
                              <li key={capability}>{capability}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selectedProfile.write.length > 0 && (
                        <div>
                          <h3>Optional write access</h3>
                          <ul>
                            {selectedProfile.write.map((capability) => (
                              <li key={capability}>{capability}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selectedProfile.availability === "planned" && (
                        <p>
                          {selectedProfile.availabilityNote ??
                            "Permissions become available when this connector launches."}
                        </p>
                      )}
                      {isGoogleId(visibleSelectedApp.id) && (
                        <p>Review the permissions on Google’s consent screen before approving.</p>
                      )}
                      {visibleSelectedApp.id === "github" && (
                        <p>
                          GitHub will ask you to choose an account and approve access. Kova uses
                          your authorized installations and explicitly granted repositories.
                        </p>
                      )}
                    </section>
                  </TabsContent>
                </div>
                <aside className="kova-connection-sidebar" aria-label="About this connection">
                  <dl className="kova-connection-info">
                    {selectedProfile.publisher && (
                      <div>
                        <dt>Developer</dt>
                        <dd className="kova-connection-publisher">
                          {selectedProfile.publisher}
                          {configuredOf(visibleSelectedApp.id) && (
                            <span className="kova-connection-verified">
                              <CircleCheck aria-hidden="true" /> Verified
                            </span>
                          )}
                          {stateOf(visibleSelectedApp.id) === "connected" && (
                            <span className="kova-connection-connected">
                              <Check aria-hidden="true" /> Connected
                            </span>
                          )}
                        </dd>
                      </div>
                    )}
                    {selectedProfile.read.length > 0 && (
                      <div>
                        <dt>Supported access</dt>
                        <dd>
                          {selectedProfile.write.length ? "Read and optional write" : "Read only"}
                        </dd>
                      </div>
                    )}
                    {/^[a-z0-9.-]+\.[a-z]{2,}$/u.test(visibleSelectedApp.domain) && (
                      <div>
                        <dt>Safety and access</dt>
                        <dd>Can send data to {visibleSelectedApp.domain}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Authorization</dt>
                      <dd>{selectedProfile.authorization}</dd>
                    </div>
                    <div>
                      <dt>Categories</dt>
                      <dd>
                        <span>{visibleSelectedApp.category}</span>
                      </dd>
                    </div>
                    {/^[a-z0-9.-]+\.[a-z]{2,}$/u.test(visibleSelectedApp.domain) && (
                      <div>
                        <dt>More information</dt>
                        <dd>
                          <a
                            href={`https://${visibleSelectedApp.domain}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Provider website <ArrowUpRight aria-hidden="true" />
                          </a>
                        </dd>
                      </div>
                    )}
                  </dl>
                </aside>
              </div>
            </Tabs>
            {related.length > 0 && (
              <section id="connection-related" tabIndex={-1} className="kova-connection-related">
                <h2>Related connections</h2>
                {renderGrid(related)}
              </section>
            )}
          </article>
        )}

        <ConfirmActionDialog
          open={
            activityReady &&
            isSignedIn &&
            Boolean(detailId && isGoogleId(detailId)) &&
            pendingGoogleDisconnect !== null
          }
          onOpenChange={(open) => !open && setPendingGoogleDisconnect(null)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const origin = googleDisconnectReturnRef.current;
            googleDisconnectReturnRef.current = null;
            restoreDialogFocus(
              origin?.trigger,
              origin?.url,
              origin?.principal !== principalRef.current ||
                origin?.generation !== generationRef.current,
            );
          }}
          title={`Disconnect ${pendingGoogleDisconnect?.email ?? "Google account"}?`}
          description="Gmail, Calendar and Drive access for this account will stop. Scheduled tasks or projects that depend on this account may fail until it is reconnected. Other connected accounts are unchanged."
          confirmLabel="Disconnect account"
          destructive
          disabled={googleBusy || visibleGoogleLoading}
          onConfirm={() => {
            const account = pendingGoogleDisconnect;
            setPendingGoogleDisconnect(null);
            if (account) void changeGoogleAccount("disconnect", account.id);
          }}
        >
          {activityReady && isSignedIn && userKey && pendingGoogleDisconnect && (
            <GoogleDisconnectSchedules
              key={`${principal}:${lifecycleVersion}:${pendingGoogleDisconnect.id}:${visibleGoogleStatus?.accounts?.find((account) => account.id === pendingGoogleDisconnect.id)?.connectionRevision}`}
              userId={userKey}
              connectionId={pendingGoogleDisconnect.id}
            />
          )}
        </ConfirmActionDialog>
        {!visibleSelectedApp && (
          <>
            <WorkspacePageHeader
              title="Connections"
              titleId="apps-title"
              description="Browse and manage the tools you use with KovaGPT."
              reference="kova.connections.header"
              actions={
                <Button asChild variant="outline">
                  <a href="/apps?directory=submissions">
                    Submissions <ArrowRight aria-hidden="true" />
                  </a>
                </Button>
              }
            />
            {activityPersistenceError && (
              <p role="status" className="spec400-plugin-notice">
                Recent connection activity could not be saved in this browser and will be lost when
                you leave or reload this page.
              </p>
            )}
            {!isLoaded ? (
              <section
                role="status"
                aria-label="Loading connections"
                className="spec400-plugin-grid"
              >
                {[1, 2, 3, 4, 5, 6].map((item) => (
                  <div
                    key={item}
                    aria-hidden="true"
                    className="spec400-plugin-skeleton animate-pulse motion-reduce:animate-none"
                  />
                ))}
              </section>
            ) : (
              <>
                {!isSignedIn && (
                  <section className="spec400-plugin-signin" aria-labelledby="apps-sign-in-title">
                    <LogIn aria-hidden="true" />
                    <div>
                      <h2 id="apps-sign-in-title">Sign in to connect tools</h2>
                      <p>
                        Browse available tools, then sign in to manage your accounts and
                        permissions.
                      </p>
                    </div>
                    <SignInButton mode="modal">
                      <Button variant="outline">Sign in</Button>
                    </SignInButton>
                  </section>
                )}
                <Tabs
                  value={connectionGroup ?? connectionFilter}
                  onValueChange={(value) => {
                    const view = value === "health" || value === "finances" ? value : null;
                    if (!view) setConnectionFilter(value);
                    const params = new URLSearchParams(searchString);
                    if (view) params.set("connection_view", view);
                    else params.delete("connection_view");
                    void navigate({ search: Object.fromEntries(params) as never, replace: true });
                  }}
                  className="spec400-plugin-directory"
                >
                  <TabsList className="spec400-plugin-tabs" aria-label="Connections">
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="connected">Connected</TabsTrigger>
                    <TabsTrigger value="health">Health</TabsTrigger>
                    <TabsTrigger value="finances">Finances</TabsTrigger>
                  </TabsList>
                  <div className="spec400-plugin-filters" hidden={connectionGroup !== null}>
                    <label className="spec400-plugin-search">
                      <span className="sr-only">Search connections</span>
                      <Search aria-hidden="true" />
                      <Input
                        ref={searchRef}
                        value={query}
                        maxLength={MAX_MANAGEMENT_QUERY_LENGTH}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search connections"
                      />
                    </label>
                    {category !== "all" && (
                      <Button
                        variant="outline"
                        onClick={() => setListPreferences({ category: "all" })}
                      >
                        {category} · Clear category
                      </Button>
                    )}
                  </div>
                  <TabsContent value={connectionFilter} className="spec400-plugin-results">
                    {connectedStatusUnverified && <p role="status">{connectedStatusMessage}</p>}
                    {filtered.length ? (
                      [0, 1, 2, 3].map((group) => {
                        const items = filtered.filter(
                          (item) => groupOf(item.id) === group && !featuredIds.has(item.id),
                        );
                        const recommended = group === 2 && featured.length > 0;
                        if (!items.length && !recommended) return null;
                        const label = [
                          "Connected",
                          "Reconnect required",
                          "Available",
                          "Coming soon",
                        ][group];
                        return (
                          <div key={group}>
                            {recommended && (
                              <section
                                className="spec400-plugin-status-group"
                                aria-labelledby="plugins-featured-title"
                              >
                                <h2 id="plugins-featured-title">Featured connections</h2>
                                {renderGrid(featured)}
                              </section>
                            )}
                            <section aria-label={label} className="spec400-plugin-status-group">
                              {connectionFilter === "all" && (
                                <div className="kova-directory-section-head">
                                  <h2>{group === 0 ? "Your connections" : label}</h2>
                                  {group === 0 && browsing && (
                                    <Button
                                      variant="ghost"
                                      onClick={() => setConnectionFilter("connected")}
                                    >
                                      Show all connected <ArrowRight aria-hidden="true" />
                                    </Button>
                                  )}
                                </div>
                              )}
                              {renderGrid(items, group === 0 || connectionFilter === "connected")}
                            </section>
                          </div>
                        );
                      })
                    ) : (
                      <section className="spec400-plugin-empty" aria-labelledby="apps-empty-title">
                        <Search aria-hidden="true" />
                        <h2 id="apps-empty-title">
                          {connectedStatusUnverified
                            ? connectionCountState === "checking"
                              ? "Checking connections"
                              : connectionCountState === "unavailable"
                                ? "Connection status unavailable"
                                : "Connection status unknown"
                            : connectionFilter === "connected" && !query
                              ? "No connections yet"
                              : "No matching connections"}
                        </h2>
                        <p>
                          {connectedStatusUnverified
                            ? connectionCountState === "checking"
                              ? "Wait for the current status check to finish."
                              : "Choose a plugin from All to review and refresh its connection status."
                            : connectionFilter === "connected" && !query
                              ? "Choose a plugin from All to review its permissions and connect an account."
                              : "Try another connection name."}
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setListPreferences({
                              query: "",
                              connectionFilter: "all",
                              category: "all",
                            });
                          }}
                        >
                          {connectionFilter === "connected"
                            ? "Browse all connections"
                            : "Clear filters"}
                        </Button>
                      </section>
                    )}
                    {connectionFilter === "all" && (
                      <>
                        {browsing && <PublishedConnectorListings />}
                        <section
                          className="kova-directory-categories"
                          aria-labelledby="plugin-categories-title"
                        >
                          <div className="kova-directory-section-head">
                            <h2 id="plugin-categories-title">Browse categories</h2>
                            {category !== "all" && (
                              <Button
                                variant="ghost"
                                onClick={() => setListPreferences({ category: "all" })}
                              >
                                Show all
                              </Button>
                            )}
                          </div>
                          <div className="kova-directory-category-grid">
                            {PLUGIN_CATEGORIES.map((item) => {
                              const Icon = categoryIcons[item] ?? Layers3;
                              return (
                                <Button
                                  key={item}
                                  variant={category === item ? "secondary" : "outline"}
                                  aria-pressed={category === item}
                                  onClick={() => {
                                    setListPreferences({
                                      category: item,
                                      query: "",
                                      connectionFilter: "all",
                                    });
                                    searchRef.current?.focus({ preventScroll: false });
                                  }}
                                >
                                  <Icon aria-hidden="true" /> {item}
                                </Button>
                              );
                            })}
                          </div>
                        </section>
                        <ConnectorDirectoryBuilder />
                      </>
                    )}
                  </TabsContent>
                  <TabsContent forceMount value="finances" className="spec400-connection-group">
                    <BankConnectionsPanel
                      key={`banks:${userKey ?? "guest"}`}
                      visible={connectionGroup === "finances"}
                      ownerId={isSignedIn ? userKey : null}
                    />
                  </TabsContent>
                  <TabsContent forceMount value="health" className="spec400-connection-group">
                    <HealthConnectionsPanel
                      key={`health:${userKey ?? "guest"}`}
                      visible={connectionGroup === "health"}
                      manageOura={
                        new URLSearchParams(searchString).get("health_provider") === "oura"
                      }
                      ownerId={isSignedIn ? userKey : null}
                      data={otherConnections.data}
                      loading={otherConnections.loading}
                      error={otherConnections.error}
                      reload={otherConnections.reload}
                    />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

function ExcalidrawExportButton() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={button} variant="outline" onClick={() => setOpen(true)}>
        Draw and export
      </Button>
      <ComposerDrawingDialog
        open={open}
        onOpenChange={setOpen}
        onReturnFocus={() => button.current?.focus()}
      />
    </>
  );
}
