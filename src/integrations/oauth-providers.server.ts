import {
  BIGQUERY_READ_SCOPE,
  BIGQUERY_WRITE_SCOPE,
  CONNECTION_FLOWS,
  calendlyUserUri,
  TANA_MCP_AUTHORIZE_ENDPOINT,
  TANA_MCP_HOSTED_CLIENT_ID,
  TANA_MCP_ISSUER,
} from "./connection-flows.mjs";
import { approvedMcpServers } from "./approved-mcp-servers.server.mjs";
import { OURA_SCOPES } from "@/health/oura-metrics.mjs";

export type OAuthProviderId =
  | "tana"
  | "stripe"
  | "gamma"
  | "calendly"
  | "google-bigquery"
  | "hubspot"
  | "canva"
  | "figma"
  | "microsoft"
  | "github"
  | "slack"
  | "notion"
  | "linear"
  | "dropbox"
  | "box"
  | "oura"
  | "whoop"
  | "salesforce";
export type OAuthProviderAdapter = {
  id: OAuthProviderId;
  name: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  refreshEndpoint?: string;
  revocationEndpoint?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  requiredScopes: string[];
  optionalScopes: string[];
  usesPkce: boolean;
  tokenClientAuth?: "client_secret_post" | "client_secret_basic" | "none";
  profileEndpoint?: string;
  profileId: (value: Record<string, unknown>) => string;
  profileLabel: (value: Record<string, unknown>) => string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const teamUser = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderAdapter> = {
  tana: {
    id: "tana",
    name: "Tana",
    authorizationEndpoint: TANA_MCP_AUTHORIZE_ENDPOINT,
    tokenEndpoint: `${TANA_MCP_ISSUER}/oauth2/token`,
    revocationEndpoint: `${TANA_MCP_ISSUER}/oauth2/revoke`,
    get tokenClientAuth() {
      if (
        !process.env.TANA_MCP_CLIENT_ID ||
        process.env.TANA_MCP_CLIENT_ID === TANA_MCP_HOSTED_CLIENT_ID
      )
        return "none";
      const method = process.env.TANA_MCP_TOKEN_AUTH_METHOD;
      if (method === "none" || method === "client_secret_basic" || method === "client_secret_post")
        return method;
      return method ? undefined : "client_secret_post";
    },
    clientIdEnv: "TANA_MCP_CLIENT_ID",
    clientSecretEnv: "TANA_MCP_CLIENT_SECRET",
    requiredScopes: CONNECTION_FLOWS.tana.scopes,
    optionalScopes: [],
    usesPkce: true,
    profileId: () => "tana-mcp",
    profileLabel: () => "Tana account",
  },
  stripe: {
    id: "stripe",
    name: "Stripe",
    authorizationEndpoint: "https://marketplace.stripe.com/oauth/v2/authorize",
    tokenEndpoint: "https://api.stripe.com/v1/oauth/token",
    clientIdEnv: "STRIPE_APPS_OAUTH_CLIENT_ID",
    clientSecretEnv: "STRIPE_APPS_OAUTH_API_KEY",
    requiredScopes: ["stripe_apps"],
    optionalScopes: [],
    usesPkce: false,
    profileEndpoint: "https://api.stripe.com/v1/charges?limit=1",
    profileId: (v) => text(v.verifiedAccountId),
    profileLabel: (v) =>
      text(v.verifiedAccountId).startsWith("test:") ? "Stripe test account" : "Stripe live account",
  },
  gamma: {
    id: "gamma",
    name: "Gamma",
    authorizationEndpoint: "https://auth.gamma.app/oauth/authorize",
    tokenEndpoint: "https://auth.gamma.app/oauth/token",
    clientIdEnv: "GAMMA_OAUTH_CLIENT_ID",
    clientSecretEnv: "GAMMA_OAUTH_CLIENT_SECRET",
    requiredScopes: ["gamma:read"],
    optionalScopes: ["generate"],
    usesPkce: true,
    profileEndpoint: "https://public-api.gamma.app/v1.0/me",
    profileId: (v) => {
      const userId = text(v.userId);
      const workspaceId = text(v.workspaceId);
      const id = /^[a-zA-Z0-9_-]{1,128}$/u;
      return id.test(userId) && id.test(workspaceId) ? `${workspaceId}:${userId}` : "";
    },
    profileLabel: (v) => text(v.workspaceName).slice(0, 120) || "Gamma workspace",
  },
  calendly: {
    id: "calendly",
    name: "Calendly",
    authorizationEndpoint: "https://auth.calendly.com/oauth/authorize",
    tokenEndpoint: "https://auth.calendly.com/oauth/token",
    revocationEndpoint: "https://auth.calendly.com/oauth/revoke",
    clientIdEnv: "CALENDLY_OAUTH_CLIENT_ID",
    clientSecretEnv: "CALENDLY_OAUTH_CLIENT_SECRET",
    requiredScopes: ["users:read", "scheduled_events:read"],
    optionalScopes: ["scheduling_links:write"],
    usesPkce: true,
    profileEndpoint: "https://api.calendly.com/users/me",
    profileId: (v) => calendlyUserUri(teamUser(v.resource).uri),
    profileLabel: (v) => text(teamUser(v.resource).name) || "Calendly account",
  },
  "google-bigquery": {
    id: "google-bigquery",
    name: "Google Cloud BigQuery",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    revocationEndpoint: "https://oauth2.googleapis.com/revoke",
    clientIdEnv: "BIGQUERY_OAUTH_CLIENT_ID",
    clientSecretEnv: "BIGQUERY_OAUTH_CLIENT_SECRET",
    requiredScopes: ["openid", "email", BIGQUERY_READ_SCOPE],
    optionalScopes: [BIGQUERY_WRITE_SCOPE],
    usesPkce: true,
    profileEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    profileId: (v) => text(v.sub),
    profileLabel: (v) => (v.email_verified === true ? text(v.email) : "") || "Google Cloud account",
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    authorizationEndpoint: "https://app.hubspot.com/oauth/authorize",
    tokenEndpoint: "https://api.hubspot.com/oauth/2026-09/token",
    clientIdEnv: "HUBSPOT_OAUTH_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_OAUTH_CLIENT_SECRET",
    requiredScopes: ["crm.objects.companies.read"],
    optionalScopes: ["crm.objects.contacts.read", "crm.objects.companies.write"],
    usesPkce: false,
    profileId: (v) => text(v.verifiedAccountId),
    profileLabel: (v) => `HubSpot portal ${text(v.verifiedAccountId)}`,
  },
  canva: {
    id: "canva",
    name: "Canva",
    authorizationEndpoint: "https://www.canva.com/api/oauth/authorize",
    tokenEndpoint: "https://api.canva.com/rest/v1/oauth/token",
    clientIdEnv: "CANVA_OAUTH_CLIENT_ID",
    clientSecretEnv: "CANVA_OAUTH_CLIENT_SECRET",
    requiredScopes: ["design:meta:read"],
    optionalScopes: ["design:content:write"],
    usesPkce: true,
    profileEndpoint: "https://api.canva.com/rest/v1/users/me",
    profileId: (v) => {
      const { team_id, user_id } = teamUser(v.team_user);
      return text(team_id) && text(user_id) ? `${team_id}:${user_id}` : "";
    },
    profileLabel: () => "Canva account",
  },
  figma: {
    id: "figma",
    name: "Figma",
    authorizationEndpoint: "https://www.figma.com/oauth",
    tokenEndpoint: "https://api.figma.com/v1/oauth/token",
    refreshEndpoint: "https://api.figma.com/v1/oauth/refresh",
    clientIdEnv: "FIGMA_OAUTH_CLIENT_ID",
    clientSecretEnv: "FIGMA_OAUTH_CLIENT_SECRET",
    requiredScopes: ["current_user:read", "file_metadata:read"],
    optionalScopes: ["file_comments:write"],
    usesPkce: true,
    profileEndpoint: "https://api.figma.com/v1/me",
    profileId: (v) => text(v.id),
    profileLabel: (v) => text(v.handle) || "Figma account",
  },
  salesforce: {
    id: "salesforce",
    name: "Salesforce",
    authorizationEndpoint: "https://login.salesforce.com/services/oauth2/authorize",
    tokenEndpoint: "https://login.salesforce.com/services/oauth2/token",
    revocationEndpoint: "https://login.salesforce.com/services/oauth2/revoke",
    clientIdEnv: "SALESFORCE_OAUTH_CLIENT_ID",
    clientSecretEnv: "SALESFORCE_OAUTH_CLIENT_SECRET",
    requiredScopes: ["openid", "api", "refresh_token"],
    optionalScopes: [],
    usesPkce: true,
    profileEndpoint: "https://login.salesforce.com/services/oauth2/userinfo?version=latest",
    profileId: (v) =>
      v.active === true && text(v.organization_id) && text(v.user_id)
        ? `${text(v.organization_id)}:${text(v.user_id)}`
        : "",
    profileLabel: (v) => text(v.preferred_username) || text(v.name) || "Salesforce account",
  },
  oura: {
    id: "oura",
    name: "Oura",
    authorizationEndpoint: "https://cloud.ouraring.com/oauth/authorize",
    tokenEndpoint: "https://api.ouraring.com/oauth/token",
    clientIdEnv: "OURA_OAUTH_CLIENT_ID",
    clientSecretEnv: "OURA_OAUTH_CLIENT_SECRET",
    requiredScopes: ["personal"],
    optionalScopes: OURA_SCOPES,
    usesPkce: true,
    profileEndpoint: "https://api.ouraring.com/v2/usercollection/personal_info",
    profileId: (v) => text(v.id),
    profileLabel: () => "Oura account",
  },
  whoop: {
    id: "whoop",
    name: "WHOOP",
    authorizationEndpoint: "https://api.prod.whoop.com/oauth/oauth2/auth",
    tokenEndpoint: "https://api.prod.whoop.com/oauth/oauth2/token",
    revocationEndpoint: "https://api.prod.whoop.com/developer/v2/user/access",
    clientIdEnv: "WHOOP_OAUTH_CLIENT_ID",
    clientSecretEnv: "WHOOP_OAUTH_CLIENT_SECRET",
    requiredScopes: ["read:profile", "offline"],
    optionalScopes: ["read:sleep", "read:recovery", "read:cycles"],
    usesPkce: false,
    profileEndpoint: "https://api.prod.whoop.com/developer/v2/user/profile/basic",
    profileId: (v) =>
      typeof v.user_id === "number" && Number.isSafeInteger(v.user_id) ? String(v.user_id) : "",
    profileLabel: () => "WHOOP account",
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    requiredScopes: ["openid", "profile", "email", "offline_access", "User.Read"],
    optionalScopes: [
      "Files.Read",
      "Files.ReadWrite",
      "Files.Read.All",
      "Sites.Read.All",
      "Sites.ReadWrite.All",
      "Mail.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "Calendars.Read",
      "Calendars.ReadWrite",
      "Team.ReadBasic.All",
      "Chat.Read",
      "ChatMessage.Send",
    ],
    usesPkce: true,
    profileEndpoint: "https://graph.microsoft.com/v1.0/me",
    profileId: (v) => text(v.id),
    profileLabel: (v) => text(v.mail) || text(v.userPrincipalName) || text(v.displayName),
  },
  github: {
    id: "github",
    name: "GitHub",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    revocationEndpoint: "https://api.github.com/applications/{client_id}/grant",
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
    requiredScopes: ["read:user", "user:email"],
    optionalScopes: ["repo", "read:org"],
    usesPkce: true,
    profileEndpoint: "https://api.github.com/user",
    profileId: (v) => String(v.id ?? ""),
    profileLabel: (v) => text(v.login),
  },
  slack: {
    id: "slack",
    name: "Slack",
    authorizationEndpoint: "https://slack.com/oauth/v2/authorize",
    tokenEndpoint: "https://slack.com/api/oauth.v2.access",
    revocationEndpoint: "https://slack.com/api/auth.revoke",
    clientIdEnv: "SLACK_OAUTH_CLIENT_ID",
    clientSecretEnv: "SLACK_OAUTH_CLIENT_SECRET",
    requiredScopes: ["channels:read", "search:read", "users:read"],
    optionalScopes: [
      "chat:write",
      "files:read",
      "channels:history",
      "groups:history",
      "groups:read",
    ],
    usesPkce: false,
    profileEndpoint: "https://slack.com/api/auth.test",
    profileId: (v) =>
      text(v.team_id) && text(v.user_id) ? text(v.team_id) + ":" + text(v.user_id) : "",
    profileLabel: (v) => text(v.team),
  },
  notion: {
    id: "notion",
    name: "Notion",
    authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
    tokenEndpoint: "https://api.notion.com/v1/oauth/token",
    revocationEndpoint: "https://api.notion.com/v1/oauth/revoke",
    clientIdEnv: "NOTION_OAUTH_CLIENT_ID",
    clientSecretEnv: "NOTION_OAUTH_CLIENT_SECRET",
    requiredScopes: [],
    optionalScopes: [],
    usesPkce: false,
    profileEndpoint: "https://api.notion.com/v1/users/me",
    profileId: (v) => text(v.id),
    profileLabel: (v) => text(v.name) || "Notion workspace",
  },
  linear: {
    id: "linear",
    name: "Linear",
    authorizationEndpoint: "https://linear.app/oauth/authorize",
    tokenEndpoint: "https://api.linear.app/oauth/token",
    revocationEndpoint: "https://api.linear.app/oauth/revoke",
    clientIdEnv: "LINEAR_OAUTH_CLIENT_ID",
    clientSecretEnv: "LINEAR_OAUTH_CLIENT_SECRET",
    requiredScopes: ["read"],
    optionalScopes: ["issues:create"],
    usesPkce: true,
    profileEndpoint: "https://api.linear.app/graphql",
    profileId: (v) =>
      text(
        (v.data as Record<string, unknown> | undefined)?.viewer &&
          ((v.data as Record<string, unknown>).viewer as Record<string, unknown>).id,
      ),
    profileLabel: () => "Linear workspace",
  },
  dropbox: {
    id: "dropbox",
    name: "Dropbox",
    authorizationEndpoint: "https://www.dropbox.com/oauth2/authorize",
    tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
    revocationEndpoint: "https://api.dropboxapi.com/2/auth/token/revoke",
    clientIdEnv: "DROPBOX_OAUTH_CLIENT_ID",
    clientSecretEnv: "DROPBOX_OAUTH_CLIENT_SECRET",
    requiredScopes: ["account_info.read", "files.metadata.read", "files.content.read"],
    optionalScopes: ["files.content.write"],
    usesPkce: true,
    profileEndpoint: "https://api.dropboxapi.com/2/users/get_current_account",
    profileId: (v) => text(v.account_id),
    profileLabel: (v) => text(v.email) || "Dropbox account",
  },
  box: {
    id: "box",
    name: "Box",
    authorizationEndpoint: "https://account.box.com/api/oauth2/authorize",
    tokenEndpoint: "https://api.box.com/oauth2/token",
    revocationEndpoint: "https://api.box.com/oauth2/revoke",
    clientIdEnv: "BOX_OAUTH_CLIENT_ID",
    clientSecretEnv: "BOX_OAUTH_CLIENT_SECRET",
    requiredScopes: ["root_readonly"],
    optionalScopes: ["root_readwrite"],
    usesPkce: false,
    profileEndpoint: "https://api.box.com/2.0/users/me",
    profileId: (v) => text(v.id),
    profileLabel: (v) => text(v.login) || text(v.name),
  },
};

export function credentialVaultConfigured() {
  const key = process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
  return Boolean(key && Buffer.from(key, "base64").length === 32);
}

export function configuredKeyProviders() {
  if (!credentialVaultConfigured()) return [];
  return Object.values(CONNECTION_FLOWS)
    .filter((flow) => flow.authentication === "api-key")
    .filter(
      (flow) => flow.provider !== "sp-global" || process.env.KOVA_SP_GLOBAL_ENABLED === "true",
    )
    .filter((flow) => flow.provider !== "custom-mcp" || approvedMcpServers().size > 0)
    .map(({ provider, label, scopes }) => ({
      id: provider,
      name: label,
      requiredScopes: scopes,
      optionalScopes: [],
    }));
}

export function oauthClientId(provider: OAuthProviderAdapter, redirectOrigin?: string) {
  const configured = process.env[provider.clientIdEnv]?.trim() || undefined;
  if (provider.id !== "tana") return configured;
  if (configured && configured !== TANA_MCP_HOSTED_CLIENT_ID) return configured;
  return !redirectOrigin || redirectOrigin === new URL(TANA_MCP_HOSTED_CLIENT_ID).origin
    ? TANA_MCP_HOSTED_CLIENT_ID
    : undefined;
}

export function configuredOAuthProviders(redirectOrigin?: string) {
  if (!credentialVaultConfigured()) return [];
  return Object.values(OAUTH_PROVIDERS).filter((provider) => {
    const id = oauthClientId(provider, redirectOrigin);
    const secret = process.env[provider.clientSecretEnv];
    if (!id || (!secret?.trim() && provider.tokenClientAuth !== "none")) return false;
    if (provider.id === "tana") return Boolean(provider.tokenClientAuth);
    return provider.id !== "stripe" || /^sk_(test|live)_[A-Za-z0-9]+$/u.test(secret ?? "");
  });
}
