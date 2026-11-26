import { createClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential, sha256 } from "./credential-vault.server";
import {
  OAUTH_PROVIDERS,
  configuredOAuthProviders,
  oauthClientId,
  type OAuthProviderId,
} from "./oauth-providers.server";
import { normalizeOAuthReturnPath } from "@/lib/oauth-security.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import {
  oauthTokenRequest,
  selectOAuthTokens,
  tanaRevocationRequest,
} from "./oauth-token-request.server.mjs";
import { readProviderJsonObject } from "@/lib/provider-response.server.mjs";
import {
  CONNECTION_FLOWS,
  hasConnectionScopes,
  TANA_MCP_ISSUER,
  TANA_MCP_RESOURCE,
} from "./connection-flows.mjs";
import { verifyTanaRead } from "./mcp-provider-read.server.mjs";
import { confirmedHealthScopes } from "@/health/health-read.server.mjs";
import {
  packSalesforceCredential,
  unpackSalesforceCredential,
  salesforceOAuthEndpoint,
} from "./salesforce-credential.server.mjs";

const admin = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const random = (bytes = 32) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
const challenge = async (verifier: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString(
    "base64url",
  );

export async function beginOAuth(input: {
  ownerId: string;
  providerId: OAuthProviderId;
  request: Request;
  browserNonce: string;
  optionalScopes?: string[];
  existingAccountId?: string;
  returnPath?: string;
}) {
  await assertLockdownAllows(admin(), input.ownerId, "connector_write");
  const provider = OAUTH_PROVIDERS[input.providerId];
  const origin = new URL(input.request.url).origin;
  const clientId = oauthClientId(provider, origin);
  if (
    !clientId ||
    !configuredOAuthProviders(origin).some((candidate) => candidate.id === provider.id)
  )
    throw new Error("provider_not_configured");
  const state = random();
  const verifier = provider.usesPkce ? random(48) : undefined;
  let previousScopes: string[] = [];
  let loginHint: string | undefined;
  if (input.existingAccountId) {
    const { data: existing, error } = await admin()
      .from("integration_linked_accounts")
      .select("granted_scopes,account_label")
      .eq("id", input.existingAccountId)
      .eq("owner_id", input.ownerId)
      .eq("provider_id", provider.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !existing) throw new Error("linked_account_not_found");
    // Request the union from the provider when adding another service. Do not
    // copy old scope claims onto a new, narrower access token.
    previousScopes = (existing.granted_scopes as string[])
      .map((scope) =>
        provider.id === "microsoft"
          ? scope.replace(/^https:\/\/graph\.microsoft\.com\//u, "")
          : scope,
      )
      .filter((scope) => provider.optionalScopes.includes(scope));
    if (provider.id === "microsoft" && typeof existing.account_label === "string")
      loginHint = existing.account_label;
  }
  const scopes =
    provider.id === "gamma"
      ? [input.optionalScopes?.includes("generate") ? "generate" : "gamma:read"]
      : [
          ...new Set([
            ...provider.requiredScopes,
            ...previousScopes,
            ...(input.optionalScopes ?? []).filter((scope) =>
              provider.optionalScopes.includes(scope),
            ),
          ]),
        ];
  const redirectUri = `${origin}/api/integrations/oauth/callback/${provider.id}`;
  const { error } = await admin()
    .from("integration_oauth_states")
    .insert({
      owner_id: input.ownerId,
      provider_id: provider.id,
      state_hash: await sha256(state),
      pkce_verifier_ciphertext: verifier ? await encryptCredential(verifier) : null,
      nonce_hash: await sha256(input.browserNonce),
      requested_scopes: scopes,
      return_path: normalizeOAuthReturnPath(input.returnPath),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  if (error) throw new Error("oauth_state_store_failed");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  if (provider.id === "stripe") params.delete("response_type");
  if (scopes.length && !["stripe", "tana"].includes(provider.id))
    params.set(
      provider.id === "slack" ? "user_scope" : "scope",
      scopes.join(["slack", "linear"].includes(provider.id) ? "," : " "),
    );
  if (provider.id === "hubspot") {
    params.set("scope", provider.requiredScopes.join(" "));
    const optional = scopes.filter((scope) => provider.optionalScopes.includes(scope));
    if (optional.length) params.set("optional_scope", optional.join(" "));
  }
  if (provider.id === "gamma") params.set("resource", "https://public-api.gamma.app");
  if (provider.id === "tana") {
    params.set("resource", TANA_MCP_RESOURCE);
    params.set("scope", "openid offline_access");
    params.set("prompt", "consent");
  }
  if (provider.id === "microsoft") params.set("response_mode", "query");
  if (loginHint) params.set("login_hint", loginHint);
  if (provider.id === "google-bigquery") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  if (provider.id === "dropbox") params.set("token_access_type", "offline");
  if (provider.id === "notion") params.set("owner", "user");
  if (verifier) {
    params.set("code_challenge", await challenge(verifier));
    params.set("code_challenge_method", provider.id === "canva" ? "s256" : "S256");
  }
  return {
    url: `${provider.authorizationEndpoint}?${params}`,
    consent: {
      provider: provider.name,
      requiredScopes: provider.requiredScopes,
      requestedOptionalScopes: scopes.filter((s) => !provider.requiredScopes.includes(s)),
    },
  };
}

export async function completeOAuth(input: {
  providerId: OAuthProviderId;
  code: string;
  state: string;
  request: Request;
  browserNonce: string;
  issuer?: string;
}) {
  const provider = OAUTH_PROVIDERS[input.providerId];
  const origin = new URL(input.request.url).origin;
  if (provider.id === "tana") {
    if (!configuredOAuthProviders(origin).some(({ id }) => id === provider.id))
      throw new Error("provider_not_configured");
    if (input.issuer !== TANA_MCP_ISSUER) throw new Error("oauth_issuer_mismatch");
  }
  const db = admin();
  const { data: record } = await db
    .from("integration_oauth_states")
    .select("*")
    .eq("provider_id", provider.id)
    .eq("state_hash", await sha256(input.state))
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!record) throw new Error("invalid_or_expired_oauth_state");
  if (record.nonce_hash !== (await sha256(input.browserNonce))) {
    throw new Error("invalid_oauth_browser_binding");
  }
  // Close the start/callback race: enabling Lockdown Mode while the provider
  // consent page is open must prevent token exchange and credential storage.
  await assertLockdownAllows(db, record.owner_id, "connector_write");
  const consumed = await db
    .from("integration_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", record.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed.data) throw new Error("oauth_state_replayed");
  const redirectUri = `${origin}/api/integrations/oauth/callback/${provider.id}`;
  const tokenRequest = oauthTokenRequest({
    providerId: provider.id,
    code: input.code,
    redirectUri,
    clientId: oauthClientId(provider, origin),
    clientSecret: process.env[provider.clientSecretEnv],
    ...(provider.id === "tana" ? { tokenClientAuth: provider.tokenClientAuth } : {}),
    verifier: record.pkce_verifier_ciphertext
      ? await decryptCredential(record.pkce_verifier_ciphertext)
      : undefined,
  });
  const tokenResponse = await fetch(provider.tokenEndpoint, {
    ...tokenRequest,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) throw new Error(`oauth_exchange_${tokenResponse.status}`);
  const tokens = selectOAuthTokens(
    provider.id,
    await readProviderJsonObject(tokenResponse, 64_000),
  );
  const needsExplicitScopes = ["calendly", "google-bigquery", "hubspot", "gamma"].includes(
    provider.id,
  );
  if (
    (needsExplicitScopes || ["oura", "whoop", "box", "canva", "figma"].includes(provider.id)) &&
    !tokens.expires_in
  )
    throw new Error("oauth_token_expiry_missing");
  if (
    (needsExplicitScopes || ["box", "canva", "figma"].includes(provider.id)) &&
    !tokens.refresh_token
  )
    throw new Error("oauth_refresh_token_missing");
  if (
    provider.id === "gamma" &&
    (record.requested_scopes.length !== 1 ||
      !["gamma:read", "generate"].includes(record.requested_scopes[0]) ||
      tokens.scope?.trim() !== record.requested_scopes[0])
  )
    throw new Error("oauth_scope_verification_failed");
  if (provider.id === "salesforce" && (!tokens.refresh_token || !tokens.scope))
    throw new Error("oauth_scope_verification_failed");
  if (
    needsExplicitScopes &&
    (!tokens.scope ||
      !hasConnectionScopes(
        tokens.scope.split(/[ ,]+/u),
        provider.requiredScopes.filter((scope) => scope !== "openid" && scope !== "email"),
      ))
  )
    throw new Error("oauth_scope_verification_failed");
  if (provider.id === "stripe") {
    const secret = process.env[provider.clientSecretEnv];
    const expectedMode = secret?.startsWith("sk_live_") ? "live:" : "test:";
    if (!tokens.provider_account_id?.startsWith(expectedMode))
      throw new Error("oauth_profile_identity_mismatch");
  }
  await assertLockdownAllows(db, record.owner_id, "connector_write");
  if (provider.id === "tana") {
    await verifyTanaRead(tokens.access_token, fetch, () =>
      assertLockdownAllows(db, record.owner_id, "connector_write"),
    );
  }
  let profile: Record<string, unknown> = { verifiedAccountId: tokens.provider_account_id };
  if (provider.profileEndpoint) {
    const profileResponse = await fetch(provider.profileEndpoint, {
      method: ["linear", "slack", "dropbox"].includes(provider.id) ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json",
        "User-Agent": "KovaGPT/1.0",
        ...(provider.id === "notion" ? { "Notion-Version": "2022-06-28" } : {}),
        ...(provider.id === "stripe" ? { "Stripe-Version": "2026-11-18.endive" } : {}),
        ...(provider.id === "linear" ? { "Content-Type": "application/json" } : {}),
      },
      body:
        provider.id === "linear"
          ? JSON.stringify({ query: "query { viewer { id name email } }" })
          : undefined,
    });
    if (!profileResponse.ok) throw new Error(`oauth_profile_${profileResponse.status}`);
    profile = await readProviderJsonObject(profileResponse, 128_000);
  }
  if (
    (provider.id === "slack" && profile.ok !== true) ||
    (provider.id === "linear" && Array.isArray(profile.errors) && profile.errors.length)
  )
    throw new Error("oauth_profile_failed");
  if (provider.id === "stripe") {
    if (profile.object !== "list" || profile.url !== "/v1/charges" || !Array.isArray(profile.data))
      throw new Error("oauth_profile_failed");
    profile = { verifiedAccountId: tokens.provider_account_id };
  }
  const providerAccountId = provider.profileId(profile);
  if (!providerAccountId) throw new Error("oauth_profile_identity_missing");
  if (provider.id === "calendly" && tokens.provider_account_id !== providerAccountId)
    throw new Error("oauth_profile_identity_mismatch");
  const granted = ["oura", "whoop"].includes(provider.id)
    ? await confirmedHealthScopes(
        provider.id,
        record.requested_scopes,
        tokens.scope,
        tokens.access_token,
        fetch,
        () => assertLockdownAllows(db, record.owner_id, "connector_write"),
      )
    : provider.id === "tana"
      ? [...provider.requiredScopes]
      : (tokens.scope ?? record.requested_scopes.join(" ")).split(/[ ,]+/).filter(Boolean);
  await assertLockdownAllows(db, record.owner_id, "connector_write");
  const { data: account, error } = await db
    .from("integration_linked_accounts")
    .upsert(
      {
        owner_id: record.owner_id,
        provider_id: provider.id,
        provider_account_id: providerAccountId,
        account_label: provider.profileLabel(profile),
        status: "connected",
        granted_scopes: granted,
        access_token_ciphertext: await encryptCredential(
          provider.id === "salesforce"
            ? packSalesforceCredential(tokens.access_token, profile)
            : tokens.access_token,
        ),
        refresh_token_ciphertext: tokens.refresh_token
          ? await encryptCredential(tokens.refresh_token)
          : null,
        token_expires_at: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        health_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error_code: null,
        deleted_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,provider_id,provider_account_id" },
    )
    .select("id, owner_id, provider_id, account_label, granted_scopes, status")
    .single();
  if (error || !account) throw new Error("linked_account_store_failed");
  await db.from("integration_consents").insert({
    owner_id: record.owner_id,
    linked_account_id: account.id,
    scopes: granted,
    purpose: "Connect provider services to KovaGPT",
    decision: "granted",
  });

  await db.from("integration_audit_events").insert({
    owner_id: record.owner_id,
    linked_account_id: account.id,
    provider_id: provider.id,
    event_type: "connect",
    result: "success",
    safe_summary: `Connected ${provider.name} account`,
  });
  return { account, returnPath: record.return_path as string };
}

async function revokeOAuthCredential(
  provider: (typeof OAUTH_PROVIDERS)[OAuthProviderId],
  account: {
    owner_id: string;
    access_token_ciphertext: string;
    refresh_token_ciphertext?: string | null;
  },
) {
  const ownerId = account.owner_id;
  const clientId = oauthClientId(provider);
  const clientSecret = process.env[provider.clientSecretEnv];
  const revocationCiphertext = ["github", "slack", "whoop", "box"].includes(provider.id)
    ? account.access_token_ciphertext
    : (account.refresh_token_ciphertext ?? account.access_token_ciphertext);
  let token: string | null = null;
  try {
    token = await decryptCredential(revocationCiphertext);
    if (provider.id === "salesforce" && !account.refresh_token_ciphertext)
      token = unpackSalesforceCredential(token).access_token;
  } catch {
    console.error("[oauth-disconnect] revocation credential unavailable", {
      providerId: provider.id,
      ownerId,
    });
  }

  if (provider.id === "tana" && provider.revocationEndpoint && token) {
    try {
      const response = await fetch(
        provider.revocationEndpoint,
        tanaRevocationRequest({
          clientId,
          clientSecret,
          tokenClientAuth: provider.tokenClientAuth,
          token,
        }),
      );
      await response.body?.cancel().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    }
  }

  // Only a confirmed provider response counts as remote revocation. Providers
  // without an implemented endpoint remain pending even though local
  // credentials are still destroyed below.
  let providerRevoked = false;
  const canAttemptRevocation =
    Boolean(provider.revocationEndpoint && token) &&
    [
      "github",
      "slack",
      "linear",
      "dropbox",
      "box",
      "whoop",
      "salesforce",
      "calendly",
      "google-bigquery",
    ].includes(provider.id) &&
    (!["github", "box", "calendly"].includes(provider.id) || Boolean(clientId && clientSecret));
  if (provider.revocationEndpoint && token && canAttemptRevocation) {
    try {
      const endpoint =
        provider.id === "salesforce"
          ? salesforceOAuthEndpoint(
              await decryptCredential(account.access_token_ciphertext),
              "revoke",
            )
          : provider.revocationEndpoint.replace("{client_id}", clientId ?? "");
      const githubAuthorization =
        provider.id === "github"
          ? `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
          : null;
      const response = await fetch(endpoint, {
        method: ["github", "whoop"].includes(provider.id) ? "DELETE" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          ...(!["salesforce", "box", "calendly", "google-bigquery"].includes(provider.id)
            ? { Authorization: githubAuthorization ?? `Bearer ${token}` }
            : {}),
          "Content-Type":
            provider.id === "github" ? "application/json" : "application/x-www-form-urlencoded",
          Accept: provider.id === "github" ? "application/vnd.github+json" : "application/json",
          ...(provider.id === "github" ? { "X-GitHub-Api-Version": "2022-11-28" } : {}),
        },
        body:
          provider.id === "github"
            ? JSON.stringify({ access_token: token })
            : ["box", "calendly"].includes(provider.id)
              ? new URLSearchParams({
                  token,
                  client_id: clientId!,
                  client_secret: clientSecret!,
                })
              : ["linear", "salesforce", "google-bigquery"].includes(provider.id)
                ? new URLSearchParams({ token })
                : undefined,
      });
      providerRevoked =
        response.ok &&
        (provider.id !== "slack" || (await readProviderJsonObject(response, 16_000)).ok === true);
    } catch {
      // A remote outage must not retain usable local credentials. The deletion
      // request below records that remote revocation still needs attention.
      providerRevoked = false;
    }
  }
  return providerRevoked;
}

export async function disconnectOAuth(ownerId: string, accountId: string) {
  const db = admin();
  const { data: account } = await db
    .from("integration_linked_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!account) throw new Error("linked_account_not_found");
  const provider = OAUTH_PROVIDERS[account.provider_id as OAuthProviderId];
  const keyFlow = CONNECTION_FLOWS[account.provider_id];
  if (!provider && keyFlow?.authentication !== "api-key")
    throw new Error("unsupported_linked_account_provider");
  const providerRevoked = provider ? await revokeOAuthCredential(provider, account) : false;
  const { error: deletionRequestError } = await db.from("integration_deletion_requests").insert({
    owner_id: ownerId,
    linked_account_id: account.id,
    status: providerRevoked ? "provider_revoked" : "pending",
  });
  if (deletionRequestError) throw new Error("linked_account_deletion_request_failed");

  const { error: syncCancellationError } = await db
    .from("integration_sync_jobs")
    .update({ status: "cancelled" })
    .eq("owner_id", ownerId)
    .eq("linked_account_id", account.id)
    .in("status", ["queued", "leased", "running", "retry_wait"]);
  if (syncCancellationError) throw new Error("linked_account_sync_cancellation_failed");

  const purge = db
    .from("integration_linked_accounts")
    .update({
      status: "revoked",
      access_token_ciphertext: "deleted",
      refresh_token_ciphertext: null,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .eq("owner_id", ownerId);
  if (!provider || provider.id === "tana") {
    purge
      .eq("provider_id", account.provider_id)
      .eq("updated_at", account.updated_at)
      .eq("access_token_ciphertext", account.access_token_ciphertext)
      .is("workspace_id", null)
      .is("deleted_at", null);
  }
  const { data: purgedAccount, error: credentialDeletionError } = await purge
    .select("id")
    .maybeSingle();
  if (credentialDeletionError || !purgedAccount) throw new Error("linked_account_purge_failed");

  const { error: auditError } = await db.from("integration_audit_events").insert({
    owner_id: ownerId,
    linked_account_id: account.id,
    provider_id: account.provider_id,
    event_type: "disconnect",
    result: providerRevoked ? "success" : "failure",
    safe_summary: `Disconnected ${provider?.name ?? keyFlow?.label} account`,
  });
  if (auditError) {
    console.error("[oauth-disconnect] audit insert failed", {
      providerId: account.provider_id,
      ownerId,
    });
  }
  return { providerRevoked };
}

export async function disconnectAllOAuth(ownerId: string) {
  const db = admin();
  const { data: accounts, error } = await db
    .from("integration_linked_accounts")
    .select("id")
    .eq("owner_id", ownerId)
    .is("deleted_at", null);
  if (error) throw new Error("linked_account_enumeration_failed");

  const failures: string[] = [];
  for (const account of accounts ?? []) {
    try {
      await disconnectOAuth(ownerId, account.id);
    } catch {
      failures.push(account.id);
    }
  }
  if (failures.length) throw new Error("linked_account_disconnect_failed");
  return { disconnected: accounts?.length ?? 0 };
}
