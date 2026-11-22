import { calendlyUserUri } from "./connection-flows.mjs";

// Notion's token endpoint uses HTTP Basic client authentication and a JSON
// payload, unlike the form-encoded exchanges used by the other adapters.
// https://developers.notion.com/reference/create-a-token
export function oauthTokenRequest({
  providerId,
  clientId,
  clientSecret,
  code,
  redirectUri,
  verifier,
}) {
  if (!clientId || !clientSecret) throw new Error("provider_not_configured");
  const fields = { grant_type: "authorization_code", code, redirect_uri: redirectUri };
  if (providerId === "notion") {
    return {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify(fields),
    };
  }
  const basicClientAuth = ["figma", "canva", "calendly"].includes(providerId);
  const body = new URLSearchParams({
    ...fields,
    ...(basicClientAuth ? {} : { client_id: clientId, client_secret: clientSecret }),
  });
  if (verifier) body.set("code_verifier", verifier);
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      ...(basicClientAuth
        ? {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          }
        : {}),
      ...(["oura", "whoop"].includes(providerId) ? { "User-Agent": "KovaGPT/1.0" } : {}),
    },
    body,
  };
}

// Slack returns a bot token at the top level. Message search must use the
// explicitly granted user token under authed_user, never the bot credential.
export function selectOAuthTokens(providerId, payload) {
  if (!payload || typeof payload !== "object" || payload.error || payload.ok === false)
    throw new Error("oauth_token_exchange_failed");
  const tokens = providerId === "slack" ? payload.authed_user : payload;
  if (
    !tokens ||
    typeof tokens.access_token !== "string" ||
    !tokens.access_token ||
    (providerId === "slack" && tokens.token_type !== "user")
  )
    throw new Error("oauth_access_token_missing");
  let declaredScopes = tokens.scope;
  if (providerId === "hubspot") {
    declaredScopes =
      Array.isArray(tokens.scopes) &&
      tokens.scopes.every((value) => typeof value === "string" && /^[\w.:-]+$/u.test(value))
        ? tokens.scopes.join(" ")
        : undefined;
  }
  const hubId = tokens.hub_id;
  const accountId =
    providerId === "hubspot" && Number.isSafeInteger(hubId) && hubId > 0
      ? String(hubId)
      : providerId === "calendly"
        ? calendlyUserUri(tokens.owner)
        : "";
  return {
    access_token: tokens.access_token,
    ...(accountId ? { provider_account_id: accountId } : {}),
    ...(typeof tokens.refresh_token === "string" ? { refresh_token: tokens.refresh_token } : {}),
    ...(Number.isFinite(tokens.expires_in) && tokens.expires_in > 0
      ? { expires_in: tokens.expires_in }
      : {}),
    ...(typeof declaredScopes === "string" ? { scope: declaredScopes } : {}),
  };
}

export function oauthRefreshRequest({ providerId, clientId, clientSecret, refreshToken }) {
  if (
    ![
      "microsoft",
      "linear",
      "slack",
      "oura",
      "whoop",
      "salesforce",
      "notion",
      "box",
      "canva",
      "figma",
      "calendly",
      "gamma",
      "google-bigquery",
      "hubspot",
    ].includes(providerId)
  )
    throw new Error("refresh_not_supported");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("refresh_not_configured");
  if (providerId === "notion")
    return {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
        Authorization: "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
      },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    };
  const basicClientAuth = ["figma", "canva", "calendly"].includes(providerId);
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "KovaGPT/1.0",
      ...(basicClientAuth
        ? {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          }
        : {}),
    },
    body: new URLSearchParams({
      ...(providerId === "figma" ? {} : { grant_type: "refresh_token" }),
      ...(basicClientAuth ? {} : { client_id: clientId, client_secret: clientSecret }),
      refresh_token: refreshToken,
      ...(providerId === "whoop" ? { scope: "offline" } : {}),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  };
}

export function selectRefreshTokens(providerId, payload) {
  if (providerId === "slack" && payload?.token_type !== "user")
    throw new Error("oauth_access_token_missing");
  const tokens = selectOAuthTokens(providerId === "slack" ? "refresh" : providerId, payload);
  // Salesforce and Notion may omit expires_in. A rejected API read triggers
  // a claimed refresh instead of inventing a lifetime for those tokens.
  if (!tokens.expires_in && !["salesforce", "notion"].includes(providerId))
    throw new Error("refresh_expiry_missing");
  if (["notion", "box", "canva", "calendly", "gamma"].includes(providerId) && !tokens.refresh_token)
    throw new Error("refresh_token_missing");
  return tokens;
}
