import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  prepareDeveloperQuote,
  runMeteredProvider,
  type DeveloperAdmission,
  type MeterRequest,
} from "./developer-metering.mjs";

type BillingContext = { keyId: string; requestKey: string; nextCall: number };
const contextKey = Symbol.for("kovagpt.developer-billing-context");
const shared = globalThis as typeof globalThis & {
  [contextKey]?: AsyncLocalStorage<BillingContext>;
};
const context = (shared[contextKey] ??= new AsyncLocalStorage<BillingContext>());
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Call only after authenticating a developer key. Never populate this from body/header billing fields. */
export function withDeveloperBilling<T>(
  identity: { keyId: string; requestKey: string },
  callback: () => T,
): T {
  if (!uuid.test(identity.keyId) || !/^[\x21-\x7e]{1,128}$/.test(identity.requestKey))
    throw new Error("developer_identity_invalid");
  return context.run({ ...identity, nextCall: 0 }, callback);
}

function billingClient() {
  const url = runtimeEnv("SUPABASE_URL"),
    key = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("developer_billing_unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await billingClient().rpc(name, args).abortSignal(AbortSignal.timeout(10000));
  if (result.error) throw new Error("developer_billing_unavailable");
  return result.data as T;
}

export async function recoverDeveloperBilling(): Promise<number> {
  // Retention/accounting maintenance remains available while paid generation is disabled.
  const recovered = await rpc<number>("recover_developer_billing", { p_limit: 100 });
  const administrators = (runtimeEnv("KOVA_ADMIN_USER_IDS") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => uuid.test(id))
    .slice(0, 25);
  if (administrators.length)
    await rpc<number>("deliver_developer_billing_alerts", {
      p_administrators: administrators,
      p_limit: 100,
    });
  return recovered;
}

export async function meterProviderRequest(
  input: MeterRequest & { send: () => Promise<Response>; signal?: AbortSignal },
): Promise<Response> {
  const current = context.getStore();
  // Consumer plan accounting remains owned by acquire/finalizeGeneration.
  if (!current) return input.send();
  if (runtimeEnv("KOVA_DEVELOPER_BILLING_ENABLED") !== "true")
    throw new Error("developer_billing_disabled");
  const call = current.nextCall++;
  if (call >= 16) throw new Error("developer_call_limit");
  input.signal?.throwIfAborted();
  const db = billingClient(),
    now = new Date().toISOString();
  const { data: key, error: keyError } = await db
    .from("developer_billing_keys")
    .select("account_id")
    .eq("id", current.keyId)
    .eq("enabled", true)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (keyError || !key) throw new Error("developer_key_unavailable");
  const { data: account, error: accountError } = await db
    .from("developer_credit_accounts")
    .select("currency")
    .eq("id", key.account_id)
    .is("suspended_at", null)
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (accountError || !account) throw new Error("developer_account_unavailable");
  const { data: version, error: versionError } = await db
    .from("api_pricing_versions")
    .select("*")
    .eq("currency", account.currency)
    .eq("status", "approved")
    .lte("effective_at", now)
    .gt("expires_at", now)
    .order("version", { ascending: false })
    .limit(1)
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (versionError || !version) throw new Error("developer_pricing_unavailable");
  const { data: registry, error: registryError } = await db
    .from("upstream_price_registry")
    .select("*")
    .eq("provider", input.provider)
    .eq("upstream_model", String(input.body.model))
    .eq("currency", account.currency)
    .eq("active", true)
    .eq("verification_status", "approved")
    .lte("effective_at", now)
    .gt("expires_at", now)
    .order("version", { ascending: true })
    .limit(257)
    .abortSignal(AbortSignal.timeout(10000));
  if (registryError || !registry || registry.length > 256)
    throw new Error("developer_pricing_unavailable");
  const prepared = prepareDeveloperQuote({ version, registry }, input, new Date(now));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({ provider: input.provider, capability: input.capability, body: input.body }),
    )
    .digest("hex");
  const requestKey = createHash("sha256").update(current.requestKey).digest("hex");
  return runMeteredProvider({
    prepared,
    signal: input.signal,
    send: input.send,
    admit: () =>
      rpc<DeveloperAdmission>("admit_developer_billing", {
        p_key: current.keyId,
        p_request_key: `${requestKey}:${call}`,
        p_fingerprint: fingerprint,
        p_provider: input.provider,
        p_model: input.body.model,
        p_capability: input.capability,
        p_version: version.id,
        p_quote: prepared.quote,
        p_limits: prepared.contract.maximumUsage,
      }),
    dispatch: (admission) =>
      rpc<boolean>("dispatch_developer_billing", {
        p_request: admission.request_id,
        p_lease: admission.lease_token,
      }),
    finish: async (admission, outcome, result) => {
      const ok = await rpc<boolean>("finish_developer_billing", {
        p_request: admission.request_id,
        p_lease: admission.lease_token,
        p_outcome: outcome,
        p_result: result ?? {},
      });
      if (!ok) throw new Error("developer_settlement_unavailable");
    },
  });
}
