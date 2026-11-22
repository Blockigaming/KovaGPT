// Client-safe descriptions of implemented read operations. Deployment readiness
// and the user's granted scopes are checked separately on the server.
export const CONNECTION_FLOWS = {
  canva: {
    provider: "canva",
    scopes: ["design:meta:read"],
    tool: "canva_search",
    label: "Canva",
    description: "Search accessible Canva designs by title and return design metadata.",
  },
  figma: {
    provider: "figma",
    scopes: ["file_metadata:read"],
    tool: "figma_get_file",
    label: "Figma",
    description: "Read Figma file metadata for a supplied Figma design URL or file key.",
  },
  box: {
    provider: "box",
    scopes: ["root_readonly"],
    tool: "box_search",
    label: "Box",
    description: "Search Box files you can access. Returns file names, descriptions and links.",
  },
  salesforce: {
    provider: "salesforce",
    scopes: ["api"],
    tool: "salesforce_search",
    label: "Salesforce",
    description:
      "Search Salesforce accounts, contacts or opportunities allowed by your Salesforce role. Read-only; choose the record type explicitly.",
  },
  outlook: {
    provider: "microsoft",
    scopes: ["Mail.Read"],
    tool: "outlook_search",
    label: "Outlook",
    description: "Search your Outlook mail.",
  },
  "outlook-calendar": {
    provider: "microsoft",
    scopes: ["Calendars.ReadBasic"],
    tool: "outlook_calendar_search",
    label: "Outlook Calendar",
    description:
      "Find events whose subject starts with your search in your default Outlook calendar. Returns event titles and times, including series masters; recurring instances are not expanded. Read-only.",
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
    description: "Find teams you have joined. Requires a work or school account.",
  },
  "ms-teams-messages": {
    provider: "microsoft",
    scopes: ["Chat.Read"],
    tool: "teams_message_search",
    label: "Teams chat messages",
    description: "Search Teams chat messages visible to the connected work or school account.",
  },
  notion: {
    provider: "notion",
    scopes: [],
    tool: "notion_search",
    label: "Notion",
    description:
      "Find shared Notion pages by title, or pass the page ID returned by a previous search to read its Markdown content.",
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
    (scope) =>
      granted.has(scope) ||
      (scope === "root_readonly" && granted.has("root_readwrite")) ||
      (scope === "Chat.Read" && granted.has("Chat.ReadWrite")) ||
      (scope === "Files.Read" && granted.has("Files.Read.All")) ||
      (scope === "Calendars.ReadBasic" &&
        (granted.has("Calendars.Read") || granted.has("Calendars.ReadWrite"))),
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
    box: "https://account.box.com/api/oauth2/authorize",
    canva: "https://www.canva.com/api/oauth/authorize",
    figma: "https://www.figma.com/oauth",
    microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    notion: "https://api.notion.com/v1/oauth/authorize",
    linear: "https://linear.app/oauth/authorize",
    slack: "https://slack.com/oauth/v2/authorize",
    oura: "https://cloud.ouraring.com/oauth/authorize",
    whoop: "https://api.prod.whoop.com/oauth/oauth2/auth",
    salesforce: "https://login.salesforce.com/services/oauth2/authorize",
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
