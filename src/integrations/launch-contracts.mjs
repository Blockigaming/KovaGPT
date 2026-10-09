// Read-only launch contracts. Deployment credentials never constitute certification.
// Reviewed references and live requirements: docs/integrations/launch-nine.md.
const graph = (name, permission) => ({
  name,
  family: "microsoft",
  env: "MICROSOFT",
  pkce: true,
  authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["openid", "profile", "offline_access", "User.Read", permission],
  permissions: [permission],
});
export const LAUNCH_CONNECTORS = Object.freeze({
  outlook: graph("Outlook", "Mail.Read"),
  onedrive: graph("OneDrive", "Files.Read"),
  sharepoint: graph("SharePoint", "Sites.Read.All"),
  "ms-teams": graph("Microsoft Teams", "Chat.Read"),
  notion: {
    name: "Notion",
    family: "notion",
    env: "NOTION",
    pkce: false,
    authorize: "https://api.notion.com/v1/oauth/authorize",
    token: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    permissions: [],
  },
  linear: {
    name: "Linear",
    family: "linear",
    env: "LINEAR",
    pkce: true,
    authorize: "https://linear.app/oauth/authorize",
    token: "https://api.linear.app/oauth/token",
    scopes: ["read"],
    permissions: ["read"],
  },
  slack: {
    name: "Slack",
    family: "slack",
    env: "SLACK",
    pkce: true,
    authorize: "https://slack.com/oauth/v2/authorize",
    token: "https://slack.com/api/oauth.v2.access",
    scopes: ["search:read"],
    permissions: ["search:read"],
  },
  salesforce: {
    name: "Salesforce",
    family: "salesforce",
    env: "SALESFORCE",
    pkce: true,
    authorize: "https://login.salesforce.com/services/oauth2/authorize",
    token: "https://login.salesforce.com/services/oauth2/token",
    scopes: ["api", "openid", "refresh_token"],
    permissions: ["api"],
  },
  hubspot: {
    name: "HubSpot",
    family: "hubspot",
    env: "HUBSPOT",
    pkce: false,
    authorize: "https://app.hubspot.com/oauth/authorize",
    token: "https://api.hubspot.com/oauth/v3/token",
    scopes: ["oauth", "crm.objects.contacts.read"],
    permissions: ["crm.objects.contacts.read"],
  },
});
for (const contract of Object.values(LAUNCH_CONNECTORS)) {
  Object.freeze(contract.scopes);
  Object.freeze(contract.permissions);
  Object.freeze(contract);
}
// Deliberately empty. Only a reviewed source change with live evidence adds IDs.
export const CERTIFIED_LAUNCH_CONNECTORS = Object.freeze([]);
export function isLaunchConnector(id) {
  return typeof id === "string" && Object.hasOwn(LAUNCH_CONNECTORS, id);
}
export function requireLaunchConnector(id) {
  if (!isLaunchConnector(id)) throw new ConnectorError("unsupported_connector", 400);
  return LAUNCH_CONNECTORS[id];
}
export function assertLaunchCertified(id) {
  requireLaunchConnector(id);
  if (!CERTIFIED_LAUNCH_CONNECTORS.includes(id))
    throw new ConnectorError("connector_not_certified", 503);
}
export class ConnectorError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = "ConnectorError";
    this.code = code;
    this.status = status;
  }
}
export function normalizeScopes(value) {
  const parts = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[ ,]+/)
      : [];
  return [...new Set(parts.filter((s) => typeof s === "string" && s.length > 0 && s.length < 300))];
}
export function requirePermissions(id, scopes) {
  const granted = normalizeScopes(scopes);
  if (!requireLaunchConnector(id).permissions.every((s) => granted.includes(s)))
    throw new ConnectorError("permission_incomplete", 403);
}
// Closed operation set; never accept caller URLs, arbitrary GraphQL/SOQL or mutations.
export const LAUNCH_OPERATIONS = Object.freeze({
  outlook: { list_messages: [], read_message: ["id"] },
  onedrive: { list_files: ["folderId?"], get_file: ["id"] },
  sharepoint: {
    search_sites: ["query"],
    list_files: ["siteId", "folderId?"],
    get_file: ["siteId", "id"],
  },
  "ms-teams": { list_chats: [], list_messages: ["chatId"] },
  notion: { search: ["query?"], get_page: ["id"], list_blocks: ["id"] },
  linear: { list_issues: [], get_issue: ["id"] },
  slack: { search_messages: ["query"] },
  salesforce: { list_accounts: [], get_account: ["id"] },
  hubspot: { search_contacts: ["query?"], get_contact: ["id"] },
});
export function validateOperation(id, operation, args = {}) {
  requireLaunchConnector(id);
  const operations = LAUNCH_OPERATIONS[id];
  if (!Object.hasOwn(operations, operation)) throw new ConnectorError("unsupported_operation", 400);
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new ConnectorError("invalid_arguments", 400);
  const fields = operations[operation],
    allowed = fields.map((s) => s.replace(/\?$/, ""));
  for (const key of Object.keys(args)) {
    if (
      !allowed.includes(key) ||
      typeof args[key] !== "string" ||
      args[key].length > 500 ||
      /[\x00-\x1f\x7f]/.test(args[key])
    )
      throw new ConnectorError("invalid_arguments", 400);
  }
  for (const field of fields)
    if (!field.endsWith("?") && !args[field]?.trim())
      throw new ConnectorError("invalid_arguments", 400);
  for (const [key, value] of Object.entries(args)) {
    if (key !== "query" && (!value || /[/\\?#]/.test(value) || value === "." || value === ".."))
      throw new ConnectorError("invalid_arguments", 400);
  }
  if (id === "salesforce" && args.id && !/^(?:[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(args.id))
    throw new ConnectorError("invalid_arguments", 400);
  return Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)));
}
