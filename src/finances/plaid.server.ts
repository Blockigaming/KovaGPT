import { decryptCredential, encryptCredential } from "@/integrations/credential-vault.server";
import type { AuthedCaller } from "@/lib/api-auth.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionDomainDatabase } from "@/integrations/connection-domain.types";
import { financeCountry, financeLinkRequest, requestPlaid } from "./plaid-request.server.mjs";
import { plaidConfiguration } from "./plaid-request.server.mjs";
import { opaqueFinanceId, type VerifiedFinanceEvent } from "./plaid-webhook.server.mjs";
import { readFinanceSnapshot } from "./finance-read.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

async function financeAccess(
  caller: AuthedCaller,
  capability: "connector_read" | "connector_write",
) {
  if (caller.revalidateSession && !(await caller.revalidateSession()))
    throw new Error("finance_session_expired");
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, capability);
}
async function financeRateLimit(ownerId: string) {
  const result = await consumeApplicationRateLimit({
    identity: `user:${ownerId}`,
    action: "finance_connection",
    limit: 20,
    windowSeconds: 60,
  });
  if (!result.allowed) throw new Error("finance_rate_limited");
}
export function financeConfigured() {
  try {
    const key = process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
    if (!key || Buffer.from(key, "base64").length !== 32) return false;
    plaidConfiguration();
    financeLinkRequest("00000000-0000-4000-8000-000000000001", "US");
    return true;
  } catch {
    return false;
  }
}
async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return requestPlaid(path, body) as Promise<T>;
}
export async function createFinanceLinkToken(caller: AuthedCaller, country: string) {
  await financeAccess(caller, "connector_write");
  await financeRateLimit(caller.userId);
  const result = await call<{ link_token: string; expiration: string }>(
    "/link/token/create",
    financeLinkRequest(caller.userId, country),
  );
  await financeAccess(caller, "connector_write");
  return result;
}
export async function exchangeFinanceToken(
  caller: AuthedCaller,
  publicToken: string,
  country: string,
) {
  await financeAccess(caller, "connector_write");
  await financeRateLimit(caller.userId);
  const region = financeCountry(country);
  if (
    typeof publicToken !== "string" ||
    publicToken.length > 512 ||
    !/^public-(?:production|sandbox)-[A-Za-z0-9-]+$/u.test(publicToken)
  )
    throw new Error("public_token_required");
  const db = caller.supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>;
  const result = await call<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    { public_token: publicToken },
  );
  if (
    typeof result.item_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/u.test(result.item_id) ||
    typeof result.access_token !== "string" ||
    result.access_token.length > 1024 ||
    !result.access_token.startsWith(`access-${plaidConfiguration().mode}-`)
  )
    throw new Error("plaid_response_rejected");
  const removeUnstoredItem = async () => {
    try {
      await requestPlaid("/item/remove", { access_token: result.access_token });
    } catch {
      throw new Error("finance_connection_recovery_needed");
    }
  };
  try {
    await financeAccess(caller, "connector_write");
  } catch (error) {
    await removeUnstoredItem();
    throw error;
  }
  const id = opaqueFinanceId("plaid-item", result.item_id);
  const { data, error } = await db
    .from("financial_connections")
    .insert({
      id,
      owner_id: caller.userId,
      provider: "plaid",
      item_reference_ciphertext: await encryptCredential(JSON.stringify(result)),
      status: "connected",
      // Only Transactions is initialized by Link; additional-consented products
      // are not represented as active subscriptions or imported data.
      consented_products: ["transactions"],
      country: region,
    } as never)
    .select("id,status,country,created_at")
    .single();
  if (error) {
    // A definite constraint failure did not store the new credential. Remove
    // that new Item to end its provider subscription. A uniqueness conflict may
    // refer to an existing grant; never revoke it as automatic cleanup.
    if (error.code?.startsWith("23") && error.code !== "23505") await removeUnstoredItem();
    // Transport/representation errors can have an unknown commit outcome.
    // Do not replay the public token or remove a possibly saved Item.
    throw new Error("finance_connection_store_failed");
  }
  const audit = await db.from("account_audit_entries").insert({
    user_id: caller.userId,
    event_type: "financial_connection",
    safe_description: "Linked a read-only financial institution",
    result: "success",
    metadata: {
      provider: "plaid",
      country: region,
      paymentInitiation: false,
      trading: false,
    },
  } as never);
  if (audit.error) throw new Error("finance_audit_unavailable");
  await financeAccess(caller, "connector_write");
  return { id: data.id, status: data.status, country: data.country, created_at: data.created_at };
}

export async function listFinanceConnections(caller: AuthedCaller) {
  const db = caller.supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>;
  const { data, error } = await db
    .from("financial_connections")
    .select("id,status,country,created_at")
    .eq("owner_id", caller.userId)
    .eq("provider", "plaid")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("finance_connection_enumeration_failed");
  return { configured: financeConfigured(), connections: data ?? [] };
}

export async function readFinanceConnection(caller: AuthedCaller, id: string) {
  await financeAccess(caller, "connector_read");
  await financeRateLimit(caller.userId);
  const db = caller.supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>;
  const lookup = () =>
    db
      .from("financial_connections")
      .select("id,item_reference_ciphertext,status")
      .eq("id", id)
      .eq("owner_id", caller.userId)
      .eq("provider", "plaid")
      .eq("status", "connected")
      .is("deleted_at", null)
      .maybeSingle();
  const { data: connection, error } = await lookup();
  if (error || !connection) throw new Error("finance_connection_not_found");
  const credential = JSON.parse(await decryptCredential(connection.item_reference_ciphertext)) as {
    access_token?: string;
  };
  if (!credential.access_token) throw new Error("finance_connection_credential_invalid");
  const ensureCurrent = async () => {
    const current = await lookup();
    await financeAccess(caller, "connector_read");
    if (
      current.error ||
      !current.data ||
      current.data.item_reference_ciphertext !== connection.item_reference_ciphertext
    )
      throw new Error("finance_connection_changed");
  };
  const result = await readFinanceSnapshot(credential.access_token, requestPlaid, ensureCurrent);
  const audit = await db.from("account_audit_entries").insert({
    user_id: caller.userId,
    event_type: "financial_connection_read",
    safe_description: "Read balances and recent transactions on request",
    result: "success",
    metadata: { provider: "plaid", connectionId: id, backgroundImport: false },
  } as never);
  if (audit.error) throw new Error("finance_audit_unavailable");
  await ensureCurrent();
  return result;
}

export async function disconnectFinanceConnection(caller: AuthedCaller, id: string) {
  await financeRateLimit(caller.userId);
  const db = caller.supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>;
  const { data, error } = await db
    .from("financial_connections")
    .select("id,item_reference_ciphertext")
    .eq("id", id)
    .eq("owner_id", caller.userId)
    .eq("provider", "plaid")
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new Error("finance_connection_not_found");
  const credential = JSON.parse(await decryptCredential(data.item_reference_ciphertext)) as {
    access_token?: string;
  };
  if (!credential.access_token) throw new Error("finance_connection_credential_invalid");
  // Offboarding remains possible in Lockdown Mode. Never drop the only
  // credential before Plaid confirms that the Item and its billing are removed.
  await requestPlaid("/item/remove", { access_token: credential.access_token });
  const removed = await db
    .from("financial_connections")
    .delete()
    .eq("id", id)
    .eq("owner_id", caller.userId)
    .eq("item_reference_ciphertext", data.item_reference_ciphertext)
    .select("id")
    .maybeSingle();
  if (removed.error || !removed.data) throw new Error("finance_connection_purge_failed");
  return { disconnected: true };
}

export async function persistFinanceWebhook(
  db: SupabaseClient<ConnectionDomainDatabase>,
  event: VerifiedFinanceEvent,
) {
  const id = opaqueFinanceId("plaid-item", event.itemId);
  const connection = await db
    .from("financial_connections")
    .select("id,owner_id,item_reference_ciphertext")
    .eq("id", id)
    .eq("provider", "plaid")
    .is("deleted_at", null)
    .maybeSingle();
  if (connection.error) throw new Error("finance_webhook_store_unavailable");
  // Removed/unknown Items cannot trigger data access. There is nothing to sync.
  if (!connection.data) return { received: true, ignored: true };
  const credential = JSON.parse(
    await decryptCredential(connection.data.item_reference_ciphertext),
  ) as { item_id?: string };
  if (credential.item_id !== event.itemId) throw new Error("finance_webhook_item_mismatch");
  const receipt = await db.from("integration_audit_events").upsert(
    {
      id: opaqueFinanceId("plaid-event", event.bodyHash),
      owner_id: connection.data.owner_id,
      provider_id: "plaid",
      event_type: "notification_received",
      result: "success",
      safe_summary: "Received a verified finance notification. Data is read on request.",
      metadata: { connectionId: id, type: event.type, code: event.code, bodyHash: event.bodyHash },
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (receipt.error) throw new Error("finance_webhook_store_unavailable");
  return { received: true };
}

type FinanceConnectionRow = {
  id: string;
  item_reference_ciphertext: string;
};

export async function disconnectAllFinance(caller: AuthedCaller) {
  const db = caller.supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>;
  const { data: rawConnections, error } = await db
    .from("financial_connections")
    .select("id,item_reference_ciphertext")
    .eq("owner_id", caller.userId)
    .eq("provider", "plaid");
  if (error) throw new Error("finance_connection_enumeration_failed");
  const connections = (rawConnections ?? []) as unknown as FinanceConnectionRow[];

  for (const connection of connections) {
    let accessToken: string;
    try {
      const credential = JSON.parse(
        await decryptCredential(connection.item_reference_ciphertext),
      ) as { access_token?: unknown };
      if (typeof credential.access_token !== "string" || !credential.access_token) {
        throw new Error("finance_access_token_missing");
      }
      accessToken = credential.access_token;
    } catch {
      throw new Error("finance_connection_credential_invalid");
    }

    // Plaid requires /item/remove during offboarding to invalidate the token
    // and end subscription billing. Keep the Kova account intact when Plaid
    // cannot confirm removal so the user can retry or contact support.
    await call<{ request_id: string }>("/item/remove", { access_token: accessToken });

    const { data: purgedConnection, error: purgeError } = await db
      .from("financial_connections")
      .delete()
      .eq("id", connection.id)
      .eq("owner_id", caller.userId)
      .select("id")
      .maybeSingle();
    if (purgeError || !purgedConnection) throw new Error("finance_connection_purge_failed");
  }

  return { disconnected: connections.length };
}
