import { createClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential, sha256 } from "./credential-vault.server";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "./oauth-providers.server";

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
  optionalScopes?: string[];
  returnPath?: string;
}) {
  const provider = OAUTH_PROVIDERS[input.providerId];
  const clientId = process.env[provider.clientIdEnv];
  if (!clientId || !process.env[provider.clientSecretEnv])
    throw new Error("provider_not_configured");
  const state = random();
  const verifier = provider.usesPkce ? random(48) : undefined;
  const nonce = random();
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
      nonce_hash: await sha256(nonce),
      requested_scopes: scopes,
      return_path: input.returnPath?.startsWith("/") ? input.returnPath : "/apps",
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
  await db
    .from("integration_deletion_requests")
    .insert({
      owner_id: ownerId,
      linked_account_id: account.id,
      status: providerRevoked ? "provider_revoked" : "pending",
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
  const token = account.refresh_token_ciphertext
    ? await decryptCredential(account.refresh_token_ciphertext)
    : await decryptCredential(account.access_token_ciphertext);
  let providerRevoked = !provider.revocationEndpoint;
  if (provider.revocationEndpoint) {
    const endpoint = provider.revocationEndpoint.replace(
      "{client_id}",
      process.env[provider.clientIdEnv] ?? "",
    );
    const response = await fetch(endpoint, {
      method: provider.id === "github" ? "DELETE" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body:
        provider.id === "box"
          ? new URLSearchParams({
              token,
              client_id: process.env[provider.clientIdEnv]!,
              client_secret: process.env[provider.clientSecretEnv]!,
            })
          : undefined,
    });
    providerRevoked = response.ok;
  }
  await db
    .from("integration_audit_events")
    .insert({
      owner_id: ownerId,
      linked_account_id: account.id,
      provider_id: provider.id,
      event_type: "disconnect",
      result: providerRevoked ? "success" : "failure",
      safe_summary: `Disconnected ${provider.name} account`,
    });
  await db
    .from("integration_sync_jobs")
    .update({ status: "cancelled" })
    .eq("owner_id", ownerId)
    .eq("linked_account_id", account.id)
    .in("status", ["queued", "leased", "running", "retry_wait"]);
  await db
    .from("integration_linked_accounts")
    .update({
      status: "revoked",
      access_token_ciphertext: "deleted",
      refresh_token_ciphertext: null,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .eq("owner_id", ownerId);
  await db
    .from("integration_consents")
    .insert({
      owner_id: record.owner_id,
      linked_account_id: account.id,
      scopes: granted,
      purpose: "Connect provider services to KovaGPT",
      decision: "granted",
    });

  await db
    .from("integration_audit_events")
    .insert({
      owner_id: record.owner_id,
      linked_account_id: account.id,
      provider_id: provider.id,
      event_type: "connect",
      result: "success",
      safe_summary: `Connected ${provider.name} account`,
    });
  return { providerRevoked };
}
