import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CONNECTOR_CATALOG,
  connectorConnectFlow,
  type ConnectorItem,
} from "@/lib/connectors-catalog";
import { getGoogleStatus } from "@/lib/google-client";
import { getGitHubManagement } from "@/lib/github.functions";
import { authFetch } from "@/lib/auth-fetch";
import { Plug } from "lucide-react";
import {
  composerPluginConnection,
  rankConnectedComposerPlugins,
  type ComposerConnectionSnapshot,
  type ComposerSavedConversation,
} from "@/lib/composer-plugin-usage.mjs";

/** Inspection only: opening a plugin never grants access or executes an action. */
export function ComposerPluginList({
  userId,
  authLoaded,
  onNavigate,
  conversations,
  onRequireSignIn,
  navigationBlocked = false,
}: {
  userId: string | null;
  authLoaded: boolean;
  onNavigate: () => void;
  /** Only the current, principal-ready account’s saved conversations. */
  conversations: readonly ComposerSavedConversation[];
  onRequireSignIn: (pluginId: string) => void;
  navigationBlocked?: boolean;
}) {
  const readGitHub = useServerFn(getGitHubManagement);
  const [snapshot, setSnapshot] = useState<ComposerConnectionSnapshot | null>(null);
  useEffect(() => {
    if (!userId || !authLoaded) {
      setSnapshot(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setSnapshot({ principal: userId, loading: true });
    void Promise.allSettled([
      getGoogleStatus(userId),
      readGitHub(),
      authFetch("/api/github/tool", { signal: controller.signal }).then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.ok || !["none", "view", "write"].includes(body.access_mode))
          throw new Error("Access unavailable");
        return body.access_mode as "none" | "view" | "write";
      }),
    ]).then(([google, github, access]) => {
      if (!active) return;
      setSnapshot({
        principal: userId,
        loading: false,
        google: google.status === "fulfilled" ? google.value : undefined,
        github: github.status === "fulfilled" ? github.value : undefined,
        githubAccess: access.status === "fulfilled" ? access.value : undefined,
      });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [userId, authLoaded, readGitHub]);
  const blockedNavigationTitle = "Finish or clear your current message before opening plugins.";
  const handleNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (navigationBlocked) {
      event.preventDefault();
      return;
    }
    onNavigate();
  };
  const plugins = CONNECTOR_CATALOG.filter(
    (plugin) => plugin.id !== "google" && connectorConnectFlow(plugin) !== null,
  );
  const connection = (id: string) => composerPluginConnection(id, { userId, authLoaded, snapshot });
  const connected = rankConnectedComposerPlugins(
    authLoaded && userId ? conversations : [],
    plugins.filter((plugin) => connection(plugin.id).connected).map((plugin) => plugin.id),
  );
  const recommended = plugins.filter((plugin) => !connection(plugin.id).connected);
  const hasRequests = connected.some((plugin) => plugin.count > 0);
  const row = (plugin: ConnectorItem, count?: number) => {
    const status = connection(plugin.id);
    const contents = (
      <>
        <Plug className="kova-composer-plugin-logo" aria-hidden="true" />
        <span>
          <span>{plugin.label}</span>
          <small>{status.label}</small>
        </span>
        {count === undefined && <span>{status.action}</span>}
      </>
    );
    const title = `Review ${plugin.label} connection and permissions`;
    // Guests have no route link or preload: clicking only asks the parent to sign in.
    if (!authLoaded || !userId)
      return (
        <button
          key={plugin.id}
          type="button"
          className="kova-composer-plugin"
          disabled={!authLoaded}
          onClick={() => {
            if (authLoaded && !userId) onRequireSignIn(plugin.id);
          }}
          title={title}
        >
          {contents}
        </button>
      );
    return (
      <Link
        key={plugin.id}
        to="/apps"
        preload={false}
        className="kova-composer-plugin"
        onClick={handleNavigate}
        aria-disabled={navigationBlocked || undefined}
        title={navigationBlocked ? blockedNavigationTitle : title}
      >
        {contents}
      </Link>
    );
  };
  return (
    <section className="kova-composer-plugins" aria-label="Supported plugins">
      <div className="kova-composer-plugin-list">
        {connected.length > 0 && (
          <>
            <h3
              title={
                hasRequests
                  ? "Order reflects saved requests; execution success is unverified."
                  : undefined
              }
            >
              Your plugins
            </h3>
            {connected.map(({ id, count }) =>
              row(
                plugins.find((plugin) => plugin.id === id)!,
                count,
              ),
            )}
          </>
        )}
        {recommended.length > 0 && (
          <>
            <h3>Recommended plugins</h3>
            {recommended.map((plugin) => row(plugin))}
          </>
        )}
      </div>
      <Link
        to="/apps"
        preload={false}
        className="kova-composer-action"
        onClick={handleNavigate}
        aria-disabled={navigationBlocked || undefined}
        title={navigationBlocked ? blockedNavigationTitle : undefined}
      >
        Browse all plugins
      </Link>
    </section>
  );
}
