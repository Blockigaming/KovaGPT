// Client-safe descriptions of implemented read operations. Deployment readiness
// and the user's granted scopes are checked separately on the server.
export const CONNECTION_FLOWS = {
  outlook: {
    provider: "microsoft",
    scopes: ["Mail.Read"],
    tool: "outlook_search",
    label: "Outlook",
    description: "Search your Outlook mail.",
  },
  onedrive: {
    provider: "microsoft",
    scopes: ["Files.Read"],
    tool: "onedrive_search",
    label: "OneDrive",
    description: "Search files in your OneDrive.",
  },
  sharepoint: {
    provider: "microsoft",
    scopes: ["Sites.Read.All"],
    tool: "sharepoint_search",
    label: "SharePoint",
    description: "Find SharePoint sites you can access. Requires a work or school account.",
  },
  "ms-teams": {
    provider: "microsoft",
    scopes: ["Team.ReadBasic.All"],
    tool: "teams_search",
    label: "Microsoft Teams",
    description:
      "Find teams you have joined. Requires a work or school account; message search is not available.",
  },
  notion: {
    provider: "notion",
    scopes: [],
    tool: "notion_search",
    label: "Notion",
    description: "Find Notion pages by title among pages you explicitly share.",
  },
  linear: {
    provider: "linear",
    scopes: ["read"],
    tool: "linear_search",
    label: "Linear",
    description: "Find Linear issues by title.",
  },
  slack: {
    provider: "slack",
    scopes: ["search:read"],
    tool: "slack_search",
    label: "Slack",
    description: "Search Slack messages visible to your connected user.",
  },
};

export function hasConnectionScopes(scopes, required) {
  const granted = new Set(
    (scopes ?? []).map((scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//u, "")),
  );
  return required.every(
    (scope) => granted.has(scope) || (scope === "Files.Read" && granted.has("Files.Read.All")),
  );
}

export function connectionAccounts(accounts, id) {
  const flow = CONNECTION_FLOWS[id];
  return flow ? accounts.filter((account) => account.provider_id === flow.provider) : [];
}

export function canReadConnection(account, id, now = Date.now()) {
  const flow = CONNECTION_FLOWS[id];
  return Boolean(
    flow &&
    account.provider_id === flow.provider &&
    account.status === "connected" &&
    !account.deleted_at &&
    (!account.token_expires_at || Date.parse(account.token_expires_at) > now + 30_000) &&
    hasConnectionScopes(account.granted_scopes, flow.scopes),
  );
}

export function safeConnectionLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function connectionAuthorizationUrl(provider, value) {
  const endpoints = {
    microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    notion: "https://api.notion.com/v1/oauth/authorize",
    linear: "https://linear.app/oauth/authorize",
    slack: "https://slack.com/oauth/v2/authorize",
    oura: "https://cloud.ouraring.com/oauth/authorize",
    whoop: "https://api.prod.whoop.com/oauth/oauth2/auth",
  };
  try {
    const url = new URL(value),
      expected = new URL(endpoints[provider]);
    return !url.username &&
      !url.password &&
      url.origin === expected.origin &&
      url.pathname === expected.pathname
      ? url.href
      : null;
  } catch {
    return null;
  }
}
