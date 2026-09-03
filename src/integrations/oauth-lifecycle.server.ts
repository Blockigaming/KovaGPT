import { createClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential, sha256 } from "./credential-vault.server";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "./oauth-providers.server";
import { normalizeOAuthReturnPath } from "@/lib/oauth-security.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";

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
  returnPath?: string;
}) {
  await assertLockdownAllows(admin(), input.ownerId, "connector_write");
  const provider = OAUTH_PROVIDERS[input.providerId];
  const clientId = process.env[provider.clientIdEnv];
  if (!clientId || !process.env[provider.clientSecretEnv])
    throw new Error("provider_not_configured");
  const state = random();
  const verifier = provider.usesPkce ? random(48) : undefined;
  const scopes = [
    ...new Set([
      ...provider.requiredScopes,
      ...(input.optionalScopes ?? []).filter((scope) => provider.optionalScopes.includes(scope)),
    ]),
  ];
  const redirectUri = `${new URL(input.request.url).origin}/api/integrations/oauth/callback/${provider.id}`;
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
  if (scopes.length) params.set("scope", scopes.join(provider.id === "slack" ? "," : " "));
  if (provider.id === "microsoft") params.set("response_mode", "query");
  if (provider.id === "dropbox") params.set("token_access_type", "offline");
  if (provider.id === "notion") params.set("owner", "user");
  if (verifier) {
    params.set("code_challenge", await challenge(verifier));
    params.set("code_challenge_method", "S256");
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

type TokenPayload = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};
export async function completeOAuth(input: {
  providerId: OAuthProviderId;
  code: string;
  state: string;
  request: Request;
  browserNonce: string;
}) {
  const provider = OAUTH_PROVIDERS[input.providerId];
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
  const redirectUri = `${new URL(input.request.url).origin}/api/integrations/oauth/callback/${provider.id}`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri,
    client_id: process.env[provider.clientIdEnv]!,
    client_secret: process.env[provider.clientSecretEnv]!,
  });
  if (record.pkce_verifier_ciphertext)
    body.set("code_verifier", await decryptCredential(record.pkce_verifier_ciphertext));
  const tokenResponse = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenResponse.ok) throw new Error(`oauth_exchange_${tokenResponse.status}`);
  const tokens = (await tokenResponse.json()) as TokenPayload;
  if (!tokens.access_token) throw new Error("oauth_access_token_missing");
  const profileResponse = await fetch(provider.profileEndpoint, {
    method: provider.id === "linear" ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: "application/json",
      ...(provider.id === "notion" ? { "Notion-Version": "2022-06-28" } : {}),
      ...(provider.id === "linear" ? { "Content-Type": "application/json" } : {}),
    },
    body:
      provider.id === "linear"
        ? JSON.stringify({ query: "query { viewer { id name email } }" })
        : undefined,
  });
  if (!profileResponse.ok) throw new Error(`oauth_profile_${profileResponse.status}`);
  const profile = (await profileResponse.json()) as Record<string, unknown>;
  const providerAccountId = provider.profileId(profile);
  if (!providerAccountId) throw new Error("oauth_profile_identity_missing");
  const granted = (tokens.scope ?? record.requested_scopes.join(" "))
    .split(/[ ,]+/)
    .filter(Boolean);
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
        access_token_ciphertext: await encryptCredential(tokens.access_token),
        refresh_token_ciphertext: tokens.refresh_token
          ? await encryptCredential(tokens.refresh_token)
          : null,
        token_expires_at: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        health_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error_code: null,
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
  if (!provider) throw new Error("unsupported_linked_account_provider");
  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  const revocationCiphertext =
    provider.id === "github"
      ? account.access_token_ciphertext
      : (account.refresh_token_ciphertext ?? account.access_token_ciphertext);
  let token: string | null = null;
  try {
    token = await decryptCredential(revocationCiphertext);
  } catch {
    console.error("[oauth-disconnect] revocation credential unavailable", {
      providerId: provider.id,
      ownerId,
    });
  }

  // Only a confirmed provider response counts as remote revocation. Providers
  // without an implemented endpoint remain pending even though local
  // credentials are still destroyed below.
  let providerRevoked = false;
  const canAttemptRevocation =
    Boolean(provider.revocationEndpoint && token) &&
    (provider.id !== "github" || Boolean(clientId && clientSecret));
  if (provider.revocationEndpoint && token && canAttemptRevocation) {
    const endpoint = provider.revocationEndpoint.replace("{client_id}", clientId ?? "");
    const githubAuthorization =
      provider.id === "github"
        ? `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
        : null;
    const response = await fetch(endpoint, {
      method: provider.id === "github" ? "DELETE" : "POST",
      headers: {
        Authorization: githubAuthorization ?? `Bearer ${token}`,
        "Content-Type":
          provider.id === "github" ? "application/json" : "application/x-www-form-urlencoded",
        Accept: provider.id === "github" ? "application/vnd.github+json" : "application/json",
        ...(provider.id === "github" ? { "X-GitHub-Api-Version": "2022-11-28" } : {}),
      },
      body:
        provider.id === "github"
          ? JSON.stringify({ access_token: token })
          : provider.id === "box"
            ? new URLSearchParams({
                token,
                client_id: clientId!,
                client_secret: clientSecret!,
              })
            : undefined,
    });
    providerRevoked = response.ok;
  }
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

  const { data: purgedAccount, error: credentialDeletionError } = await db
    .from("integration_linked_accounts")
    .update({
      status: "revoked",
      access_token_ciphertext: "deleted",
      refresh_token_ciphertext: null,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();
  if (credentialDeletionError || !purgedAccount) throw new Error("linked_account_purge_failed");

  const { error: auditError } = await db.from("integration_audit_events").insert({
    owner_id: ownerId,
    linked_account_id: account.id,
    provider_id: provider.id,
    event_type: "disconnect",
    result: providerRevoked ? "success" : "failure",
    safe_summary: `Disconnected ${provider.name} account`,
  });
  if (auditError) {
    console.error("[oauth-disconnect] audit insert failed", {
      providerId: provider.id,
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
