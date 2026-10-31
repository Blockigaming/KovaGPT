import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { GOOGLE_CONNECT_IDS, type ConnectorItem } from "@/lib/connectors-catalog";
import {
  LAUNCH_PLUGIN_REVIEW_CATALOG,
  getPluginReview,
  getPluginPreviewProvider,
} from "@/lib/plugin-review-catalog";
import {
  Search,
  Check,
  Loader2,
  ShieldAlert,
  PanelsTopLeft,
  AlertCircle,
  LogIn,
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
import { ConnectedAccountManager } from "@/components/ConnectedAccountManager";
import { BankConnectionsPanel } from "@/components/BankConnectionsPanel";
import { HealthConnectionsPanel } from "@/components/HealthConnectionsPanel";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import {
  CONNECTION_FLOWS,
  canReadConnection,
  connectionAccounts,
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
import { WorkflowSkillsPanel } from "@/components/WorkflowSkillsPanel";
import { DialogFooter } from "@/components/ui/dialog";
import {
  getGoogleStatus,
  startGoogleConnect,
  disconnectGoogleAccount,
  selectGoogleAccount,
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
  ...Object.keys(CONNECTION_FLOWS),
]);

const CONFIGURED_CONNECTORS = WORKING_IDS;
const PLUGIN_CATEGORIES = [
  ...new Set(LAUNCH_PLUGIN_REVIEW_CATALOG.map((entry) => entry.connector.category)),
].sort();
const parsePluginFilters = (raw: string | null) =>
  parsePluginListPreferences(raw, PLUGIN_CATEGORIES);

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
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "expired"
  | "reauthorize"
  | "permission_incomplete"
  | "syncing"
  | "temporarily_unavailable";

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
    <span className="spec400-plugin-logo" aria-hidden="true">
      {asset ? <img src={asset} alt="" /> : <PanelsTopLeft />}
    </span>
  );
}

function StatusBadge({ state, configured }: { state: ConnState; configured: boolean }) {
  const labels: Record<ConnState, string> = {
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
    <span className="spec400-plugin-status" data-state={configured ? state : "unavailable"}>
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
      {configured ? labels[state] : "Unavailable"}
    </span>
  );
}

function AppCard({
  item,
  state,
  configured,
  onDetails,
}: {
  item: ConnectorItem;
  state: ConnState;
  configured: boolean;
  onDetails: (trigger: HTMLButtonElement) => void;
}) {
  const pending = state === "connecting" || state === "syncing";
  const action =
    !configured || state === "temporarily_unavailable"
      ? "Unavailable"
      : state === "connected"
        ? "Manage"
        : ["expired", "reauthorize", "permission_incomplete", "failed"].includes(state)
          ? "Reconnect"
          : pending
            ? "Checking…"
            : "Connect";
  return (
    <li className="spec400-plugin-card" data-plugin-id={item.id}>
      <div className="spec400-plugin-card-heading">
        <AppLogo id={item.id} />
        <div>
          <h2>{item.label}</h2>
          <span className="spec400-plugin-category">{item.category}</span>
        </div>
      </div>
      <p className="spec400-plugin-purpose">{item.description}</p>
      <div className="spec400-plugin-card-footer">
        <StatusBadge state={state} configured={configured} />
        <Button
          type="button"
          variant="outline"
          onClick={(event) => onDetails(event.currentTarget)}
          aria-haspopup="dialog"
          aria-label={`${action} ${item.label}`}
          className="spec400-plugin-card-action"
        >
          {action}
        </Button>
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
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs">Unavailable</span>
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
        <DialogContent className="max-w-md">
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
              <li key={repo.id} className="flex min-h-12 items-center gap-3 p-3">
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
  const setQuery = (query: string) => setListPreferences({ query });
  const setCategory = (category: string) => setListPreferences({ category });
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
  const [selectedApp, setSelectedApp] = useState<ConnectorItem | null>(null);
  const detailsReturnRef = useRef<{
    trigger: HTMLButtonElement;
    url: string;
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
  const visibleSelectedApp = activityReady ? selectedApp : null;
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
    setSelectedApp(null);
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
      setSelectedApp(null);
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

  const connectGoogle = async (connectionId?: string, itemId = "gmail") => {
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
      await startGoogleConnect(connectionId, userKey, itemId === "google" ? "gmail" : itemId);
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
      const existing =
        visibleGoogleStatus?.state === "reauthorization_required" ||
        visibleGoogleStatus?.state === "permission_incomplete"
          ? (visibleGoogleStatus.selectedConnectionId ?? undefined)
          : undefined;
      await connectGoogle(existing, item.id);
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
  const selectedReview = visibleSelectedApp
    ? getPluginPreviewProvider(visibleSelectedApp.id)
    : undefined;

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
      const item = LAUNCH_PLUGIN_REVIEW_CATALOG.find(
        (entry) => entry.connector.id === id,
      )?.connector;
      if (item) setSelectedApp(item);
    }
    if (url.searchParams.has("integration_error"))
      toast.error(
        "The provider connection was not completed. Review the account status and try again.",
      );
    else toast.message("Authorization returned. Review the account and search to verify access.");
    for (const key of ["integration_connected", "integration_error", "connection_view"])
      url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url);
    void refreshOtherConnections();
  }, [activityReady, isSignedIn, refreshOtherConnections]);

  const configuredOf = (id: string) => {
    if (id === "github") return visibleGithubData?.configured !== false;
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
    if (!isSignedIn) return "idle";
    if (isGoogleId(id)) {
      if (visibleGoogleLoading || googleBusy) return "syncing";
      if (activityReady && connecting[id]) return "connecting";
      if (activityReady && failed[id]) return "failed";
      if (visibleGoogleStatus?.state === "temporarily_unavailable")
        return "temporarily_unavailable";
      if (visibleGoogleStatus?.state === "reauthorization_required") return "reauthorize";
      if (visibleGoogleStatus?.state === "permission_incomplete") return "permission_incomplete";
      if (isGoogleConnected(id)) return "connected";
      if (visibleGoogleStatus?.connected) return "permission_incomplete";
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
    if (CONNECTION_FLOWS[id]) {
      if (otherConnections.loading) return "syncing";
      if (otherConnections.error || !configuredOf(id)) return "temporarily_unavailable";
      const accounts = connectionAccounts(otherConnections.data?.accounts ?? [], id);
      if (accounts.some((account) => canReadConnection(account, id))) return "connected";
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
    if (CONNECTION_FLOWS[id])
      return connectionAccounts(otherConnections.data?.accounts ?? [], id).some(
        (account) =>
          account.status !== "revoked" &&
          hasConnectionScopes(account.granted_scopes, CONNECTION_FLOWS[id].scopes),
      );
    return false;
  };
  const catalog = LAUNCH_PLUGIN_REVIEW_CATALOG.map((entry) => entry.connector);
  const connectedCount = catalog.filter((item) => hasConnection(item.id)).length;
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
              .filter((id) => !CONNECTION_FLOWS[id] || configuredOf(id))
              .some((id) => stateOf(id) === "temporarily_unavailable")
          ? "unavailable"
          : !visibleGoogleStatus || !visibleGithubData
            ? "unknown"
            : "ready";
  const connectedCountLabel =
    connectionCountState === "ready"
      ? connectedCount
      : connectionCountState === "checking"
        ? "Checking…"
        : connectionCountState === "unavailable"
          ? "Unavailable"
          : "Unknown";
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
      !q || [c.label, c.description, c.category].some((value) => value.toLowerCase().includes(q))
    );
  });

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

  const renderGrid = (items: ConnectorItem[]) => (
    <ul className="spec400-plugin-grid" aria-label="Plugin directory">
      {items.map((item) => (
        <AppCard
          key={item.id}
          item={item}
          state={stateOf(item.id)}
          configured={configuredOf(item.id)}
          onDetails={(trigger) => {
            detailsReturnRef.current = {
              trigger,
              url: window.location.href,
              principal: principalRef.current,
            };
            setSelectedApp(item);
          }}
        />
      ))}
    </ul>
  );

  return (
    <AppShell hideUtilities>
      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="apps-title"
        className="kova-page kova-secondary-page spec400-plugins"
        data-ui-reference="chatgpt.apps.directory"
      >
        <Dialog open={!!visibleSelectedApp} onOpenChange={(open) => !open && setSelectedApp(null)}>
          <DialogContent
            className="spec400-plugin-detail"
            data-ui-reference="chatgpt.apps.details-dialog"
            closeLabel="Close connection details"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const origin = detailsReturnRef.current;
              restoreDialogFocus(
                origin?.trigger.isConnected ? origin.trigger : searchRef.current,
                origin?.url,
                origin?.principal !== principalRef.current,
              );
            }}
          >
            <DialogHeader>
              {visibleSelectedApp && <AppLogo id={visibleSelectedApp.id} />}
              <DialogTitle>{visibleSelectedApp?.label}</DialogTitle>
              <DialogDescription>{visibleSelectedApp?.description}</DialogDescription>
            </DialogHeader>
            {visibleSelectedApp && (
              <div className="spec400-plugin-detail-body">
                <StatusBadge
                  state={stateOf(visibleSelectedApp.id)}
                  configured={configuredOf(visibleSelectedApp.id)}
                />
                <section className="spec400-plugin-detail-section">
                  <h3>Capabilities and permissions</h3>
                  {selectedReview && (
                    <>
                      <ul className="spec400-plugin-permissions">
                        {selectedReview.permissions.map((permission) => (
                          <li key={permission}>{permission}</li>
                        ))}
                      </ul>
                      {!CONFIGURED_CONNECTORS.has(visibleSelectedApp.id) && (
                        <p className="spec400-plugin-notice">
                          This plugin is unavailable. Its listed capabilities are proposals. No
                          account is connected and no permissions have been requested.
                        </p>
                      )}
                    </>
                  )}
                  {isGoogleId(visibleSelectedApp.id) && (
                    <>
                      <p>
                        This connection requests your Google profile and email, plus only{" "}
                        {visibleSelectedApp.label} permissions:
                        {visibleSelectedApp.id === "gmail"
                          ? " read email, manage drafts, and send email."
                          : visibleSelectedApp.id === "google-calendar"
                            ? " read and edit calendar events."
                            : " read Drive files."}
                        Other Google services require their own Connect action. Previously approved
                        services remain connected.
                      </p>
                      <p>Review the permissions on Google’s consent screen before approving.</p>
                    </>
                  )}
                  {visibleSelectedApp.id === "github" && (
                    <p>
                      GitHub will ask you to choose an account and approve access. Only authorized
                      installations and explicitly granted repositories are available to Kova.
                    </p>
                  )}
                </section>
                {!isSignedIn ? (
                  <section className="spec400-plugin-detail-section">
                    <h3>Account</h3>
                    <p>
                      Sign in to Kova before connecting an account. You’ll choose the provider
                      account after selecting Connect.
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
                      Choose the account for new Gmail, Calendar and Drive requests. Existing
                      confirmed actions remain bound to their original account.
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
                        Your connection record is retained, but Google authorization has expired or
                        was revoked. Reconnect to restore access.
                      </p>
                    )}
                    {visibleGoogleStatus?.state === "permission_incomplete" && (
                      <p role="status">
                        Some requested permissions are missing. Reconnect and review the required
                        access.
                      </p>
                    )}
                    {(visibleGoogleStatus?.accounts?.length ?? 0) > 0 ? (
                      <ul className="spec400-plugin-account-list">
                        {visibleGoogleStatus!.accounts!.map((account) => (
                          <li key={account.id}>
                            <div className="spec400-plugin-account-heading">
                              <strong>{account.email || "Google account"}</strong>
                              <span>
                                {account.id === visibleGoogleStatus?.selectedConnectionId
                                  ? "Selected for new requests · "
                                  : ""}
                                {account.state.replaceAll("_", " ")}
                              </span>
                            </div>
                            <details className="spec400-plugin-scope-list">
                              <summary>Current permission scope</summary>
                              {account.scopes?.length ? (
                                <ul>
                                  {account.scopes.map((scope) => (
                                    <li key={scope}>{scope}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p>
                                  No scopes reported. Refresh the account status before relying on
                                  access.
                                </p>
                              )}
                            </details>
                            <div className="spec400-plugin-actions">
                              <Button
                                variant="outline"
                                className="spec400-plugin-use-account"
                                disabled={
                                  googleBusy ||
                                  visibleGoogleLoading ||
                                  !account.connected ||
                                  account.id === visibleGoogleStatus?.selectedConnectionId
                                }
                                onClick={() => void changeGoogleAccount("select", account.id)}
                                aria-label={`Use ${account.email || "Google account"} for new requests`}
                              >
                                Use account
                              </Button>
                              <Button
                                variant="outline"
                                disabled={googleBusy || visibleGoogleLoading}
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
                        ))}
                      </ul>
                    ) : !visibleGoogleLoading &&
                      visibleGoogleStatus?.state !== "temporarily_unavailable" ? (
                      <p>
                        No Google accounts are connected. You’ll choose the account on Google’s
                        sign-in screen.
                      </p>
                    ) : null}
                    <div className="spec400-plugin-actions">
                      <Button
                        disabled={
                          googleBusy ||
                          visibleGoogleLoading ||
                          visibleGoogleStatus?.state === "temporarily_unavailable"
                        }
                        onClick={() => void handleConnect(visibleSelectedApp)}
                      >
                        {visibleGoogleStatus?.state === "reauthorization_required" ||
                        visibleGoogleStatus?.state === "permission_incomplete"
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
                      {stateOf(visibleSelectedApp.id) === "connected" && (
                        <Button variant="ghost" onClick={() => handleUseInChat(visibleSelectedApp)}>
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
                ) : CONNECTION_FLOWS[visibleSelectedApp.id] ? (
                  <ConnectedAccountManager
                    key={`${principal}:${visibleSelectedApp.id}`}
                    id={visibleSelectedApp.id}
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
              </div>
            )}
          </DialogContent>
        </Dialog>
        <ConfirmActionDialog
          open={activityReady && isSignedIn && pendingGoogleDisconnect !== null}
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
        <WorkspacePageHeader
          title="Connections"
          titleId="apps-title"
          description="Connect tools and sources to Kova"
        />
        {activityPersistenceError && (
          <p role="status" className="spec400-plugin-notice">
            Recent connection activity could not be saved in this browser and will be lost when you
            leave or reload this page.
          </p>
        )}
        {!isLoaded ? (
          <section role="status" aria-label="Loading connections" className="spec400-plugin-grid">
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
                    Browse available tools, then sign in to manage your accounts and permissions.
                  </p>
                </div>
                <SignInButton mode="modal">
                  <Button variant="outline">Sign in</Button>
                </SignInButton>
              </section>
            )}
            <Tabs
              value={connectionFilter}
              onValueChange={setConnectionFilter}
              className="spec400-plugin-directory"
            >
              <TabsList className="spec400-plugin-tabs" aria-label="Connections">
                <TabsTrigger value="all">
                  All <span>{catalog.length}</span>
                </TabsTrigger>
                <TabsTrigger value="connected">
                  Connected <span>{connectedCountLabel}</span>
                </TabsTrigger>
              </TabsList>
              <div className="spec400-plugin-filters">
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
                <div className="spec400-plugin-category-filter">
                  <label htmlFor="plugin-category-filter">Category</label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="plugin-category-filter" className="w-auto min-w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {PLUGIN_CATEGORIES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <TabsContent value={connectionFilter} className="spec400-plugin-results">
                <p className="spec400-plugin-result-count" role="status">
                  {connectedStatusUnverified
                    ? connectedStatusMessage
                    : `${filtered.length} ${filtered.length === 1 ? "connection" : "connections"}${query ? ` matching “${query}”` : ""}`}
                </p>
                {filtered.length ? (
                  renderGrid(filtered)
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
                        : connectionFilter === "connected" && !query && category === "all"
                          ? "No connections yet"
                          : "No matching connections"}
                    </h2>
                    <p>
                      {connectedStatusUnverified
                        ? connectionCountState === "checking"
                          ? "Wait for the current status check to finish."
                          : "Choose a plugin from All to review and refresh its connection status."
                        : connectionFilter === "connected" && !query && category === "all"
                          ? "Choose a plugin from All to review its permissions and connect an account."
                          : "Try another name or category."}
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("");
                        setCategory("all");
                        setConnectionFilter("all");
                      }}
                    >
                      {connectionFilter === "connected"
                        ? "Browse all connections"
                        : "Clear filters"}
                    </Button>
                  </section>
                )}
              </TabsContent>
            </Tabs>
            <BankConnectionsPanel
              key={`banks:${userKey ?? "guest"}`}
              ownerId={isSignedIn ? userKey : null}
            />
            <HealthConnectionsPanel
              key={`health:${userKey ?? "guest"}`}
              ownerId={isSignedIn ? userKey : null}
              data={otherConnections.data}
              loading={otherConnections.loading}
              error={otherConnections.error}
              reload={otherConnections.reload}
            />
            {isSignedIn && (
              <details className="spec400-plugin-skills">
                <summary>Workflow skills</summary>
                {workflowSkillsAvailable ? (
                  <WorkflowSkillsPanel key={userKey!} userKey={userKey!} />
                ) : (
                  <section aria-labelledby="skills-title">
                    <h2 id="skills-title">Verify your email to use workflow skills</h2>
                    <p>
                      Verify your primary email, then refresh this page to create or use workflow
                      skills.
                    </p>
                    <Button
                      variant="outline"
                      disabled={verificationBusy || !user?.primaryEmailAddress?.emailAddress}
                      onClick={() => void resendWorkflowVerification()}
                    >
                      {verificationBusy ? "Sending…" : "Resend verification email"}
                    </Button>
                  </section>
                )}
              </details>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
