import { planAllowance } from "../plan-usage-policy.mjs";
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

/** A read-only sizing hint. acquireGeneration remains the atomic admission gate. */
export async function getGenerationTokenHeadroom(input: {
  userId: string;
  plan: "free";
  model?: CatalogModel;
  signal?: AbortSignal;
}): Promise<{
  tokenLimit: number;
  limitingQuota:
    "daily_tokens" | "monthly_tokens" | "monthly_cost" | "weekly_cost" | "five_hour_cost";
}> {
  const config = getAiRuntimeConfig();
  const db = client();
  if (input.model) {
    let query = db.rpc("kova_plan_cost_progress", { _user_id: input.userId, _plan: input.plan });
    if (input.signal) query = query.abortSignal(input.signal);
    const { data, error } = await query;
    // Only a missing migration permits the older token-ledger fallback.
    if (error && !["PGRST202", "42883"].includes(error.code))
      throw new Error("usage_headroom_unavailable");
    if (!error) {
      if (!Array.isArray(data) || data.length !== 1) throw new Error("usage_headroom_unavailable");
      const row = data[0];
      const remaining = [
        ["monthly_cost", row.month_used, row.monthly_allowance],
        ["weekly_cost", row.weekly_used, row.weekly_allowance],
        ["five_hour_cost", row.five_hour_used, row.five_hour_allowance],
      ]
        .map(([quota, used, allowance]) => {
          if (
            used == null ||
            allowance == null ||
            !Number.isFinite(Number(used)) ||
            !Number.isFinite(Number(allowance)) ||
            Number(used) < 0 ||
            Number(allowance) < 0
          )
            throw new Error("usage_headroom_unavailable");
          return { quota, available: Math.max(0, Number(allowance) - Number(used)) };
        })
        .sort((a, b) => a.available - b.available);
      const rate = Math.max(...Object.values(input.model.pricePerMillion));
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("usage_headroom_unavailable");
      // Conservatively size the complete request at the highest token rate.
      // The atomic cost reservation still checks the actual input/output estimate.
      return {
        tokenLimit: Math.min(
          Number.MAX_SAFE_INTEGER,
          Math.floor((remaining[0].available * 1_000_000) / rate),
        ),
        limitingQuota: remaining[0].quota as "monthly_cost" | "weekly_cost" | "five_hour_cost",
      };
    }
  }
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  let usedDay = 0;
  let usedMonth = 0;
  let expectedCount: number | undefined;
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = db
      .from("ai_usage_events")
      .select("created_at,actual_billable_tokens,reserved_tokens", { count: "exact" })
      .eq("user_id", input.userId)
      .gte("created_at", monthStart)
      .not("status", "in", "(quota_rejected,provider_rejected,provider_failed,accounting_failed)")
      // Included Pro basic chat never spends a capped advanced allowance.
      .or(
        "plan_tier.neq.pro,provider_model.neq.kova-argon-4.6,kova_mode.neq.instant,premium.eq.true",
      )
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (input.signal) query = query.abortSignal(input.signal);
    const { data, error, count } = await query;
    if (
      error ||
      !Array.isArray(data) ||
      !Number.isSafeInteger(count) ||
      count === null ||
      count < 0 ||
      count > 10_000 ||
      (expectedCount !== undefined && count !== expectedCount)
    )
      throw new Error("usage_headroom_unavailable");
    expectedCount = count;
    for (const row of data) {
      const tokens = row.actual_billable_tokens ?? row.reserved_tokens;
      const created = Date.parse(row.created_at);
      if (!Number.isSafeInteger(tokens) || tokens < 0 || !Number.isFinite(created))
        throw new Error("usage_headroom_unavailable");
      usedMonth += tokens;
      if (created >= dayStart) usedDay += tokens;
      if (!Number.isSafeInteger(usedMonth)) throw new Error("usage_headroom_unavailable");
    }
    if (offset + data.length === count) break;
    if (data.length !== pageSize) throw new Error("usage_headroom_unavailable");
  }
  const daily = Math.max(0, planAllowance(config.maxTokensPerUserDay, input.plan) - usedDay);
  const monthly = Math.max(0, planAllowance(config.maxTokensPerUserMonth, input.plan) - usedMonth);
  return {
    tokenLimit: Math.min(daily, monthly),
    limitingQuota: daily <= monthly ? "daily_tokens" : "monthly_tokens",
  };
}

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
  creditFallback?: { messageOverflow: boolean };
  signal?: AbortSignal;
}): Promise<Acquisition> {
  const config = getAiRuntimeConfig();
  const db = client();
  const [periodStart, periodEnd] = await billingPeriod(db, input.userId, input.signal);
  const principalConcurrency = input.userId
    ? config.maxConcurrentPerUser
    : config.maxConcurrentPerGuest;
  const acquisitionRpc = input.creditFallback
    ? "acquire_credit_eligible_generation"
    : "acquire_ai_generation";
  let acquisitionQuery = db.rpc(acquisitionRpc, {
    ...(input.creditFallback ? { p_message_overflow: input.creditFallback.messageOverflow } : {}),
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
    p_daily_limit: planAllowance(config.maxTokensPerUserDay, input.plan),
    p_monthly_limit: planAllowance(config.maxTokensPerUserMonth, input.plan),
    p_premium_limit: planAllowance(config.maxPremiumRequestsPeriod, input.plan),
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
