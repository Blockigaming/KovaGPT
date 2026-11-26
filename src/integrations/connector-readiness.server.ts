import { MASTER_CONNECTORS } from "@/lib/connector-master-list.mjs";
import { googleOAuthConfigured, googleRedirectUri } from "@/lib/google-oauth.server";
import { financeConfigured } from "@/finances/plaid.server";
import { CONNECTION_FLOWS } from "./connection-flows.mjs";
import { approvedMcpServers } from "./approved-mcp-servers.server.mjs";
import {
  OAUTH_PROVIDERS,
  configuredKeyProviders,
  configuredOAuthProviders,
  credentialVaultConfigured,
  oauthClientId,
  type OAuthProviderId,
} from "./oauth-providers.server";

type SetupState =
  | "deployment_setup_required"
  | "ready_for_account_verification"
  | "ready_for_file_verification"
  | "native_device_verification_required"
  | "adapter_unavailable";
type Check = {
  id: string;
  state: SetupState;
  requiredSettings: string[];
};

const googleIds = new Set(["gmail", "google-calendar", "google-drive"]);
const hasSetting = (name: string) => Boolean(process.env[name]?.trim());
const unique = (names: string[]) => [...new Set(names)];

function callbackMatches(value: string, origin: string, path: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === origin &&
      url.pathname === path &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function googleSettings(request: Request, origin: string) {
  const settings = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "CONNECTOR_ENCRYPTION_KEY",
  ];
  const missing = settings.filter((name) => !hasSetting(name));
  if (googleOAuthConfigured() && missing.length === 0) {
    try {
      if (callbackMatches(googleRedirectUri(request), origin, "/api/google/callback")) return [];
      return ["GOOGLE_REDIRECT_URI"];
    } catch {
      return ["GOOGLE_REDIRECT_URI"];
    }
  }
  return [
    ...missing,
    ...["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !hasSetting(name)),
  ];
}

function githubSettings(origin: string) {
  const names = [
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "CONNECTOR_ENCRYPTION_KEY",
  ];
  const missing = names.filter((name) => !hasSetting(name));
  if (Buffer.from(process.env.CONNECTOR_ENCRYPTION_KEY ?? "", "base64").length !== 32)
    missing.push("CONNECTOR_ENCRYPTION_KEY");
  const configuredCallback = process.env.GITHUB_REDIRECT_URI;
  if (configuredCallback && !callbackMatches(configuredCallback, origin, "/api/github/callback"))
    missing.push("GITHUB_REDIRECT_URI");
  return unique(missing);
}

export function connectorDeploymentReadiness(request: Request): Check[] {
  const origin = new URL(request.url).origin;
  const oauth = new Set<string>(configuredOAuthProviders(origin).map(({ id }) => id));
  const keyProviders = new Set(configuredKeyProviders().map(({ id }) => id));
  const vaultSettings = credentialVaultConfigured() ? [] : ["CONNECTOR_TOKEN_ENCRYPTION_KEY"];
  const google = googleSettings(request, origin);
  const github = githubSettings(origin);
  const plaid = financeConfigured()
    ? []
    : unique([
        ...vaultSettings,
        "PLAID_CLIENT_ID",
        "PLAID_SECRET",
        "PLAID_ENV",
        "PLAID_WEBHOOK_URL",
        "PLAID_REDIRECT_URI",
        "KOVA_FINANCE_REGIONS",
      ]);

  return MASTER_CONNECTORS.map(({ id }): Check => {
    if (id === "apple-health" || id === "android-health-connect")
      return { id, state: "native_device_verification_required", requiredSettings: [] };
    if (id === "excalidraw")
      return { id, state: "ready_for_file_verification", requiredSettings: [] };

    let requiredSettings: string[];
    if (googleIds.has(id)) requiredSettings = google;
    else if (id === "github") requiredSettings = github;
    else if (id === "plaid") requiredSettings = plaid;
    else if (id === "notion" && keyProviders.has("notion-private")) requiredSettings = [];
    else {
      const flow = CONNECTION_FLOWS[id];
      const providerId = flow?.provider ?? id;
      if (flow?.authentication === "api-key") {
        requiredSettings = keyProviders.has(providerId) ? [] : [...vaultSettings];
        if (id === "custom-mcp" && approvedMcpServers().size === 0)
          requiredSettings.push("KOVA_MCP_READ_SERVERS");
        if (
          !keyProviders.has(providerId) &&
          id === "sp-global" &&
          process.env.KOVA_SP_GLOBAL_ENABLED !== "true"
        )
          requiredSettings.push("KOVA_SP_GLOBAL_ENABLED");
      } else {
        const provider = OAUTH_PROVIDERS[providerId as OAuthProviderId];
        if (!provider) return { id, state: "adapter_unavailable", requiredSettings: [] };
        requiredSettings = [];
        if (!oauth.has(providerId)) {
          requiredSettings.push(...vaultSettings);
          if (!oauthClientId(provider, origin)) requiredSettings.push(provider.clientIdEnv);
          if (
            (provider.tokenClientAuth !== "none" && !hasSetting(provider.clientSecretEnv)) ||
            (id === "stripe" &&
              !/^sk_(test|live)_[A-Za-z0-9]+$/u.test(process.env[provider.clientSecretEnv] ?? ""))
          )
            requiredSettings.push(provider.clientSecretEnv);
          if (id === "tana" && !provider.tokenClientAuth)
            requiredSettings.push("TANA_MCP_TOKEN_AUTH_METHOD");
        }
      }
    }
    return {
      id,
      state: requiredSettings.length
        ? "deployment_setup_required"
        : "ready_for_account_verification",
      requiredSettings,
    };
  });
}
