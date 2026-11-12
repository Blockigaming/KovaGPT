import { useEffect, useState, type MouseEvent } from "react";
import { ChevronRight, Plug, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CONNECTOR_CATALOG,
  connectorConnectFlow,
  type ConnectorItem,
} from "@/lib/connectors-catalog";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import { CONNECTION_FLOWS, canReadConnection } from "@/integrations/connection-flows.mjs";
import { getGoogleStatus } from "@/lib/google-client";
import { getGitHubChatReadAccess, getGitHubManagement } from "@/lib/github.functions";
import { PLUGIN_BRAND_ASSET_URLS } from "@/lib/plugin-review-catalog";
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
  inline = false,
  navigationBlocked = false,
}: {
  userId: string | null;
  authLoaded: boolean;
  onNavigate: () => void;
  /** Only the current, principal-ready account’s saved conversations. */
  conversations: readonly ComposerSavedConversation[];
  onRequireSignIn?: () => void;
  inline?: boolean;
  navigationBlocked?: boolean;
}) {
  const accounts = useConnectedAccounts(userId, authLoaded && Boolean(userId));
  const readGitHub = useServerFn(getGitHubManagement);
  const readGitHubAccess = useServerFn(getGitHubChatReadAccess);
  const [snapshot, setSnapshot] = useState<ComposerConnectionSnapshot | null>(null);
  const [pluginQuery, setPluginQuery] = useState("");
  useEffect(() => {
    if (!userId || !authLoaded) {
      setSnapshot(null);
      return;
    }
    let active = true;
    setSnapshot({ principal: userId, loading: true });
    void Promise.allSettled([getGoogleStatus(userId), readGitHub(), readGitHubAccess()]).then(
      ([google, github, access]) => {
        if (!active) return;
        setSnapshot({
          principal: userId,
          loading: false,
          google: google.status === "fulfilled" ? google.value : undefined,
          github: github.status === "fulfilled" ? github.value : undefined,
          githubReadAccess: access.status === "fulfilled" ? access.value.readable : undefined,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [userId, authLoaded, readGitHub, readGitHubAccess]);
  const blockedNavigationTitle = "Finish or clear your current message before opening plugins.";
  const handleNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (navigationBlocked) {
      event.preventDefault();
      return;
    }
    onNavigate();
  };
  const normalizedQuery = pluginQuery.trim().toLocaleLowerCase();
  const plugins = CONNECTOR_CATALOG.filter(
    (plugin) =>
      plugin.id !== "google" &&
      connectorConnectFlow(plugin) !== null &&
      (normalizedQuery === "" || plugin.label.toLocaleLowerCase().includes(normalizedQuery)),
  );
  const connection = (id: string) => {
    if (Object.hasOwn(CONNECTION_FLOWS, id)) {
      const flow = CONNECTION_FLOWS[id as keyof typeof CONNECTION_FLOWS];
      const connected =
        !accounts.loading &&
        !accounts.error &&
        accounts.data?.configuredProviders.some((provider) => provider.id === flow.provider) &&
        accounts.data.accounts.some((account) => canReadConnection(account, id));
      return { connected: Boolean(connected), label: "Connected", action: "Review" };
    }
    return composerPluginConnection(id, { userId, authLoaded, snapshot });
  };
  const connected = rankConnectedComposerPlugins(
    authLoaded && userId ? conversations : [],
    plugins.filter((plugin) => connection(plugin.id).connected).map((plugin) => plugin.id),
  );

  const row = (plugin: ConnectorItem) => (
    <Link
      key={plugin.id}
      to="/apps"
      preload={false}
      className="kova-composer-plugin"
      onClick={handleNavigate}
      aria-disabled={navigationBlocked || undefined}
      title={
        navigationBlocked
          ? blockedNavigationTitle
          : `Review ${plugin.label} connection and permissions`
      }
    >
      <img
        src={PLUGIN_BRAND_ASSET_URLS[plugin.id === "outlook-calendar" ? "outlook" : plugin.id]}
        className="kova-composer-plugin-logo"
        alt=""
      />
      <span>{plugin.label}</span>
      {inline ? (
        <small>{CONNECTION_FLOWS[plugin.id]?.description ?? plugin.description}</small>
      ) : null}
    </Link>
  );
  if (inline)
    return connected.length ? (
      <div className="kova-composer-plugins" aria-label="Your connected plugins">
        {connected.map(({ id }) => row(plugins.find((plugin) => plugin.id === id)!))}
      </div>
    ) : null;

  return (
    <section className="kova-composer-plugins" aria-label="Your connected plugins">
      <label className="kova-composer-menu-search">
        <Search aria-hidden="true" />
        <span className="sr-only">Search plugins</span>
        <input
          type="search"
          aria-label="Search plugins"
          placeholder="Search plugins…"
          value={pluginQuery}
          onChange={(event) => setPluginQuery(event.target.value)}
          className="w-full bg-transparent text-sm"
        />
      </label>
      <div className="kova-composer-plugin-list">
        {connected.length === 0 ? (
          <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
            {!authLoaded || snapshot?.loading || accounts.loading
              ? "Loading your plugins…"
              : normalizedQuery
                ? "No matching connected plugins."
                : "No connected plugins."}
          </p>
        ) : null}
        {connected.map(({ id }) => row(plugins.find((plugin) => plugin.id === id)!))}
      </div>
      {userId ? (
        <Link
          to="/apps"
          preload={false}
          className="kova-composer-action"
          onClick={handleNavigate}
          aria-disabled={navigationBlocked || undefined}
          title={navigationBlocked ? blockedNavigationTitle : undefined}
        >
          <Plug aria-hidden="true" />
          <span>Connect plugins</span>
          <ChevronRight aria-hidden="true" className="ml-auto" />
        </Link>
      ) : (
        <button
          type="button"
          className="kova-composer-action"
          onClick={onRequireSignIn}
          disabled={!authLoaded}
        >
          <Plug aria-hidden="true" /> Connect plugins
        </button>
      )}
    </section>
  );
}
