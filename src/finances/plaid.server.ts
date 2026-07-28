import { encryptCredential } from "@/integrations/credential-vault.server";
import type { AuthedCaller } from "@/lib/api-auth.server";
import { createClient } from "@supabase/supabase-js";
const base = () =>
  process.env.PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : process.env.PLAID_ENV === "development"
      ? "https://development.plaid.com"
      : "https://sandbox.plaid.com";
const configured = () =>
  Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.PLAID_WEBHOOK_URL);
async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!configured()) throw new Error("plaid_not_configured");
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
