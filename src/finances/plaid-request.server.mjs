import { readResponseBytesBounded } from "../lib/endpoint-reliability.mjs";

const HOSTS = Object.freeze({
  production: "https://production.plaid.com",
  sandbox: "https://sandbox.plaid.com",
});
const PATHS = new Set([
  "/link/token/create",
  "/link/token/get",
  "/item/public_token/exchange",
  "/item/get",
  "/item/remove",
  "/accounts/get",
  "/transactions/sync",
  "/investments/holdings/get",
  "/investments/transactions/get",
  "/liabilities/get",
  "/webhook_verification_key/get",
]);
const MAX_RESPONSE_BYTES = 256 * 1024;

export function financeCountry(country, env = process.env) {
  const allowed = (env.KOVA_FINANCE_REGIONS ?? "US").split(",").map((value) => value.trim());
  if (
    typeof country !== "string" ||
    !/^[a-z]{2}$/iu.test(country) ||
    allowed.length > 20 ||
    allowed.some((value) => !/^[a-z]{2}$/iu.test(value)) ||
    !allowed.some((value) => value.toUpperCase() === country.toUpperCase())
  )
    throw new Error("finance_region_ineligible");
  return country.toUpperCase();
}

export function financeLinkRequest(userId, country, env = process.env) {
  plaidConfiguration(env);
  const region = financeCountry(country, env);
  if (
    typeof userId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(userId)
  ) {
    throw new Error("plaid_request_rejected");
  }
  const secureUrl = (value) => {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.href;
  };
  let webhook, redirect;
  try {
    webhook = secureUrl(env.PLAID_WEBHOOK_URL);
    if (env.PLAID_REDIRECT_URI) redirect = secureUrl(env.PLAID_REDIRECT_URI);
  } catch {
    throw new Error("plaid_not_configured");
  }
  return {
    user: { client_user_id: userId },
    client_name: "Kova Finances",
    // Requiring all three products excludes institutions that do not support
    // every product. Plaid recommends this combination for personal finance:
    // https://plaid.com/docs/link/initializing-products/#personal-finance
    products: ["transactions"],
    additional_consented_products: ["liabilities", "investments"],
    country_codes: [region],
    language: "en",
    webhook,
    ...(redirect ? { redirect_uri: redirect } : {}),
  };
}

export function plaidConfiguration(env = process.env) {
  const mode = env.PLAID_ENV;
  const clientId = env.PLAID_CLIENT_ID;
  const secret = env.PLAID_SECRET;
  if (
    !Object.hasOwn(HOSTS, mode ?? "") ||
    typeof clientId !== "string" ||
    !clientId ||
    clientId.length > 256 ||
    /\s/u.test(clientId) ||
    typeof secret !== "string" ||
    !secret ||
    secret.length > 1024 ||
    /\s/u.test(secret) ||
    (env.AZURE_ENVIRONMENT === "production" && mode !== "production")
  ) {
    throw new Error("plaid_not_configured");
  }
  return { mode, base: HOSTS[mode], clientId, secret };
}

// Fixed destinations and operations; this transport cannot initiate payments,
// transfer funds, trade, follow redirects or silently select Sandbox.
export async function requestPlaid(
  path,
  body,
  { env = process.env, fetchImpl = fetch, signal, timeoutMs = 12_000 } = {},
) {
  const config = plaidConfiguration(env);
  if (
    !PATHS.has(path) ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.hasOwn(body, "client_id") ||
    Object.hasOwn(body, "secret") ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 12_000
  ) {
    throw new Error("plaid_request_rejected");
  }
  let serialized;
  try {
    serialized = JSON.stringify(body);
    if (
      typeof serialized !== "string" ||
      new TextEncoder().encode(serialized).byteLength > 64 * 1024
    )
      throw new Error();
  } catch {
    throw new Error("plaid_request_rejected");
  }
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  if (combined.aborted) throw new Error("plaid_request_cancelled");
  let response;
  try {
    response = await fetchImpl(`${config.base}${path}`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: combined,
      headers: {
        "Content-Type": "application/json",
        "Plaid-Version": "2020-09-14",
        "PLAID-CLIENT-ID": config.clientId,
        "PLAID-SECRET": config.secret,
      },
      body: serialized,
    });
  } catch {
    throw new Error(combined.aborted ? "plaid_request_cancelled" : "plaid_transport_failed");
  }
  if (!response.ok) {
    Promise.resolve(response.body?.cancel()).catch(() => undefined);
    throw new Error(`plaid_${response.status}`);
  }
  let value;
  try {
    const bytes = await readResponseBytesBounded(response, MAX_RESPONSE_BYTES, {
      signal: combined,
      timeoutMs,
    });
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(combined.aborted ? "plaid_request_cancelled" : "plaid_response_rejected");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("plaid_response_rejected");
  }
  return value;
}
