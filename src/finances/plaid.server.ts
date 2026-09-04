import { decryptCredential, encryptCredential } from "@/integrations/credential-vault.server";
import type { AuthedCaller } from "@/lib/api-auth.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { createClient } from "@supabase/supabase-js";
const base = () =>
  process.env.PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : process.env.PLAID_ENV === "development"
      ? "https://development.plaid.com"
      : "https://sandbox.plaid.com";
const credentialsConfigured = () =>
  Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
const configured = () => Boolean(credentialsConfigured() && process.env.PLAID_WEBHOOK_URL);
async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!credentialsConfigured()) throw new Error("plaid_not_configured");
  const response = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  if (!response.ok) throw new Error(`plaid_${response.status}`);
  return response.json() as Promise<T>;
}
export async function createFinanceLinkToken(caller: AuthedCaller, country: string) {
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "connector_write");
  if (!configured()) throw new Error("plaid_not_configured");
  const allowed = (process.env.KOVA_FINANCE_REGIONS ?? "US")
    .split(",")
    .map((v) => v.trim().toUpperCase());
  if (!allowed.includes(country.toUpperCase())) throw new Error("finance_region_ineligible");
  return call<{ link_token: string; expiration: string }>("/link/token/create", {
    user: { client_user_id: caller.userId },
    client_name: "Kova Finances",
    products: ["transactions", "liabilities", "investments"],
    country_codes: [country.toUpperCase()],
    language: "en",
    webhook: process.env.PLAID_WEBHOOK_URL,
    redirect_uri: process.env.PLAID_REDIRECT_URI,
  });
}
export async function exchangeFinanceToken(
  caller: AuthedCaller,
  publicToken: string,
  country: string,
) {
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "connector_write");
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
      country: country.toUpperCase(),
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
      country: country.toUpperCase(),
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
