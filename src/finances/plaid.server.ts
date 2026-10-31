import { decryptCredential, encryptCredential } from "@/integrations/credential-vault.server";
import type { AuthedCaller } from "@/lib/api-auth.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { createClient } from "@supabase/supabase-js";
import { financeCountry, financeLinkRequest, requestPlaid } from "./plaid-request.server.mjs";
async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return requestPlaid(path, body) as Promise<T>;
}
export async function createFinanceLinkToken(caller: AuthedCaller, country: string) {
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "connector_write");
  return call<{ link_token: string; expiration: string }>(
    "/link/token/create",
    financeLinkRequest(caller.userId, country),
  );
}
export async function exchangeFinanceToken(
  caller: AuthedCaller,
  publicToken: string,
  country: string,
) {
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "connector_write");
  const region = financeCountry(country);
  if (
    typeof publicToken !== "string" ||
    publicToken.length > 512 ||
    !/^public-(?:production|sandbox)-[A-Za-z0-9-]+$/u.test(publicToken)
  )
    throw new Error("public_token_required");
  const db = caller.supabaseAdmin as unknown as ReturnType<typeof createClient>;
  const result = await call<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    { public_token: publicToken },
  );
  const { data, error } = await db
    .from("financial_connections")
    .insert({
      owner_id: caller.userId,
      provider: "plaid",
      item_reference_ciphertext: await encryptCredential(JSON.stringify(result)),
      status: "connected",
      consented_products: ["transactions", "liabilities", "investments"],
      country: region,
    } as never)
    .select("id,status,country,created_at")
    .single();
  if (error) throw new Error("finance_connection_store_failed");
  await db.from("account_audit_entries").insert({
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
  return data;
}

type FinanceConnectionRow = {
  id: string;
  item_reference_ciphertext: string;
};

export async function disconnectAllFinance(caller: AuthedCaller) {
  const db = caller.supabaseAdmin as unknown as ReturnType<typeof createClient>;
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
