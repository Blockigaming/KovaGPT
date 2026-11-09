import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { decryptSecret, encryptSecret } from "@/lib/github-oauth.server";
import { readProviderJsonObject } from "@/lib/provider-response.server.mjs";
import {
  githubTokenRefreshRequest,
  selectRotatedGithubTokens,
} from "@/lib/github-token-refresh-request.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub rows are not present in the generated schema types. */

// Never reuse a refresh token concurrently: each token pair is single-use and
// account ownership, token version, and reconnect revocation are rechecked at
// every state transition. A crashed attempt remains degraded until its lease
// ages out; a rejected token requires fresh, explicit OAuth consent.
export async function refreshExpiringGitHubAccount(ownerId: string, accountId: string) {
  await assertLockdownAllows(supabaseAdmin, ownerId, "connector_read");
  const db = supabaseAdmin as any;
  const { data: row, error } = await db
    .from("github_accounts")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", accountId)
    .eq("auth_type", "oauth")
    .maybeSingle();
  if (error || !row || !["connected", "degraded"].includes(row.status)) return false;

  const expiry = row.token_expires_at ? Date.parse(row.token_expires_at) : Number.POSITIVE_INFINITY;
  if (row.status === "connected" && expiry > Date.now() + 60_000) return true;
  if (!row.refresh_token_ciphertext || !row.token_ciphertext || !Number.isFinite(expiry))
    return false;
  if (
    row.status === "degraded" &&
    row.last_refresh_at &&
    Date.parse(row.last_refresh_at) > Date.now() - 60_000
  )
    return false;
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;

  const lease = new Date().toISOString();
  const claimed = await db
    .from("github_accounts")
    .update({ status: "degraded", last_refresh_at: lease, updated_at: lease })
    .eq("owner_id", ownerId)
    .eq("id", row.id)
    .eq("auth_type", "oauth")
    .eq("status", row.status)
    .eq("updated_at", row.updated_at)
    .eq("token_ciphertext", row.token_ciphertext)
    .eq("refresh_token_ciphertext", row.refresh_token_ciphertext)
    .select("id")
    .maybeSingle();
  if (claimed.error || !claimed.data) return false;

  const ensureLease = async () => {
    await assertLockdownAllows(supabaseAdmin, ownerId, "connector_read");
    const check = await db
      .from("github_accounts")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("id", row.id)
      .eq("auth_type", "oauth")
      .eq("status", "degraded")
      .eq("updated_at", lease)
      .eq("token_ciphertext", row.token_ciphertext)
      .eq("refresh_token_ciphertext", row.refresh_token_ciphertext)
      .maybeSingle();
    if (check.error || !check.data) throw new Error("github_refresh_binding_changed");
  };
  let rejected = false;
  try {
    await ensureLease();
    const refresh = await decryptSecret(row.refresh_token_ciphertext);
    await ensureLease();
    const request = githubTokenRefreshRequest(clientId, clientSecret, refresh);
    const response = await fetch(request.url, request.init);
    const payload = await readProviderJsonObject(response, 64_000);
    if (!response.ok) {
      rejected = payload?.error === "bad_refresh_token" || payload?.error === "invalid_grant";
      throw new Error("github_token_refresh_failed");
    }
    const rotated = selectRotatedGithubTokens(payload);
    const profileResponse = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${rotated.accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!profileResponse.ok) {
      await profileResponse.body?.cancel();
      throw new Error("github_refreshed_identity_unavailable");
    }
    const profile = await readProviderJsonObject(profileResponse, 64_000);
    if (
      !Number.isSafeInteger(profile.id) ||
      String(profile.id) !== String(row.github_user_id)
    ) {
      rejected = true;
      throw new Error("github_refreshed_identity_changed");
    }
    await ensureLease();
    const nextAccess = await encryptSecret(rotated.accessToken);
    const nextRefresh = await encryptSecret(rotated.refreshToken);
    await ensureLease();
    const at = new Date().toISOString();
    const write = await db
      .from("github_accounts")
      .update({
        status: "connected",
        token_ciphertext: nextAccess,
        refresh_token_ciphertext: nextRefresh,
        token_expires_at: new Date(Date.now() + rotated.expiresIn * 1000).toISOString(),
        last_health_at: at,
        last_refresh_at: at,
        updated_at: at,
      })
      .eq("owner_id", ownerId)
      .eq("id", row.id)
      .eq("auth_type", "oauth")
      .eq("status", "degraded")
      .eq("updated_at", lease)
      .eq("token_ciphertext", row.token_ciphertext)
      .eq("refresh_token_ciphertext", row.refresh_token_ciphertext)
      .select("id")
      .maybeSingle();
    return !write.error && Boolean(write.data);
  } catch {
    // If GitHub consumed the old token but the result was uncertain, never
    // replay it immediately. A later attempt may fail closed to reconnect.
    await db
      .from("github_accounts")
      .update({ status: rejected ? "reauthorization_required" : "degraded" })
      .eq("owner_id", ownerId)
      .eq("id", row.id)
      .eq("auth_type", "oauth")
      .eq("status", "degraded")
      .eq("updated_at", lease)
      .eq("token_ciphertext", row.token_ciphertext)
      .eq("refresh_token_ciphertext", row.refresh_token_ciphertext);
    return false;
  }
}

export async function refreshExpiringGitHubOwnerAccounts(ownerId: string) {
  await assertLockdownAllows(supabaseAdmin, ownerId, "connector_read");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("github_accounts")
    .select("id,status,token_expires_at")
    .eq("owner_id", ownerId)
    .eq("auth_type", "oauth")
    .in("status", ["connected", "degraded"])
    .limit(21);
  if (error || !Array.isArray(data) || data.length > 20)
    throw new Error("github_refresh_accounts_unavailable");
  // Keep refresh traffic bounded on each user-triggered request.
  let refreshed = 0;
  for (const row of data) {
    const expiry = row.token_expires_at ? Date.parse(row.token_expires_at) : Number.POSITIVE_INFINITY;
    if (
      (row.status !== "connected" || expiry <= Date.now() + 60_000) &&
      refreshed < 3
    ) {
      refreshed += 1;
      await refreshExpiringGitHubAccount(ownerId, row.id);
    }
  }
}
