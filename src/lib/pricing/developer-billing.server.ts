import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { pricingRegistryIds } from "./pricing-administration.mjs";
import { fundingAdjustedVersion } from "./developer-funding-allowance.mjs";
import { bindDeveloperImageInput } from "./developer-image-edit-policy.mjs";
import {
  prepareDeveloperQuote,
  runMeteredProvider,
  type DeveloperAdmission,
  type MeterRequest,
} from "./developer-metering.mjs";

type BillingContext = {
  keyId: string;
  requestKey: string;
  nextCall: number;
  pricingVersion?: string;
  maximumCharge?: number;
  requestFingerprint?: string;
  fileBindings?: { id: string; digest: string }[];
};
const contextKey = Symbol.for("kovagpt.developer-billing-context");
const shared = globalThis as typeof globalThis & {
  [contextKey]?: AsyncLocalStorage<BillingContext>;
};
const context = (shared[contextKey] ??= new AsyncLocalStorage<BillingContext>());
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Call only after authenticating a developer key. Never populate this from body/header billing fields. */
export function withDeveloperBilling<T>(
  identity: {
    keyId: string;
    requestKey: string;
    pricingVersion?: string;
    maximumCharge?: number;
    requestFingerprint?: string;
    fileBindings?: { id: string; digest: string }[];
  },
  callback: () => T,
): T {
  if (!uuid.test(identity.keyId) || !/^[\x21-\x7e]{1,128}$/.test(identity.requestKey))
    throw new Error("developer_identity_invalid");
  if (
    (identity.pricingVersion !== undefined && !uuid.test(identity.pricingVersion)) ||
    (identity.maximumCharge !== undefined &&
      (!Number.isFinite(identity.maximumCharge) || identity.maximumCharge < 0))
  )
    throw new Error("developer_identity_invalid");
  if (
    identity.requestFingerprint !== undefined &&
    !/^[a-f0-9]{64}$/.test(identity.requestFingerprint)
  )
    throw new Error("developer_identity_invalid");
  if (
    identity.fileBindings !== undefined &&
    (!Array.isArray(identity.fileBindings) ||
      identity.fileBindings.length > 4 ||
      identity.fileBindings.some(
        (file) => !uuid.test(file.id) || !/^[a-f0-9]{64}$/.test(file.digest),
      ))
  )
    throw new Error("developer_identity_invalid");
  return context.run(
    { ...identity, fileBindings: identity.fileBindings?.map((file) => ({ ...file })), nextCall: 0 },
    callback,
  );
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
  const creditLots = runtimeEnv("KOVA_DEVELOPER_CREDIT_LOTS_V2") === "true";
  const recovered = await rpc<number>(
    creditLots ? "recover_developer_billing_v2" : "recover_developer_billing",
    { p_limit: 100 },
  );
  if (creditLots) {
    // Each owner is handled in a separate transaction, so maintenance never
    // holds several owners' locks while waiting for a billing lock.
    const due = await rpc<{ owner_id: string; account_id: string }[]>(
      "developer_due_wallet_refresh_v2",
      { p_limit: 5 },
    );
    let failures = 0;
    for (const wallet of due) {
      try {
        await rpc("developer_refresh_wallet_v2", {
          p_owner: wallet.owner_id,
          p_account: wallet.account_id,
        });
      } catch {
        failures++;
      }
    }
    if (failures) console.warn("[developer-billing] credit refresh failed", { failures });
  }
  await rpc<number>("expire_developer_files", { p_limit: 100 });
  if (runtimeEnv("KOVA_DEVELOPER_VECTOR_SCHEMA_READY") === "true")
    await rpc<number>("expire_developer_vector_stores_v1", { p_limit: 100 });
  if (runtimeEnv("KOVA_DEVELOPER_CONVERSATION_SCHEMA_READY") === "true")
    await rpc<number>("expire_developer_conversations_v1", { p_limit: 100 });
  if (runtimeEnv("KOVA_DEVELOPER_REALTIME_SESSION_SCHEMA_READY") === "true")
    await rpc<number>("expire_developer_realtime_sessions_v1", { p_limit: 100 });
  await rpc<number>("expire_discovery_usage", { p_limit: 100 });
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
  input: MeterRequest & {
    send: () => Promise<Response>;
    signal?: AbortSignal;
    imageInputs?: {
      image: { bytes: Uint8Array; contentType: string };
      mask?: { bytes: Uint8Array; contentType: string };
    };
  },
): Promise<Response> {
  const current = context.getStore();
  // Consumer plan accounting remains owned by acquire/finalizeGeneration.
  if (!current) {
    if (
      [
        "cloud_browser",
        "audio_transcription",
        "audio_speech",
        "realtime",
        "audio_translation",
      ].includes(input.capability)
    )
      throw new Error("developer_billing_disabled");
    return input.send();
  }
  if (runtimeEnv("KOVA_DEVELOPER_BILLING_ENABLED") !== "true")
    throw new Error("developer_billing_disabled");
  if (input.imageInputs) {
    if (
      runtimeEnv("KOVA_DEVELOPER_IMAGE_EDITS_ENABLED") !== "true" ||
      runtimeEnv("KOVA_IMAGE_EDITS_ENABLED") === "false" ||
      input.provider !== "openai" ||
      input.capability !== "image_generation"
    )
      throw new Error("developer_image_edits_unavailable");
    input = { ...input, body: bindDeveloperImageInput(input.body, input.imageInputs) };
  } else if (input.body.image !== undefined || input.body.mask !== undefined) {
    throw new Error("developer_image_invalid");
  }
  if (
    input.capability !== "file_analysis" &&
    input.body.max_tool_calls !== undefined &&
    runtimeEnv("KOVA_DEVELOPER_WEB_SEARCH_ENABLED") !== "true"
  )
    throw new Error("developer_web_search_unavailable");
  if (
    input.capability === "moderation" &&
    runtimeEnv("KOVA_DEVELOPER_MODERATION_ENABLED") !== "true"
  )
    throw new Error("developer_moderation_unavailable");
  if (input.capability === "decisions" && runtimeEnv("KOVA_DEVELOPER_DECISIONS_ENABLED") !== "true")
    throw new Error("developer_decision_unavailable");
  if (
    input.capability === "file_analysis" &&
    (input.provider !== "openai" || runtimeEnv("KOVA_DEVELOPER_ANALYSIS_ENABLED") !== "true")
  )
    throw new Error("developer_analysis_unavailable");
  if (
    input.capability === "computer_use" &&
    (input.provider !== "openai" || runtimeEnv("KOVA_DEVELOPER_COMPUTER_USE_ENABLED") !== "true")
  )
    throw new Error("developer_computer_unavailable");
  if (
    input.capability === "cloud_browser" &&
    (input.provider !== "browserbase" || runtimeEnv("KOVA_DEVELOPER_BROWSER_ENABLED") !== "true")
  )
    throw new Error("developer_browser_unavailable");
  if (
    input.capability === "audio_transcription" &&
    (input.provider !== "openai" || runtimeEnv("KOVA_DEVELOPER_TRANSCRIPTION_ENABLED") !== "true")
  )
    throw new Error("developer_transcription_unavailable");
  if (
    input.capability === "audio_speech" &&
    (input.provider !== "elevenlabs" || runtimeEnv("KOVA_DEVELOPER_SPEECH_ENABLED") !== "true")
  )
    throw new Error("developer_speech_unavailable");
  if (
    input.capability === "audio_translation" &&
    (input.provider !== "openai" || runtimeEnv("KOVA_DEVELOPER_TRANSLATION_ENABLED") !== "true")
  )
    throw new Error("developer_translation_unavailable");
  if (
    input.capability === "realtime" &&
    (input.provider !== "openai" || runtimeEnv("KOVA_DEVELOPER_REALTIME_ENABLED") !== "true")
  )
    throw new Error("developer_realtime_unavailable");
  const creditLots = runtimeEnv("KOVA_DEVELOPER_CREDIT_LOTS_V2") === "true";
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
    .select("currency,funding_collection_rate")
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
  if (current.pricingVersion && current.pricingVersion !== version.id)
    throw new Error("developer_quote_expired");
  const { data: registry, error: registryError } = await db
    .from("upstream_price_registry")
    .select("*")
    .in("id", pricingRegistryIds(version))
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
  const prepared = prepareDeveloperQuote(
    { version: fundingAdjustedVersion(version, account), registry },
    input,
    new Date(now),
  );
  if (
    current.maximumCharge !== undefined &&
    Number(prepared.quote.maximumReservedCharge) > current.maximumCharge
  )
    throw new Error("developer_quote_changed");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({ provider: input.provider, capability: input.capability, body: input.body }),
    )
    .digest("hex");
  const requestKey = createHash("sha256").update(current.requestKey).digest("hex");
  if (current.requestFingerprint && current.requestFingerprint !== fingerprint)
    throw new Error("developer_quote_changed");
  return runMeteredProvider({
    prepared,
    signal: input.signal,
    send: input.send,
    admit: () =>
      rpc<DeveloperAdmission>(
        creditLots ? "admit_developer_billing_v2" : "admit_developer_billing",
        {
          p_key: current.keyId,
          p_request_key: `${requestKey}:${call}`,
          p_fingerprint: fingerprint,
          p_provider: input.provider,
          p_model: input.body.model,
          p_capability: input.capability,
          p_version: version.id,
          p_quote: prepared.quote,
          p_limits: prepared.contract.maximumUsage,
        },
      ),
    dispatch: (admission) =>
      rpc<boolean>(
        creditLots
          ? "dispatch_developer_billing_v2"
          : current.fileBindings?.length
            ? "dispatch_developer_billing_with_files"
            : "dispatch_developer_billing",
        {
          p_request: admission.request_id,
          p_lease: admission.lease_token,
          ...(current.fileBindings?.length ? { p_files: current.fileBindings } : {}),
        },
      ),
    finish: async (admission, outcome, result) => {
      const ok = await rpc<boolean>(
        creditLots ? "finish_developer_billing_v2" : "finish_developer_billing",
        {
          p_request: admission.request_id,
          p_lease: admission.lease_token,
          p_outcome: outcome,
          p_result: result ?? {},
        },
      );
      if (!ok) throw new Error("developer_settlement_unavailable");
    },
  });
}
