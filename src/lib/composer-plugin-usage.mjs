// Exact read tools from google-tools.server.ts, connectors.server.ts,
// integrations/tools.ts and github-tool-policy.ts. Never infer requests from text,
// prefixes, approval preparation, or generic connector activity labels.
export const READ_ONLY_PLUGIN_TOOLS = Object.freeze({
  gmail_search: "gmail",
  gmail_read_message: "gmail",
  "gmail.search": "gmail",
  "gmail.read": "gmail",
  calendar_list_events: "google-calendar",
  "calendar.list": "google-calendar",
  drive_search: "google-drive",
  drive_read_file: "google-drive",
  "drive.search": "google-drive",
  "drive.read": "google-drive",
  "outlook.search_mail": "outlook",
  "onedrive.search": "onedrive",
  "slack.search": "slack",
  "notion.search": "notion",
  "linear.search_issues": "linear",
  github_read: "github",
  "github.search_code": "github",
  "github.file": "github",
  "github.tree": "github",
  "github.branches": "github",
  "github.commits": "github",
  "github.issues": "github",
  "github.pulls": "github",
  "github.releases": "github",
  "github.workflows": "github",
  "github.workflowRuns": "github",
  "github.checks": "github",
  "github.discussions": "github",
  "github.searchCode": "github",
});

/**
 * Counts saved read-tool request records, never execution success or provider calls.
 * The chat API stages activities before execution and can later label them done
 * even after tool failure. The composer also coalesces requests by tool/message.
 * These records therefore support "frequently requested", not "most used".
 */
export function rankConnectedComposerPlugins(conversations, connectedIds) {
  const counts = new Map(connectedIds.map((id) => [id, 0]));
  const seen = new Set();
  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    if (!conversation || conversation.temporary || !Array.isArray(conversation.messages)) continue;
    for (const message of conversation.messages) {
      if (
        message?.role !== "assistant" ||
        typeof message.id !== "string" ||
        !message.id ||
        !Array.isArray(message.activities)
      )
        continue;
      for (const activity of message.activities) {
        if (
          activity?.status !== "done" ||
          typeof activity.tool !== "string" ||
          !Object.hasOwn(READ_ONLY_PLUGIN_TOOLS, activity.tool)
        )
          continue;
        const id = READ_ONLY_PLUGIN_TOOLS[activity.tool];
        if (!counts.has(id)) continue;
        // Branches may share saved message IDs. The composer records one terminal
        // activity per tool/message, so replayed history must not inflate counts.
        const key = JSON.stringify([message.id, activity.tool]);
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(id, counts.get(id) + 1);
      }
    }
  }
  // Stable sort retains the supplied catalog order for ties, including no recorded requests.
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
}

const GOOGLE_CAPABILITIES = Object.freeze({
  gmail: "gmail",
  "google-calendar": "calendar",
  "google-drive": "drive",
});
const state = (label, connected = false, action = "Review") => ({ label, connected, action });

/** Fail closed when an account, permission, or connection DTO is unverified. */
export function composerPluginConnection(id, { userId, authLoaded, snapshot }) {
  if (!Object.hasOwn(GOOGLE_CAPABILITIES, id) && id !== "github") return state("Not available yet");
  if (!authLoaded) return state("Checking account…");
  if (!userId) return state("Log in to manage", false, "Connect");
  if (!snapshot || snapshot.principal !== userId || snapshot.loading !== false)
    return state("Checking connection…");
  if (id === "github") {
    const github = snapshot.github;
    if (!github || typeof github.configured !== "boolean") return state("Status unavailable");
    if (!github.configured) return state("Requires setup", false, "Review setup");
    if (github.health === "reconnect_required") return state("Reconnect required");
    if (
      !["healthy", "degraded"].includes(github.health) ||
      !Array.isArray(github.accounts) ||
      !Array.isArray(github.repositories)
    )
      return state("Status unavailable");
    if (!github.accounts.some((account) => ["connected", "degraded"].includes(account?.status)))
      return state("Not connected", false, "Connect");
    if (typeof snapshot.githubReadAccess !== "boolean") return state("Access unverified");
    if (
      !github.repositories.some(
        (repository) => repository?.explicitly_granted === true && repository.revoked_at === null,
      )
    )
      return state("Choose repositories");
    if (!snapshot.githubReadAccess) return state("Read access unavailable");
    if (github.health === "degraded") return state("Connection needs attention", true);
    return state("View only", true);
  }
  const google = snapshot.google;
  if (!google || google.state === "temporarily_unavailable") return state("Status unavailable");
  if (google.configured === false) return state("Requires setup", false, "Review setup");
  if (google.state === "reauthorization_required") return state("Reconnect required");
  if (google.state === "disconnected" && google.connected === false)
    return state("Not connected", false, "Connect");
  if (!["connected", "permission_incomplete"].includes(google.state) || google.connected !== true)
    return state("Status unavailable");
  const capability = GOOGLE_CAPABILITIES[id];
  if (typeof google.has?.[capability] !== "boolean") return state("Access unverified");
  if (!google.has[capability]) return state("More access needed", false, "Connect");
  if (capability !== "drive" && typeof google.has[`${capability}Write`] !== "boolean")
    return state("Access unverified");
  const canWrite =
    capability === "gmail"
      ? google.has.gmailWrite === true
      : capability === "calendar"
        ? google.has.calendarWrite === true
        : false;
  return state(canWrite ? "View + write · approval required" : "View only", true);
}
