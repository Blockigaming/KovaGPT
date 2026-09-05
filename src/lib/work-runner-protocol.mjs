import { assertWorkRunnerModel } from "./work-model-policy.mjs";
import { runnerReady, transitionWorkRun, workUuid } from "./work-execution-protocol.mjs";

/**
 * Trusted adapter transport contract. Runtime stays disabled until configured.
 * Repository commits must atomically CAS the state, event, and mutation receipt.
 * authorize() rechecks Auth/deletion, Lockdown, entitlement, and runtime cost gates.
 * assertLease() must be checked by the isolated adapter before each provider/tool
 * request and throughout execution; it is never a user-supplied callback.
 */
export async function executeIsolatedWorkStep({ repository, adapter, costBroker }, runId, stepId) {
  workUuid(runId);
  workUuid(stepId);
  let run = await repository.load(runId);
  const attestation = await adapter.attestation();
  if (
    !runnerReady(attestation) ||
    attestation.id !== run.runnerId ||
    attestation.build !== run.runnerBuild
  )
    throw new Error("work_runner_unavailable");
  assertWorkRunnerModel(run, attestation);
  await repository.authorize(run);
  const now = Date.now();
  if (!run.lease || run.lease.expiresAt <= now || run.status !== "running")
    throw new Error("work_lease_stale");
  const reservation = await costBroker.reserve(run, stepId);
  let admitted = false;
  let commitAttempted = false;
  let definitiveRejection = false;
  try {
    const next = await transitionWorkRun(
      run,
      { type: "begin_step", id: stepId },
      {
        actor: "runner",
        runnerId: run.runnerId,
        epoch: run.epoch,
        expectedRevision: run.revision,
        costReservation: reservation,
      },
    );
    commitAttempted = true;
    try {
      run = await repository.commit(next, run.revision, stepId);
      admitted = true;
    } catch (error) {
      // This code is emitted only for a database-confirmed rolled-back CAS.
      definitiveRejection = error?.message === "work_revision_conflict";
      throw error;
    }
  } finally {
    // A lost commit response can leave an admitted durable step, and an absence
    // read cannot prove that an in-flight transaction will never commit later.
    // Keep ambiguous reservations for signed nonexecution/ledger reconciliation.
    if (!admitted && (!commitAttempted || definitiveRejection))
      await costBroker.releaseUnused(reservation);
  }
  await repository.assertLease(run);
  const timeout = Math.min(run.deadline, run.lease.expiresAt, reservation.expiresAt) - Date.now();
  if (timeout <= 0) throw new Error("work_lease_stale");
  const signal = AbortSignal.timeout(timeout);
  // Fixed reasoning contract only. No shell, command, tool list, executable URL,
  // or mutable browser metadata is forwarded as execution authority.
  const receipt = await adapter.reason(run.step.input, {
    signal,
    assertLease: () => repository.assertLease(run),
  });
  await repository.assertLease(run);
  if (
    signal.aborted ||
    receipt.reservationId !== reservation.id ||
    receipt.runId !== run.id ||
    receipt.ownerId !== run.ownerId ||
    receipt.epoch !== run.epoch ||
    receipt.stepId !== stepId ||
    receipt.inputHash !== run.step.inputHash
  )
    throw new Error("work_adapter_receipt_invalid");
  let budgetViolation = false;
  try {
    await costBroker.settle(run, receipt);
  } catch (error) {
    if (error.message !== "work_provider_budget_violation") throw error;
    budgetViolation = true;
  }
  const current = await repository.load(run.id);
  if (current.step?.id !== stepId || current.epoch !== run.epoch)
    throw new Error("work_lease_stale");
  const finished = await transitionWorkRun(
    current,
    { type: "record_step_receipt", receipt },
    {
      actor: "runner",
      runnerId: run.runnerId,
      epoch: run.epoch,
      expectedRevision: current.revision,
      accountingSettled: true,
    },
  );
  return {
    state: await repository.commit(finished, current.revision, crypto.randomUUID()),
    receipt,
    budgetViolation,
  };
}
