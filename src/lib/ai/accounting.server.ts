import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAiRuntimeConfig } from "@/lib/ai/config.server";
import { actualCostUsd, type CatalogModel } from "@/lib/ai/model-catalog.server";
import { resolveCurrentBillingPeriod } from "@/lib/ai/billing-period.mjs";
import { BILLING_ENV } from "@/lib/billing-plans";
import { runtimeEnv } from "@/lib/runtime-env.server";

type AccountingClient = SupabaseClient;
type Plan = "guest" | "free" | "plus" | "pro";
type TerminalStatus =
  | "completed"
  | "aborted"
  | "timed_out"
  | "provider_rejected"
  | "provider_failed"
  | "client_disconnected"
  | "accounting_failed";

function client(): AccountingClient {
  const url = runtimeEnv("SUPABASE_URL");
  const key = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("ai_accounting_unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function hashGuestIp(ip: string): Promise<string> {
  const secret = getAiRuntimeConfig().ipHashSecret;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function billingPeriod(
  db: AccountingClient,
  userId: string | null,
  signal?: AbortSignal,
): Promise<[string, string]> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (!userId) return [monthStart.toISOString(), monthEnd.toISOString()];
  const nowIso = now.toISOString();
  let periodQuery = db
    .from("subscriptions")
    .select("environment,status,current_period_start,current_period_end")
    .eq("user_id", userId)
    .eq("environment", BILLING_ENV)
    .in("status", ["active", "trialing", "past_due"])
    .lte("current_period_start", nowIso)
    .gt("current_period_end", nowIso)
    .order("current_period_end", { ascending: false })
    .limit(5);
  if (signal) periodQuery = periodQuery.abortSignal(signal);
  const { data, error } = await periodQuery;
  if (error) throw new Error("billing_period_lookup_failed");
  return (
    resolveCurrentBillingPeriod(data, {
      billingEnvironment: BILLING_ENV,
      now: now.getTime(),
    }) ?? [monthStart.toISOString(), monthEnd.toISOString()]
  );
}

export type Acquisition = { eventId: string } | { rejection: string };

export async function acquireGeneration(input: {
  requestId: string;
  idempotencyKey: string;
  userId: string | null;
  guestIpHash: string | null;
  conversationId?: string;
  mode: string;
  plan: Plan;
  premium: boolean;
  model: CatalogModel;
  estimatedInputTokens: number;
  reservedTokens: number;
  estimatedCostUsd: number;
  contextTrimmed: boolean;
  signal?: AbortSignal;
}): Promise<Acquisition> {
  const config = getAiRuntimeConfig();
  const db = client();
  const [periodStart, periodEnd] = await billingPeriod(db, input.userId, input.signal);
  const principalConcurrency = input.userId
    ? config.maxConcurrentPerUser
    : config.maxConcurrentPerGuest;
  let acquisitionQuery = db.rpc("acquire_ai_generation", {
    p_request_id: input.requestId,
    p_idempotency_key: input.idempotencyKey,
    p_user_id: input.userId,
    p_guest_ip_hash: input.guestIpHash,
    p_conversation_id: input.conversationId ?? null,
    p_mode: input.mode,
    p_plan: input.plan,
    p_premium: input.premium,
    p_model: input.model.id,
    p_estimated_input: input.estimatedInputTokens,
    p_reserved_tokens: input.reservedTokens,
    p_estimated_cost: input.estimatedCostUsd,
    p_context_trimmed: input.contextTrimmed,
    p_daily_limit: config.maxTokensPerUserDay,
    p_monthly_limit: config.maxTokensPerUserMonth,
    p_premium_limit: config.maxPremiumRequestsPeriod,
    p_guest_limit: config.maxGuestRequestsPerIp,
    p_global_concurrency: config.maxConcurrentGlobal,
    p_principal_concurrency: principalConcurrency,
    p_lease_seconds: config.leaseSeconds,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (input.signal) acquisitionQuery = acquisitionQuery.abortSignal(input.signal);
  const { data, error } = await acquisitionQuery;
  if (error || !Array.isArray(data) || !data[0]) {
    console.error("[ai-accounting] acquire failed", {
      code: error?.code ?? null,
      message: error?.message ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
      hasData: Array.isArray(data),
      rows: Array.isArray(data) ? data.length : 0,
    });
    throw new Error("ai_accounting_unavailable");
  }
  const row = data[0] as { event_id: string | null; decision: string };
  return row.event_id ? { eventId: row.event_id } : { rejection: row.decision };
}

export async function finalizeGeneration(input: {
  eventId: string;
  status: TerminalStatus;
  model: CatalogModel;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs: number;
  toolCalls: number;
  error?: string;
}): Promise<void> {
  const usage = {
    input: Math.max(0, input.inputTokens ?? 0),
    cachedInput: Math.max(0, input.cachedInputTokens ?? 0),
    output: Math.max(0, input.outputTokens ?? 0),
  };
  const { data, error } = await client().rpc("finalize_ai_generation", {
    p_event_id: input.eventId,
    p_status: input.status,
    p_input: usage.input,
    p_cached: usage.cachedInput,
    p_output: usage.output,
    p_reasoning: Math.max(0, input.reasoningTokens ?? 0),
    p_actual_cost: actualCostUsd(input.model, usage),
    p_latency: Math.max(0, input.latencyMs),
    p_tools: { calls: input.toolCalls },
    p_error: input.error ?? null,
  });
  if (error || data !== true) throw new Error("ai_accounting_finalize_failed");
}
