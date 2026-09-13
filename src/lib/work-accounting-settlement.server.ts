import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { actualCostUsd, OPENAI_TEXT_MODELS } from "@/lib/ai/model-catalog.server";
import { workInputHash, type WorkRun } from "@/lib/work-execution-protocol.mjs";
import type { RunnerReceipt } from "@/lib/work-runner-transport.mjs";

/** Input must be a verified, pinned runner receipt; browser assertions never call this. */
export async function settleWorkAccounting(run: WorkRun, receipt: RunnerReceipt): Promise<void> {
  const model = OPENAI_TEXT_MODELS.find((entry) => entry.id === run.model);
  if (
    !model ||
    receipt.ownerId !== run.ownerId ||
    receipt.runId !== run.id ||
    run.step?.id !== receipt.stepId ||
    run.step.epoch !== receipt.epoch ||
    run.step.inputHash !== receipt.inputHash ||
    run.step.reservationId !== receipt.reservationId
  )
    throw new Error("work_accounting_binding_invalid");
  for (const value of [
    receipt.inputTokens,
    receipt.cachedInputTokens,
    receipt.outputTokens,
    receipt.reasoningTokens,
    receipt.latencyMs,
  ])
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000)
      throw new Error("work_accounting_receipt_invalid");
  if (
    receipt.cachedInputTokens > receipt.inputTokens ||
    receipt.reasoningTokens > receipt.outputTokens
  )
    throw new Error("work_accounting_receipt_invalid");
  const cost = actualCostUsd(model, {
    input: receipt.inputTokens,
    cachedInput: receipt.cachedInputTokens,
    output: receipt.outputTokens,
  });
  const { data, error } = await supabaseAdmin
    .rpc(
      "settle_work_accounting" as never,
      {
        p_owner: run.ownerId,
        p_run: run.id,
        p_step: receipt.stepId,
        p_epoch: receipt.epoch,
        p_event: receipt.reservationId,
        p_input_hash: receipt.inputHash,
        p_receipt_hash: await workInputHash(receipt),
        p_model: model.id,
        p_input: receipt.inputTokens,
        p_cached: receipt.cachedInputTokens,
        p_output: receipt.outputTokens,
        p_reasoning: receipt.reasoningTokens,
        p_actual_cost: cost,
        p_latency: receipt.latencyMs,
      } as never,
    )
    .abortSignal(AbortSignal.timeout(10_000));
  if (error || data !== true) throw new Error("work_accounting_settlement_unavailable");
}
