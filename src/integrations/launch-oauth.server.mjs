import { createHash } from "node:crypto";
import {
  ConnectorError,
  normalizeScopes,
  requireLaunchConnector,
  requirePermissions,
} from "./launch-contracts.mjs";
import {
  bearerHeaders,
  formPost,
  jsonPost,
  providerRequest,
  salesforceOrigin,
} from "./launch-http.server.mjs";
export const NOTION_VERSION = "2025-09-03";
export function providerConfig(id, env = process.env) {
  const contract = requireLaunchConnector(id),
    clientId = env[`${contract.env}_OAUTH_CLIENT_ID`],
    clientSecret = env[`${contract.env}_OAUTH_CLIENT_SECRET`];
  if (!clientId || (id !== "slack" && !clientSecret))
    throw new ConnectorError("provider_not_configured", 503);
  return { clientId, clientSecret: clientSecret ?? "" };
}
const basic = ({ clientId, clientSecret }) =>
  `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
export function authorizationUrl(id, config, { state, verifier, redirectUri }) {
  const contract = requireLaunchConnector(id),
    url = new URL(contract.authorize);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  }).toString();
  if (contract.scopes.length)
    url.searchParams.set(
      id === "slack" ? "user_scope" : "scope",
      contract.scopes.join(id === "slack" || id === "linear" ? "," : " "),
    );
  if (id === "notion") url.searchParams.set("owner", "user");
  if (contract.pkce) {
    if (!verifier) throw new ConnectorError("oauth_verifier_missing", 400);
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}
export async function exchangeGrant(id, config, grant, transport = {}, previous = null) {
  const contract = requireLaunchConnector(id);
  const fields = { grant_type: grant.refreshToken ? "refresh_token" : "authorization_code" };
  if (grant.refreshToken) fields.refresh_token = grant.refreshToken;
  else {
    fields.code = grant.code;
    fields.redirect_uri = grant.redirectUri;
    if (contract.pkce) fields.code_verifier = grant.verifier;
  }
  const request =
    id === "notion"
      ? jsonPost(fields, { Authorization: basic(config), "Notion-Version": NOTION_VERSION })
      : formPost(
          {
            ...fields,
            client_id: config.clientId,
            ...(id === "slack" ? {} : { client_secret: config.clientSecret }),
          },
          { Accept: "application/json" },
        );
  const raw = await providerRequest(contract.token, request, transport);
  // Slack search needs the user token, never the bot token. Refresh is top-level.
  const token = id === "slack" && !grant.refreshToken ? raw.authed_user : raw;
  if (
    !token ||
    typeof token.access_token !== "string" ||
    !token.access_token ||
    token.access_token.length > 20_000
  )
    throw new ConnectorError("oauth_access_token_missing");
  if (token.token_type && !["bearer", "user"].includes(String(token.token_type).toLowerCase()))
    throw new ConnectorError("oauth_token_type_invalid");
  try {
    let scopes = normalizeScopes(token.scope ?? token.scopes),
      subject,
      label,
      origin = previous?.origin ?? null;
    const headers = bearerHeaders(token.access_token);
    if (contract.family === "microsoft") {
      const profile = await providerRequest(
        "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName",
        { headers },
        transport,
      );
      subject = profile.id;
      label = profile.userPrincipalName || profile.displayName;
    } else if (id === "slack") {
      const profile = await providerRequest(
        "https://slack.com/api/auth.test",
        { method: "POST", headers },
        transport,
      );
      if (!profile.team_id || !profile.user_id || profile.bot_id)
        throw new ConnectorError("oauth_user_identity_required");
      subject = `${profile.team_id}:${profile.user_id}`;
      label = profile.team;
    } else if (id === "notion") {
      const profile = await providerRequest(
        "https://api.notion.com/v1/users/me",
        { headers: { ...headers, "Notion-Version": NOTION_VERSION } },
        transport,
      );
      if (!profile.id || !profile.bot) throw new ConnectorError("oauth_profile_identity_missing");
      subject = profile.id;
      label = profile.bot.workspace_name || profile.name || "Notion workspace";
    } else if (id === "linear") {
      const profile = await providerRequest(
        "https://api.linear.app/graphql",
        jsonPost(
          { query: "query KovaIdentity { viewer { id name } organization { id name } }" },
          headers,
        ),
        transport,
      );
      if (!profile.data?.viewer?.id || !profile.data?.organization?.id)
        throw new ConnectorError("oauth_profile_identity_missing");
      subject = `${profile.data.organization.id}:${profile.data.viewer.id}`;
      label = profile.data.organization.name;
    } else if (id === "hubspot") {
      const profile = await providerRequest(
        "https://api.hubspot.com/oauth/v3/token/introspect",
        formPost({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          token_type_hint: "access_token",
          access_token: token.access_token,
        }),
        transport,
      );
      if (
        profile.active !== true ||
        !profile.hub_id ||
        !profile.user_id ||
        profile.client_id !== config.clientId
      )
        throw new ConnectorError("oauth_profile_identity_missing");
      subject = `${profile.hub_id}:${profile.user_id}`;
      label = profile.hub_domain || String(profile.hub_id);
      scopes = normalizeScopes(profile.scopes);
    } else if (id === "salesforce") {
      origin = salesforceOrigin(token.instance_url ?? previous?.origin);
      const profile = await providerRequest(
        `${origin}/services/oauth2/userinfo`,
        { headers },
        transport,
      );
      if (!profile.organization_id || !profile.user_id)
        throw new ConnectorError("oauth_profile_identity_missing");
      subject = `${profile.organization_id}:${profile.user_id}`;
      label = profile.preferred_username || profile.name;
      if (!scopes.length) {
        const introspection = await providerRequest(
          "https://login.salesforce.com/services/oauth2/introspect",
          formPost(
            { token: token.access_token, token_type_hint: "access_token" },
            { Authorization: basic(config) },
          ),
          transport,
        );
        if (introspection.active !== true)
          throw new ConnectorError("reauthorization_required", 401);
        scopes = normalizeScopes(introspection.scope);
      }
    }
    if (typeof subject !== "string" || !subject || subject.length > 500)
      throw new ConnectorError("oauth_profile_identity_missing");
    if (previous && (previous.subject !== subject || previous.origin !== origin))
      throw new ConnectorError("oauth_account_changed", 409);
    // RFC 6749 permits omitted unchanged scopes on refresh only, never initial consent.
    if (
      grant.refreshToken &&
      token.scope === undefined &&
      token.scopes === undefined &&
      id !== "hubspot" &&
      id !== "salesforce"
    )
      scopes = previous?.scopes ?? [];
    requirePermissions(id, scopes);
    const lifetime = token.expires_in === undefined ? null : Number(token.expires_in);
    if (
      lifetime !== null &&
      (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 366 * 86400)
    )
      throw new ConnectorError("oauth_expiry_invalid");
    return {
      accessToken: token.access_token,
      refreshToken:
        typeof token.refresh_token === "string" && token.refresh_token
          ? token.refresh_token
          : (previous?.refreshToken ?? null),
      expiresAt: lifetime === null ? null : new Date(Date.now() + lifetime * 1000).toISOString(),
      scopes,
      subject,
      label: typeof label === "string" ? label.slice(0, 180) : contract.name,
      origin,
    };
  } catch (error) {
    // Compensate if the provider minted a token before validation failed.
    await revokeGrant(
      id,
      config,
      {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? previous?.refreshToken ?? null,
      },
      transport,
    );
    throw error;
  }
}
export async function revokeGrant(id, config, token, transport = {}) {
  const contract = requireLaunchConnector(id);
  // Microsoft broad sign-out and HubSpot whole-portal uninstall exceed a single
  // connection's authority. Report local-only cleanup until narrow cleanup is verified.
  if (contract.family === "microsoft" || id === "hubspot")
    return { providerRevoked: false, remoteStatus: "manual_revocation_required" };
  try {
    if (id === "slack") {
      for (const value of [token.refreshToken, token.accessToken].filter(Boolean)) {
        const result = await providerRequest(
          "https://slack.com/api/auth.revoke",
          formPost({ token: value }),
          transport,
        );
        if (result.revoked !== true) throw new ConnectorError("revocation_unconfirmed");
      }
    } else if (id === "notion") {
      await providerRequest(
        "https://api.notion.com/v1/oauth/revoke",
        jsonPost(
          { token: token.accessToken },
          { Authorization: basic(config), "Notion-Version": NOTION_VERSION },
        ),
        transport,
      );
    } else if (id === "linear") {
      await providerRequest(
        "https://api.linear.app/oauth/revoke",
        formPost({
          token: token.refreshToken || token.accessToken,
          token_type_hint: token.refreshToken ? "refresh_token" : "access_token",
        }),
        { ...transport, allowEmpty: true },
      );
    } else if (id === "salesforce") {
      await providerRequest(
        "https://login.salesforce.com/services/oauth2/revoke",
        formPost({ token: token.refreshToken || token.accessToken }),
        { ...transport, allowEmpty: true },
      );
    }
    return { providerRevoked: true, remoteStatus: "provider_confirmed" };
  } catch {
    return { providerRevoked: false, remoteStatus: "manual_revocation_required" };
  }
}
