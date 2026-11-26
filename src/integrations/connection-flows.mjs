// Client-safe descriptions of implemented read operations. Deployment readiness
// and the user's granted scopes are checked separately on the server.
export const BIGQUERY_READ_SCOPE = "https://www.googleapis.com/auth/bigquery.readonly";
export const BIGQUERY_WRITE_SCOPE = "https://www.googleapis.com/auth/bigquery";
export const REVIEWED_MCP_WRITE_SCOPE = "mcp:reviewed-tool:write";
export const TANA_MCP_RESOURCE = "https://home.tana.inc/mcp";
export const TANA_MCP_ISSUER = "https://login.tana.inc";
export const TANA_MCP_AUTHORIZE_ENDPOINT = `${TANA_MCP_ISSUER}/oauth2/authorize`;
export const TANA_MCP_HOSTED_CLIENT_ID = "https://kovagpt.com/.well-known/tana-mcp-client.json";

export function calendlyUserUri(value) {
  return typeof value === "string" &&
    /^https:\/\/api\.calendly\.com\/users\/[a-zA-Z0-9_-]{1,128}$/u.test(value)
    ? value
    : "";
}

export const GRANOLA_NOTE_READ = "granola:notes:list";

export const CONNECTION_FLOWS = {
  tana: {
    provider: "tana",
    scopes: ["tana:mcp:search"],
    tool: "tana_search_items",
    label: "Tana",
    description: "Search notes and workspace items authorized in the linked Tana account.",
  },
  "custom-mcp": {
    provider: "custom-mcp",
    authentication: "api-key",
    scopes: ["mcp:reviewed-tool:read"],
    tool: "custom_mcp_read",
    label: "Custom MCP",
    description: "Send one text query to the reviewed read tool on the selected MCP server.",
  },
  "interactive-brokers": {
    provider: "interactive-brokers",
    authentication: "api-key",
    scopes: ["ibkr:flex:positions:read"],
    tool: "ibkr_read_flex_positions",
    label: "Interactive Brokers",
    description:
      "Read the symbol, currency and quantity of open positions in your selected Activity Flex report. Use 'positions'.",
  },
  "sp-global": {
    provider: "sp-global",
    authentication: "api-key",
    scopes: ["spglobal:company:read"],
    tool: "sp_global_match_company",
    label: "S&P Global",
    description: "Match a company name to a Capital IQ company and read its industry and country.",
  },
  webull: {
    provider: "webull",
    authentication: "api-key",
    scopes: ["webull:accounts:list"],
    tool: "webull_list_accounts",
    label: "Webull",
    description: "List account types authorized for the linked OpenAPI app. Use 'accounts'.",
  },
  wix: {
    provider: "wix",
    authentication: "api-key",
    scopes: ["wix:site:properties:read"],
    tool: "wix_read_site_properties",
    label: "Wix",
    description:
      "Read the linked Wix Headless project's site business name and locale. Use 'site'.",
  },
  meltwater: {
    provider: "meltwater",
    authentication: "api-key",
    scopes: ["meltwater:searches:list"],
    tool: "meltwater_list_saved_searches",
    label: "Meltwater",
    description: "Find saved media searches by name or enter 'recent' to list them.",
  },
  vercel: {
    provider: "vercel",
    authentication: "api-key",
    scopes: ["vercel:deployments:list"],
    tool: "vercel_list_deployments",
    label: "Vercel",
    description:
      "List recent deployments in the linked Vercel team. Use 'recent' or an exact project ID.",
  },
  mixpanel: {
    provider: "mixpanel",
    authentication: "api-key",
    scopes: ["mixpanel:cohorts:list"],
    tool: "mixpanel_list_cohorts",
    label: "Mixpanel",
    description:
      "Find saved cohort names and counts in the linked Mixpanel project. Enter a name fragment or 'recent'.",
  },
  etoro: {
    provider: "etoro",
    authentication: "api-key",
    scopes: ["etoro:portfolio:read"],
    tool: "etoro_read_portfolio_summary",
    label: "eToro",
    description:
      "Read reported balance, portfolio value, and unrealized P&L. Use 'portfolio' for the linked real account.",
  },
  stripe: {
    provider: "stripe",
    scopes: ["stripe_apps"],
    tool: "stripe_read_charges",
    label: "Stripe",
    description:
      "Read payment amounts, currencies and statuses. Use 'recent' to list recent charges or enter an exact Stripe charge ID.",
  },
  gamma: {
    provider: "gamma",
    scopes: ["gamma:read"],
    tool: "gamma_search_documents",
    label: "Gamma",
    description:
      "Find Gamma documents by title or enter 'recent'. After authorizing generation, use 'generation:ID' to check a queued presentation.",
  },
  "hyperframes-heygen": {
    provider: "hyperframes-heygen",
    authentication: "api-key",
    scopes: ["hyperframes:read"],
    tool: "hyperframes_list_renders",
    label: "HyperFrames by HeyGen",
    description:
      "Find HyperFrames renders by title, enter 'recent', or check the status of an exact render ID.",
  },
  granola: {
    provider: "granola",
    authentication: "api-key",
    scopes: [GRANOLA_NOTE_READ],
    tool: "granola_search_notes",
    label: "Granola",
    description:
      "Find recent meeting note titles and dates visible to the connected Granola key. Use a title fragment or 'recent' to list notes.",
  },
  calendly: {
    provider: "calendly",
    scopes: ["users:read", "scheduled_events:read"],
    tool: "calendly_search_events",
    label: "Calendly",
    description:
      "Find upcoming active meetings for the connected Calendly user. Search by title or use 'upcoming' to list the next meetings.",
  },
  "google-bigquery": {
    provider: "google-bigquery",
    scopes: [BIGQUERY_READ_SCOPE],
    tool: "bigquery_list_datasets",
    label: "Google Cloud BigQuery",
    description:
      "List dataset names and locations visible to the connected Google Cloud account. Supply the exact Google Cloud project ID.",
  },
  hubspot: {
    provider: "hubspot",
    scopes: ["crm.objects.companies.read"],
    tool: "hubspot_search_companies",
    label: "HubSpot",
    description: "Search names and domains of companies in the connected HubSpot account.",
  },
  "hubspot-contacts": {
    provider: "hubspot",
    scopes: ["crm.objects.contacts.read"],
    tool: "hubspot_search_contacts",
    label: "HubSpot contacts",
    description: "Search contact names by first or last name in the connected HubSpot portal.",
  },
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
    scopes: ["Calendars.Read"],
    tool: "outlook_calendar_search",
    label: "Outlook Calendar",
    description:
      "Use the query upcoming for the next seven days of the default Outlook calendar, including recurring events. To search titles, enter text the subject starts with. Returns at most ten event titles and times. Read-only.",
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
  "notion-private": {
    provider: "notion-private",
    authentication: "api-key",
    scopes: ["page:read"],
    tool: "notion_read_linked_page",
    label: "Notion linked page",
    description: "Read the single Notion page linked to this credential. Use the query 'open'.",
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
      (scope === "issues:create" && granted.has("write")) ||
      (scope === "root_readonly" && granted.has("root_readwrite")) ||
      (scope === "gamma:read" && granted.has("generate")) ||
      (scope === BIGQUERY_READ_SCOPE && granted.has(BIGQUERY_WRITE_SCOPE)) ||
      (scope === "Chat.Read" && granted.has("Chat.ReadWrite")) ||
      (scope === "ChatMessage.Send" && granted.has("Chat.ReadWrite")) ||
      (scope === "Sites.Read.All" && granted.has("Sites.ReadWrite.All")) ||
      (scope === "Files.Read" &&
        (granted.has("Files.Read.All") ||
          granted.has("Files.ReadWrite") ||
          granted.has("Files.ReadWrite.All"))) ||
      (scope === "Files.ReadWrite" && granted.has("Files.ReadWrite.All")) ||
      (scope === "Mail.Read" && granted.has("Mail.ReadWrite")) ||
      (scope === "Calendars.Read" && granted.has("Calendars.ReadWrite")),
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
    tana: TANA_MCP_AUTHORIZE_ENDPOINT,
    stripe: "https://marketplace.stripe.com/oauth/v2/authorize",
    gamma: "https://auth.gamma.app/oauth/authorize",
    box: "https://account.box.com/api/oauth2/authorize",
    canva: "https://www.canva.com/api/oauth/authorize",
    figma: "https://www.figma.com/oauth",
    calendly: "https://auth.calendly.com/oauth/authorize",
    "google-bigquery": "https://accounts.google.com/o/oauth2/v2/auth",
    hubspot: "https://app.hubspot.com/oauth/authorize",
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
