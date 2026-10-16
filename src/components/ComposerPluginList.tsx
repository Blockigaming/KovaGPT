import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  LAUNCH_PLUGIN_CATALOG,
  GOOGLE_CONNECT_IDS,
  connectorUnavailableReason,
} from "@/lib/connectors-catalog";
import { getGoogleStatus, type GoogleStatus } from "@/lib/google-client";
import { getGitHubManagement, type GitHubManagement } from "@/lib/github.functions";
import { authFetch } from "@/lib/auth-fetch";
import { PluginLogo } from "@/components/PluginLogo";

type ConnectionSnapshot = {
  principal: string;
  google?: GoogleStatus;
  github?: GitHubManagement;
  githubAccess?: "none" | "view" | "write";
  loading: boolean;
};

/** Inspection only: opening a plugin never grants access or executes an action. */
export function ComposerPluginList({
  userId,
  authLoaded,
  onNavigate,
}: {
  userId: string | null;
  authLoaded: boolean;
  onNavigate: () => void;
}) {
  const readGitHub = useServerFn(getGitHubManagement);
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null);
  useEffect(() => {
    if (!userId || !authLoaded) return;
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
  const current = snapshot?.principal === userId ? snapshot : null;
  const status = (id: string): string => {
    if (!GOOGLE_CONNECT_IDS.has(id) && id !== "github") return "Not available yet";
    if (!authLoaded) return "Checking account…";
    if (!userId) return "Log in to manage";
    if (!current || current.loading) return "Checking connection…";
    if (id === "github") {
      const github = current.github;
      if (!github) return "Status unavailable";
      if (!github.configured) return "Requires setup";
      if (github.health === "reconnect_required") return "Reconnect required";
      if (!github.accounts.some((account) => ["connected", "degraded"].includes(account.status)))
        return "Not connected";
      if (!current.githubAccess) return "Access unverified";
      if (current.githubAccess === "none") return "Disabled";
      if (
        !github.repositories.some(
          (repository) => repository.explicitly_granted && !repository.revoked_at,
        )
      )
        return "Choose repositories";
      if (github.health === "degraded") return "Connection needs attention";
      return current.githubAccess === "write" ? "View + write · approval required" : "View only";
    }
    const google = current.google;
    if (!google || google.state === "temporarily_unavailable") return "Status unavailable";
    if (google.configured === false) return "Requires setup";
    if (google.state === "reauthorization_required") return "Reconnect required";
    if (!google.connected) return "Not connected";
    const capability = id === "gmail" ? "gmail" : id === "google-calendar" ? "calendar" : "drive";
    if (!google.has?.[capability]) return "More access needed";
    const canWrite =
      capability === "gmail"
        ? google.has.gmailWrite
        : capability === "calendar"
          ? google.has.calendarWrite
          : false;
    return canWrite ? "View + write · approval required" : "View only";
  };
  return (
    <section className="kova-composer-plugins" aria-label="Supported plugins">
      <h3>Plugins</h3>
      <div className="kova-composer-plugin-list">
        {LAUNCH_PLUGIN_CATALOG.map((plugin) => (
          <Link
            key={plugin.id}
            to="/apps"
            search={{ plugin: plugin.id }}
            className="kova-composer-plugin"
            onClick={onNavigate}
            title={
              GOOGLE_CONNECT_IDS.has(plugin.id) || plugin.id === "github"
                ? `Manage ${plugin.label} connection and permissions`
                : connectorUnavailableReason(plugin)
            }
          >
            <PluginLogo id={plugin.id} label={plugin.label} className="kova-composer-plugin-logo" />
            <span>
              <span>{plugin.label}</span>
              <small>{status(plugin.id)}</small>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
