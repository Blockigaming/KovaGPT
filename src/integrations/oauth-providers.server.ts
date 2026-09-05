export type OAuthProviderId =
  "microsoft" | "github" | "slack" | "notion" | "linear" | "dropbox" | "box";
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
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    requiredScopes: ["openid", "profile", "email", "offline_access", "User.Read"],
    optionalScopes: [
      "Files.Read.All",
      "Sites.Read.All",
      "Mail.Read",
      "Mail.Send",
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
    profileId: (v) => text(v.team_id) + ":" + text(v.user_id),
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
    usesPkce: true,
    profileEndpoint: "https://api.box.com/2.0/users/me",
    profileId: (v) => text(v.id),
    profileLabel: (v) => text(v.login) || text(v.name),
  },
};

export function configuredOAuthProviders() {
  return Object.values(OAUTH_PROVIDERS).filter(
    (provider) => process.env[provider.clientIdEnv] && process.env[provider.clientSecretEnv],
  );
}
