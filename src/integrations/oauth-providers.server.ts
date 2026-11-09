export type OAuthProviderId =
  | "microsoft"
  | "github"
  | "slack"
  | "notion"
  | "linear"
  | "dropbox"
  | "box"
  | "calendly"
  | "canva"
  | "oura"
  | "whoop"
  | "salesforce";
export type OAuthProviderAdapter = {
  id: OAuthProviderId;
  name: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  requiredScopes: string[];
  optionalScopes: string[];
  usesPkce: boolean;
  profileEndpoint: string;
  profileId: (value: Record<string, unknown>) => string;
  profileLabel: (value: Record<string, unknown>) => string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderAdapter> = {
  canva: {
    id: "canva",
    name: "Canva",
    authorizationEndpoint: "https://www.canva.com/api/oauth/authorize",
    tokenEndpoint: "https://api.canva.com/rest/v1/oauth/token",
    clientIdEnv: "CANVA_OAUTH_CLIENT_ID",
    clientSecretEnv: "CANVA_OAUTH_CLIENT_SECRET",
    requiredScopes: ["design:meta:read"],
    optionalScopes: ["profile:read"],
    usesPkce: true,
    profileEndpoint: "https://api.canva.com/rest/v1/users/me",
    profileId: (v) => {
      const user = v.team_user as Record<string, unknown> | undefined;
      const id = text(user?.user_id);
      const teamId = text(user?.team_id);
      return id && teamId ? `${teamId}:${id}` : "";
    },
    profileLabel: () => "Canva account",
  },
  calendly: {
    id: "calendly",
    name: "Calendly",
    authorizationEndpoint: "https://auth.calendly.com/oauth/authorize",
    tokenEndpoint: "https://auth.calendly.com/oauth/token",
    clientIdEnv: "CALENDLY_OAUTH_CLIENT_ID",
    clientSecretEnv: "CALENDLY_OAUTH_CLIENT_SECRET",
    requiredScopes: ["users:read", "scheduled_events:read"],
    optionalScopes: [],
    usesPkce: true,
    profileEndpoint: "https://api.calendly.com/users/me",
    profileId: (v) => {
      const resource = v.resource as Record<string, unknown> | undefined;
      const uri = text(resource?.uri);
      return /^https:\/\/api\.calendly\.com\/users\/[a-zA-Z0-9_-]+$/u.test(uri) ? uri : "";
    },
    profileLabel: (v) => {
      const resource = v.resource as Record<string, unknown> | undefined;
      return text(resource?.name) || text(resource?.email) || "Calendly account";
    },
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
    optionalScopes: ["daily"],
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
      "Files.Read.All",
      "Sites.Read.All",
      "Mail.Read",
      "Mail.Send",
      "Calendars.ReadBasic",
      "Calendars.ReadWrite",
      "Team.ReadBasic.All",
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
    optionalScopes: ["write", "issues:create"],
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
    // Metadata search needs account identity and file names, not file bodies.
    requiredScopes: ["account_info.read", "files.metadata.read"],
    optionalScopes: ["files.content.read", "files.content.write"],
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
    // Box's classic confidential-client OAuth flow does not support PKCE.
    // Keep browser-bound, single-use state and server-side client authentication.
    usesPkce: false,
    profileEndpoint: "https://api.box.com/2.0/users/me",
    profileId: (v) => text(v.id),
    profileLabel: (v) => text(v.login) || text(v.name),
  },
};

export function configuredOAuthProviders() {
  const key = process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
  if (!key || Buffer.from(key, "base64").length !== 32) return [];
  return Object.values(OAUTH_PROVIDERS).filter(
    (provider) => process.env[provider.clientIdEnv] && process.env[provider.clientSecretEnv],
  );
}
