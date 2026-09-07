import type { AuthedCaller } from "@/lib/api-auth.server";
import { finalizeGeneration } from "@/lib/ai/accounting.server";
import { OPENAI_TEXT_MODELS } from "@/lib/ai/model-catalog.server";
import {
  configuredWorkRunnerAdapter,
  reserveWorkStepCost,
  settleWorkStepCost,
} from "@/lib/work-runner.server";
import { createWorkExecutionRepository } from "@/lib/work-execution.server";
import { executeIsolatedWorkStep } from "@/lib/work-runner-protocol.mjs";
import {
  transitionWorkRun,
  runnerReady,
  canonicalWorkInput,
  reconcileWorkRun,
  reconcileUndispatchedWorkRun,
} from "@/lib/work-execution-protocol.mjs";
import type { WorkRun } from "@/lib/work-execution-protocol.mjs";
import type { RunnerReceipt } from "@/lib/work-runner-transport.mjs";
import { publishVerifiedWorkOutputs } from "@/lib/work-output-publisher.server";

/** Called by a separately deployed authenticated dispatcher, never a host shell. */
export async function executeConfiguredWorkRun(caller: AuthedCaller, runId: string) {
  const repository = createWorkExecutionRepository(caller);
  const adapter = configuredWorkRunnerAdapter();
  let run = await repository.load(runId);
  if (run.status === "completed") return run;
  if (run.status === "queued" && run.deadline <= Date.now()) {
    const expired = await transitionWorkRun(
      run,
      { type: "recover" },
      { actor: "runner", runnerId: run.runnerId, expectedRevision: run.revision },
    );
    return repository.commit(expired, run.revision, crypto.randomUUID());
  }
  await repository.authorize(run);
  const runner = await adapter.attestation();
  const claimed = await transitionWorkRun(
    run,
    { type: "claim" },
    { actor: "runner", runnerId: runner.id, runner, expectedRevision: run.revision },
  );
  run = await repository.commit(claimed, run.revision, crypto.randomUUID());
  const result = await executeIsolatedWorkStep(
    {
      repository,
      adapter,
      costBroker: {
        async reserve(current, stepId) {
          const inputChars = canonicalWorkInput({
            objective: current.request.objective,
            sessionContext: current.sessionContext,
            directions: current.directions,
            answer: current.question?.answer ?? null,
          }).length;
          const estimatedInputTokens = Math.max(1, Math.ceil(inputChars / 3) + 512);
          const outputTokens = Math.min(
            current.modelSelection?.maxOutputTokens ?? 2048,
            current.limits.maxTokens - current.usage.tokens - estimatedInputTokens,
          );
          return reserveWorkStepCost(current, stepId, estimatedInputTokens, outputTokens);
        },
        async releaseUnused(reservation) {
          const model = OPENAI_TEXT_MODELS.find((item) => item.id === reservation.model);
          if (!model) throw new Error("work_accounting_model_invalid");
          await finalizeGeneration({
            eventId: reservation.id,
            status: "aborted",
            model,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
            toolCalls: 0,
          });
        },
        async settle(current, receipt) {
          await settleWorkStepCost(current, { ...receipt, status: "completed" });
        },
      },
    },
    run.id,
    crypto.randomUUID(),
  );
  return finishVerifiedReceipt(caller, result.state, result.receipt, result.budgetViolation);
}

async function finishVerifiedReceipt(
  caller: AuthedCaller,
  run: WorkRun,
  receipt: RunnerReceipt,
  budgetViolation = false,
) {
  const repository = createWorkExecutionRepository(caller);
  const outputs =
    !budgetViolation && !receipt.directive && receipt.outputs.length
      ? await publishVerifiedWorkOutputs(caller, run, receipt)
      : [];
  let current = await repository.load(run.id);
  await repository.assertLease(current);
  const finished = await transitionWorkRun(
    current,
    { type: "finish_step", id: receipt.stepId, outputRefs: outputs, budgetViolation },
    {
      actor: "runner",
      runnerId: current.runnerId,
      epoch: current.epoch,
      expectedRevision: current.revision,
      accountingSettled: true,
      outputsVerified: true,
    },
  );
  current = await repository.commit(finished, current.revision, crypto.randomUUID());
  if (current.status !== "running") return current;
  const complete = await transitionWorkRun(
    current,
    {
      type: "complete",
      outputRefs: outputs,
      evidence: [`Verified runner output and accounting for step ${receipt.stepId}.`],
    },
    {
      actor: "runner",
      runnerId: current.runnerId,
      epoch: current.epoch,
      expectedRevision: current.revision,
      outputsVerified: true,
    },
  );
  return repository.commit(complete, current.revision, crypto.randomUUID());
}

/** A lost lease is observed durably; unknown remote effects never trigger a replay. */
export async function recoverConfiguredWorkRun(caller: AuthedCaller, runId: string) {
  const repository = createWorkExecutionRepository(caller),
    adapter = configuredWorkRunnerAdapter();
  let run = await repository.load(runId);
  const runner = await adapter.attestation();
  if (!runnerReady(runner) || runner.id !== run.runnerId || runner.build !== run.runnerBuild)
    throw new Error("work_runner_unavailable");
  if (run.lease && run.lease.expiresAt <= Date.now()) {
    const recovered = await transitionWorkRun(
      run,
      { type: "recover" },
      { actor: "runner", runnerId: runner.id, expectedRevision: run.revision },
    );
    run = await repository.commit(recovered, run.revision, crypto.randomUUID());
  }
  if (run.status === "paused" && !run.step && run.outputRefs.length) {
    const claimed = await transitionWorkRun(
      run,
      { type: "claim_reconciliation" },
      { actor: "runner", runnerId: runner.id, runner, expectedRevision: run.revision },
    );
    run = await repository.commit(claimed, run.revision, crypto.randomUUID());
    const completed = await transitionWorkRun(
      run,
      {
        type: "complete",
        outputRefs: run.outputRefs,
        evidence: ["Recovered previously verified saved outputs without repeating provider work."],
      },
      {
        actor: "runner",
        runnerId: runner.id,
        epoch: run.epoch,
        expectedRevision: run.revision,
        outputsVerified: true,
      },
    );
    return repository.commit(completed, run.revision, crypto.randomUUID());
  }
  if (!["paused", "cancelled"].includes(run.status) || !run.step) return run;
  let receipt = await adapter.reconcile({
    runId: run.id,
    ownerId: run.ownerId,
    epoch: run.step.epoch,
    stepId: run.step.id,
    inputHash: run.step.inputHash,
  });
  if (receipt.status === "unknown") {
    receipt = await adapter.sealUndispatched({
      runId: run.id,
      ownerId: run.ownerId,
      epoch: run.step.epoch,
      stepId: run.step.id,
      inputHash: run.step.inputHash,
      reservationId: run.step.reservationId,
    });
  }
  if (receipt.status === "not_executed" && receipt.receipt) {
    // Verify the complete negative proof before accounting; publication occurs
    // only after its exact zero-use settlement is durable.
    reconcileUndispatchedWorkRun(run, receipt, true);
    await settleWorkStepCost(run, { ...receipt.receipt, status: "completed" });
    const reconciled = reconcileUndispatchedWorkRun(run, receipt, true);
    return repository.commit(reconciled, run.revision, crypto.randomUUID());
  }
  if (
    ![
      "completed",
      "question",
      "approval_required",
      "effect_completed",
      "failed",
      "cancelled",
    ].includes(receipt.status) ||
    !receipt.receipt
  )
    return run;
  if (run.status === "cancelled") {
    if (run.effect?.status === "started" && receipt.receipt.directive?.kind !== "effect_result")
      return run;
    try {
      await settleWorkStepCost(run, { ...receipt.receipt, status: "completed" });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "work_provider_budget_violation")
        throw error;
    }
    const reconciled = reconcileWorkRun(run, {
      verified: true,
      expectedRevision: run.revision,
      runId: run.id,
      ownerId: run.ownerId,
      reservationId: run.step.reservationId,
      accountingSettled: true,
      ...(receipt.receipt.directive?.kind === "effect_result"
        ? {
            effectId: receipt.receipt.directive.id,
            effectOutcome: receipt.receipt.directive.outcome,
          }
        : {}),
    });
    return repository.commit(reconciled, run.revision, crypto.randomUUID());
  }
  await repository.authorize(run);
  const claimed = await transitionWorkRun(
    run,
    { type: "claim_reconciliation" },
    { actor: "runner", runnerId: runner.id, runner, expectedRevision: run.revision },
  );
  run = await repository.commit(claimed, run.revision, crypto.randomUUID());
  let budgetViolation = false;
  try {
    await settleWorkStepCost(run, { ...receipt.receipt, status: "completed" });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "work_provider_budget_violation")
      throw error;
    budgetViolation = true;
  }
  const recorded = await transitionWorkRun(
    run,
    { type: "record_step_receipt", receipt: receipt.receipt },
    {
      actor: "runner",
      runnerId: run.runnerId,
      epoch: run.epoch,
      expectedRevision: run.revision,
      accountingSettled: true,
    },
  );
  run = await repository.commit(recorded, run.revision, crypto.randomUUID());
  return finishVerifiedReceipt(caller, run, receipt.receipt, budgetViolation);
}
