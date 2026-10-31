import type { AuthedCaller } from "@/lib/api-auth.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionDomainDatabase } from "@/integrations/connection-domain.types";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { configuredOAuthProviders } from "@/integrations/oauth-providers.server";
import { decryptCredential } from "@/integrations/credential-vault.server";
import { refreshExpiringConnection } from "@/integrations/connected-tools.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { HEALTH_PROVIDERS, type HealthProviderId } from "./providers.mjs";
import { readHealthSummary } from "./health-read.server.mjs";

export async function readHealthAccount(caller: AuthedCaller, accountId: string) {
  const db = caller.supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>;
  const assertAllowed = async () => {
    if (caller.revalidateSession && !(await caller.revalidateSession()))
      throw new Error("health_session_expired");
    await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "connector_read");
  };
  await assertAllowed();
  const rate = await consumeApplicationRateLimit({
    identity: `user:${caller.userId}`,
    action: "health_read",
    limit: 15,
    windowSeconds: 60,
  });
  if (!rate.allowed) throw new Error("health_rate_limited");
  const lookup = () =>
    db
      .from("integration_linked_accounts")
      .select(
        "id,provider_id,status,access_token_ciphertext,token_expires_at,granted_scopes,updated_at",
      )
      .eq("id", accountId)
      .eq("owner_id", caller.userId)
      .is("workspace_id", null)
      .is("deleted_at", null)
      .maybeSingle();
  let { data: row, error } = await lookup();
  if (
    error ||
    !row ||
    row.status !== "connected" ||
    !Object.hasOwn(HEALTH_PROVIDERS, row.provider_id)
  )
    throw new Error("health_account_unavailable");
  if (!configuredOAuthProviders().some((provider) => provider.id === row!.provider_id))
    throw new Error("health_not_configured");
  if (row.token_expires_at && Date.parse(row.token_expires_at) <= Date.now() + 60_000) {
    const refreshed = await refreshExpiringConnection(caller.userId, row.id, row.updated_at);
    if (!refreshed) throw new Error("health_reconnect_required");
    const latest = await lookup();
    row = latest.data;
    error = latest.error;
    if (error || !row || row.status !== "connected") throw new Error("health_account_unavailable");
  }
  const binding = row;
  const ensureCurrent = async () => {
    const current = await lookup();
    await assertAllowed();
    if (
      current.error ||
      !current.data ||
      current.data.status !== "connected" ||
      current.data.provider_id !== binding.provider_id ||
      current.data.updated_at !== binding.updated_at ||
      current.data.access_token_ciphertext !== binding.access_token_ciphertext ||
      (current.data.token_expires_at &&
        Date.parse(current.data.token_expires_at) <= Date.now() + 30_000) ||
      !configuredOAuthProviders().some((provider) => provider.id === binding.provider_id)
    )
      throw new Error("health_binding_changed");
  };
  const result = await readHealthSummary(
    binding.provider_id as HealthProviderId,
    binding.granted_scopes,
    await decryptCredential(binding.access_token_ciphertext),
    ensureCurrent,
  );
  const audit = await db.from("integration_audit_events").insert({
    owner_id: caller.userId,
    linked_account_id: accountId,
    provider_id: binding.provider_id,
    event_type: "health_summary_read",
    result: "success",
    safe_summary: "Read health summaries on request; no chat context or search index created.",
  });
  if (audit.error) throw new Error("health_audit_unavailable");
  await ensureCurrent();
  return result;
}
