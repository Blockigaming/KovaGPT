import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { workExecutionDatabase } from "@/lib/work-execution-database.server";
import { acquireGeneration } from "@/lib/ai/accounting.server";
import { settleWorkAccounting } from "@/lib/work-accounting-settlement.server";
import {
  OPENAI_TEXT_MODELS,
  estimateMaximumCostUsd,
  actualCostUsd,
} from "@/lib/ai/model-catalog.server";
import { getAiRuntimeConfig } from "@/lib/ai/config.server";
import type { WorkRun, WorkRunner } from "@/lib/work-execution-protocol.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  createWorkRunnerTransport,
  parseWorkRunnerConfiguration,
  workRunnerMatchesOwnerHistory,
  type AttemptBinding,
  type RunnerReceipt,
} from "@/lib/work-runner-transport.mjs";

/**
 * A reviewed deployment must configure the pinned HTTPS adapter and keys. The
 * enable flag alone is insufficient; a signed, bound capability heartbeat from
 * that exact build is mandatory. Legacy workers remain disabled.
 */
export function workRunnerConfiguration() {
  return parseWorkRunnerConfiguration({
    enabled: runtimeEnv("KOVA_WORK_RUNNER_ENABLED") === "true",
    origin: runtimeEnv("KOVA_WORK_RUNNER_ORIGIN"),
    id: runtimeEnv("KOVA_WORK_RUNNER_ID"),
    build: runtimeEnv("KOVA_WORK_RUNNER_BUILD"),
    token: runtimeEnv("KOVA_WORK_RUNNER_TOKEN"),
    signingKey: runtimeEnv("KOVA_WORK_RUNNER_SIGNING_KEY"),
  });
}
export function configuredWorkRunnerTransport() {
  const configuration = workRunnerConfiguration();
  return configuration ? createWorkRunnerTransport(configuration) : null;
}
export async function registeredWorkRunner(): Promise<WorkRunner | null> {
  try {
    return (await configuredWorkRunnerTransport()?.heartbeat()) ?? null;
  } catch {
    return null;
  }
}

export function configuredWorkRunnerAdapter() {
  const transport = configuredWorkRunnerTransport();
  if (!transport) throw new Error("work_runner_unavailable");
  return {
    attestation: () => transport.heartbeat(),
    async reason(
      input: Record<string, unknown>,
      guards: { signal: AbortSignal; assertLease(): Promise<void> },
    ) {
      await guards.assertLease();
      let attempt = await transport.submit(input, guards.signal);
      const binding: AttemptBinding = {
        runId: attempt.runId,
        ownerId: attempt.ownerId,
        epoch: attempt.epoch,
        stepId: attempt.stepId,
        inputHash: attempt.inputHash,
      };
      try {
        while (attempt.status === "accepted" || attempt.status === "running") {
          await new Promise<void>((resolve, reject) => {
            if (guards.signal.aborted) {
              reject(new Error("work_attempt_aborted"));
              return;
            }
            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error("work_attempt_aborted"));
            };
            const timer = setTimeout(() => {
              guards.signal.removeEventListener("abort", onAbort);
              resolve();
            }, 1000);
            guards.signal.addEventListener("abort", onAbort, { once: true });
          });
          await guards.assertLease();
          attempt = await transport.status(binding, guards.signal);
        }
        if (
          !["completed", "question", "approval_required", "effect_completed", "failed"].includes(
            attempt.status,
          ) ||
          !attempt.receipt
        )
          throw new Error("work_attempt_unconfirmed");
        return attempt.receipt;
      } catch (error) {
        // Best effort transport cancellation is independent of the aborted
        // request. An ambiguous acknowledgement remains reconciliation work.
        await transport.cancel(binding).catch(() => undefined);
        throw error;
      }
    },
    cancel: transport.cancel,
    reconcile: transport.reconcile,
    sealUndispatched: transport.sealUndispatched,
    artifact: transport.artifact,
  };
}

/** Each isolated AI step uses the existing durable global/account quota broker. */
export async function reserveWorkStepCost(
  run: WorkRun,
  stepId: string,
  estimatedInputTokens: number,
  outputTokens: number,
) {
  const config = getAiRuntimeConfig();
  const model = OPENAI_TEXT_MODELS.find((entry) => entry.id === run.model);
  if (
    !config.generationEnabled ||
    !model ||
    !model.tiers.includes(run.plan) ||
    !Number.isSafeInteger(estimatedInputTokens) ||
    estimatedInputTokens < 1 ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 1 ||
    outputTokens > model.maxOutputTokens
  ) {
    throw new Error("work_cost_policy_invalid");
  }
  const tokens = estimatedInputTokens + outputTokens;
  const estimatedCostUsd = estimateMaximumCostUsd(model, estimatedInputTokens, outputTokens);
  const costMicros = Math.max(1, Math.ceil(estimatedCostUsd * 1_000_000));
  if (
    estimatedCostUsd > config.maxCostUsdPerRequest ||
    tokens + run.usage.tokens > run.limits.maxTokens ||
    costMicros + run.usage.costMicros > run.limits.maxCostMicros
  )
    throw new Error("work_budget_exceeded");
  const result = await acquireGeneration({
    requestId: crypto.randomUUID(),
    idempotencyKey: `work:${run.id}:${run.epoch}:${stepId}`,
    userId: run.ownerId,
    guestIpHash: null,
    mode: ({ instant: "instant", normal: "medium", thinking: "high", deep: "pro" } as const)[
      run.modelSelection?.mode ?? "normal"
    ],
    plan: run.plan,
    premium: run.premium,
    model,
    estimatedInputTokens,
    reservedTokens: tokens,
    estimatedCostUsd,
    contextTrimmed: false,
  });
  if ("rejection" in result) throw new Error("work_cost_reservation_rejected");
  return {
    id: result.eventId,
    ownerId: run.ownerId,
    runId: run.id,
    epoch: run.epoch,
    model: run.model,
    tokens,
    outputTokens,
    costMicros,
    verified: true,
    expiresAt: Date.now() + Math.min(config.leaseSeconds * 1000, 30000),
  };
}

/** Actual usage must come from the authenticated adapter's provider receipt. */
export async function settleWorkStepCost(
  run: WorkRun,
  receipt: RunnerReceipt & {
    reservationId: string;
    status: "completed" | "aborted" | "provider_failed";
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    latencyMs: number;
  },
) {
  const model = OPENAI_TEXT_MODELS.find((entry) => entry.id === run.model);
  if (!model || run.step?.reservationId !== receipt.reservationId)
    throw new Error("work_accounting_binding_invalid");
  for (const count of [
    receipt.inputTokens,
    receipt.outputTokens,
    receipt.cachedInputTokens ?? 0,
    receipt.reasoningTokens ?? 0,
    receipt.latencyMs,
  ]) {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("work_accounting_receipt_invalid");
  }
  await settleWorkAccounting(run, receipt);
  const actualMicros = Math.ceil(
    actualCostUsd(model, {
      input: receipt.inputTokens,
      cachedInput: receipt.cachedInputTokens ?? 0,
      output: receipt.outputTokens,
    }) * 1_000_000,
  );
  if (
    receipt.inputTokens + receipt.outputTokens > run.step.tokens ||
    actualMicros > run.step.costMicros
  )
    throw new Error("work_provider_budget_violation");
}

/** Called under the account deletion fence, before metadata or Auth deletion. */
export async function cleanupWorkRunnerOwner(ownerId: string) {
  const records = await workExecutionDatabase(supabaseAdmin)
    .from("work_execution_runs")
    .select("state")
    .eq("owner_id", ownerId)
    .limit(1001);
  if (records.error) throw new Error("work_owner_cleanup_unconfirmed");
  if (!records.data?.length) return { complete: true };
  // Admission may be disabled while old private attempts still need erasure.
  const configuration = parseWorkRunnerConfiguration({
    enabled: true,
    origin: runtimeEnv("KOVA_WORK_RUNNER_ORIGIN"),
    id: runtimeEnv("KOVA_WORK_RUNNER_ID"),
    build: runtimeEnv("KOVA_WORK_RUNNER_BUILD"),
    token: runtimeEnv("KOVA_WORK_RUNNER_TOKEN"),
    signingKey: runtimeEnv("KOVA_WORK_RUNNER_SIGNING_KEY"),
  });
  if (!configuration || !workRunnerMatchesOwnerHistory(configuration, records.data))
    throw new Error("work_owner_cleanup_unconfirmed");
  return { complete: await createWorkRunnerTransport(configuration).cleanupOwner(ownerId) };
}
