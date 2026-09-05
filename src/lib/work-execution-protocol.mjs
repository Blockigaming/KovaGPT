import { parseWorkModelChoice, assertWorkRunnerModel } from "./work-model-policy.mjs";
// Shared protocol only. This module never executes a shell, browser, URL, or provider call.
export const WORK_EXECUTION_PROTOCOL = "kova-work-v1";
export const WORK_RUNNER_CAPABILITIES = Object.freeze([
  "isolated-execution",
  "network-policy",
  "accounting-broker",
  "cancellation",
  "revision-approvals",
  "artifact-ownership",
  "effect-reconciliation",
  "durable-dispatch",
  "negative-execution-proof",
]);
export const WORK_TERMINAL = Object.freeze(["completed", "failed", "cancelled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "browser_interact",
  "read_public_page",
  "read_api",
  "publish",
  "send_message",
  "send_email",
  "delete",
  "change_permission",
  "purchase",
  "transfer_money",
  "trade",
  "accept_terms",
  "submit_medical_information",
  "book_appointment",
  "cancel_appointment",
  "create_account",
  "change_authentication",
]);
const fail = (code) => {
  throw new Error(code);
};
export function workUuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) fail("work_id_invalid");
  return value;
}
function bounded(value, maximum, code = "work_text_invalid") {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /\u0000/.test(value))
    fail(code);
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail("work_number_invalid");
  return value;
}
export function canonicalWorkInput(value) {
  let count = 0;
  const encode = (item, depth) => {
    if (++count > 4096 || depth > 12) fail("work_input_too_complex");
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map((entry) => encode(entry, depth + 1)).join(",")}]`;
    if (item && Object.getPrototypeOf(item) === Object.prototype)
      return `{${Object.keys(item)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${encode(item[key], depth + 1)}`)
        .join(",")}}`;
    fail("work_input_invalid");
  };
  const encoded = encode(value, 0);
  if (new TextEncoder().encode(encoded).length > 32768) fail("work_input_too_large");
  return encoded;
}
export async function workInputHash(value) {
  const bytes = new TextEncoder().encode(canonicalWorkInput(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function workStepInput(run, stepId, cost) {
  return {
    runId: run.id,
    ownerId: run.ownerId,
    epoch: run.epoch,
    stepId,
    reservationId: cost.id,
    model: run.model,
    ...(run.modelSelection ? { reasoningEffort: run.modelSelection.reasoningEffort } : {}),
    objective: run.request.objective,
    sessionContext: run.sessionContext,
    directions: structuredClone(run.directions),
    answer: run.question?.answer ?? null,
    maxTokens: cost.tokens,
    maxOutputTokens: cost.outputTokens,
    approval: run.approval?.status === "approved" ? structuredClone(run.approval) : null,
    effectResult:
      run.effect && run.effect.status !== "started" ? structuredClone(run.effect) : null,
    maxCostMicros: cost.costMicros,
  };
}
export function runnerReady(runner, now = Date.now()) {
  return Boolean(
    runner &&
    runner.authenticated === true &&
    runner.enabled === true &&
    UUID.test(runner.id) &&
    runner.protocol === WORK_EXECUTION_PROTOCOL &&
    typeof runner.build === "string" &&
    /^[a-f0-9]{40,64}$/.test(runner.build) &&
    Number.isSafeInteger(runner.heartbeatAt) &&
    runner.heartbeatAt <= now &&
    now - runner.heartbeatAt < 30000 &&
    Number.isSafeInteger(runner.expiresAt) &&
    runner.expiresAt > now &&
    runner.expiresAt <= now + 60000 &&
    WORK_RUNNER_CAPABILITIES.every((capability) => runner.capabilities?.includes(capability)),
  );
}
export function parseWorkSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("work_input_invalid");
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "mutationId",
          "objective",
          "sessionId",
          "sessionRevision",
          "source",
          "projectId",
          "mode",
          "reasoningEffort",
        ].includes(key),
    )
  )
    fail("work_field_invalid");
  const sessionId = input.sessionId == null ? null : workUuid(input.sessionId);
  if (input.source !== "work" && input.source !== "chat") fail("work_source_invalid");
  if ((sessionId === null) !== (input.sessionRevision == null)) fail("work_session_invalid");
  return {
    ...parseWorkModelChoice(input),
    mutationId: workUuid(input.mutationId),
    objective: bounded(input.objective, 12000),
    sessionId,
    sessionRevision: sessionId ? integer(input.sessionRevision, 1, Number.MAX_SAFE_INTEGER) : null,
    source: input.source,
    projectId: input.projectId == null ? null : workUuid(input.projectId),
  };
}
export async function admitWorkRun(input, policy, runner, now = Date.now()) {
  const request = parseWorkSubmission(input);
  if (!runnerReady(runner, now)) fail("work_runner_unavailable");
  if (
    policy.accountActive !== true ||
    policy.lockdownAllowed !== true ||
    policy.costAllowed !== true ||
    !["plus", "pro"].includes(policy.plan)
  )
    fail("work_admission_denied");
  bounded(policy.model, 100);
  if (policy.modelSelection) {
    const choice = parseWorkModelChoice(policy.modelSelection);
    if (choice.mode !== request.mode || choice.reasoningEffort !== request.reasoningEffort)
      fail("work_model_choice_invalid");
    assertWorkRunnerModel({ model: policy.model, modelSelection: policy.modelSelection }, runner);
  }
  const sessionContext = policy.sessionContext ?? null;
  if ((request.sessionId === null) !== (sessionContext === null))
    fail("work_session_context_invalid");
  if (sessionContext && new TextEncoder().encode(canonicalWorkInput(sessionContext)).length > 12000)
    fail("work_session_context_too_large");
  const limits = {
    maxActions: integer(policy.maxActions, 1, 200),
    maxTokens: integer(policy.maxTokens, 1, 500000),
    maxCostMicros: integer(policy.maxCostMicros, 1, 10000000),
    runtimeMs: integer(policy.runtimeMs, 1000, 3600000),
  };
  return {
    protocol: WORK_EXECUTION_PROTOCOL,
    id: workUuid(policy.runId),
    ownerId: workUuid(policy.ownerId),
    requestHash: await workInputHash(request),
    request,
    sessionContext: structuredClone(sessionContext),
    model: policy.model,
    ...(policy.modelSelection ? { modelSelection: structuredClone(policy.modelSelection) } : {}),
    premium: policy.premium === true,
    plan: policy.plan,
    limits,
    runnerId: runner.id,
    runnerBuild: runner.build,
    status: "queued",
    revision: 1,
    epoch: 0,
    createdAt: now,
    updatedAt: now,
    deadline: now + limits.runtimeMs,
    lease: null,
    usage: { actions: 0, tokens: 0, costMicros: 0 },
    directions: [],
    question: null,
    approval: null,
    effect: null,
    step: null,
    reconciling: false,
    reservationIds: [],
    stepIds: [],
    outputRefs: [],
    evidence: [],
    event: { kind: "admitted", at: now, detail: { source: request.source } },
  };
}
function active(run, now) {
  if (WORK_TERMINAL.includes(run.status)) fail("work_run_terminal");
  if (now >= run.deadline) fail("work_deadline_exceeded");
}
function worker(run, input, now) {
  if (run.reconciling) {
    if (WORK_TERMINAL.includes(run.status)) fail("work_run_terminal");
  } else active(run, now);
  if (
    !run.lease ||
    run.lease.expiresAt <= now ||
    input.epoch !== run.epoch ||
    input.runnerId !== run.runnerId
  )
    fail("work_lease_stale");
}
function update(run, now, kind, detail = {}) {
  run.revision++;
  run.updatedAt = now;
  run.event = { kind, at: now, detail };
  return run;
}
export async function transitionWorkRun(previous, command, context, now = Date.now()) {
  const run = structuredClone(previous);
  if (run.protocol !== WORK_EXECUTION_PROTOCOL) fail("work_protocol_invalid");
  if (context.expectedRevision !== run.revision) fail("work_revision_conflict");
  const owner = context.actor === "owner" && context.ownerId === run.ownerId;
  const runner = context.actor === "runner";
  if (!owner && !runner) fail("work_owner_required");
  if (owner) {
    if (command.type === "cancel") {
      if (WORK_TERMINAL.includes(run.status) && run.status !== "cancelled")
        fail("work_run_terminal");
      run.status = "cancelled";
      run.epoch++;
      run.lease = null;
      run.question = null;
      if (run.approval) run.approval.status = "denied";
      // An in-flight external effect remains recorded for reconciliation, never replayed.
      return update(run, now, "cancelled", {
        reconciliationRequired: Boolean(run.effect?.status === "started"),
      });
    }
    active(run, now);
    if (command.type === "direction") {
      if (run.directions.length >= 64) fail("work_direction_limit");
      if (run.directions.some((item) => item.id === command.id)) fail("work_direction_duplicate");
      run.directions.push({ id: workUuid(command.id), text: bounded(command.text, 4000), at: now });
      return update(run, now, "direction_queued", { id: command.id });
    }
    if (command.type === "edit_direction" || command.type === "remove_direction") {
      const index = run.directions.findIndex((item) => item.id === command.id);
      if (index < 0) fail("work_direction_already_received");
      if (command.type === "edit_direction")
        run.directions[index].text = bounded(command.text, 4000);
      else run.directions.splice(index, 1);
      return update(
        run,
        now,
        command.type === "edit_direction" ? "direction_edited" : "direction_removed",
        { id: command.id },
      );
    }
    if (command.type === "pause") {
      run.status = "paused";
      run.epoch++;
      run.lease = null;
      if (run.approval?.status === "pending" || run.approval?.status === "approved")
        run.approval.status = "denied";
      return update(run, now, "paused", {
        reconciliationRequired: Boolean(run.step || run.effect?.status === "started"),
      });
    }
    if (command.type === "answer") {
      if (run.status !== "waiting_for_user" || run.question?.id !== command.questionId)
        fail("work_question_stale");
      run.question.answer = bounded(command.text, 4000);
      run.status = "queued";
      run.lease = null;
      return update(run, now, "question_answered", { id: command.questionId });
    }
    if (command.type === "approve" || command.type === "deny") {
      const approval = run.approval;
      if (
        run.status !== "approval_required" ||
        !approval ||
        approval.status !== "pending" ||
        approval.id !== command.approvalId ||
        approval.revision !== command.actionRevision ||
        approval.inputHash !== command.inputHash ||
        approval.canonicalInput !== command.canonicalInput ||
        approval.expiresAt <= now
      )
        fail("work_approval_stale");
      approval.status = command.type === "approve" ? "approved" : "denied";
      run.status = command.type === "approve" ? "queued" : "paused";
      run.lease = null;
      return update(run, now, command.type === "approve" ? "action_approved" : "action_denied", {
        id: approval.id,
        inputHash: approval.inputHash,
      });
    }
    if (command.type === "resume") {
      if (
        run.status !== "paused" ||
        run.effect?.status === "started" ||
        run.step ||
        run.outputRefs.length
      )
        fail("work_resume_unsafe");
      if (
        !runnerReady(context.runner, now) ||
        context.runner.id !== run.runnerId ||
        context.runner.build !== run.runnerBuild
      )
        fail("work_runner_unavailable");
      assertWorkRunnerModel(run, context.runner);
      run.status = "queued";
      return update(run, now, "resumed");
    }
    fail("work_command_invalid");
  }
  if (command.type === "recover") {
    if (WORK_TERMINAL.includes(run.status) || (run.lease && run.lease.expiresAt > now))
      fail("work_recovery_invalid");
    if (context.runnerId !== run.runnerId) fail("work_runner_invalid");
    run.epoch++;
    run.lease = null;
    if (run.effect?.status === "started" || run.step || run.outputRefs.length)
      run.status = "paused";
    else if (now >= run.deadline) run.status = "failed";
    else if (run.status === "running") run.status = "queued";
    return update(run, now, "lease_recovered", {
      reconciliationRequired: Boolean(run.effect?.status === "started" || run.step),
    });
  }
  if (command.type === "claim") {
    active(run, now);
    if (
      run.status !== "queued" ||
      run.lease ||
      !runnerReady(context.runner, now) ||
      context.runner.id !== run.runnerId ||
      context.runner.build !== run.runnerBuild
    )
      fail("work_claim_unavailable");
    assertWorkRunnerModel(run, context.runner);
    run.epoch++;
    run.status = "running";
    run.lease = { expiresAt: Math.min(now + 30000, run.deadline) };
    return update(run, now, "claimed", { epoch: run.epoch });
  }
  if (command.type === "claim_reconciliation") {
    if (
      run.status !== "paused" ||
      (!run.step && !run.outputRefs.length) ||
      run.lease ||
      !runnerReady(context.runner, now) ||
      context.runner.id !== run.runnerId ||
      context.runner.build !== run.runnerBuild
    )
      fail("work_reconciliation_invalid");
    run.epoch++;
    run.status = "running";
    run.reconciling = true;
    run.lease = { expiresAt: now + 30000 };
    return update(run, now, "reconciliation_claimed", { epoch: run.epoch });
  }
  worker(run, context, now);
  if (
    run.reconciling &&
    !["record_step_receipt", "finish_step", "finish_effect", "complete", "fail", "renew"].includes(
      command.type,
    )
  )
    fail("work_reconciliation_only");
  if (command.type === "renew") {
    if (
      !runnerReady(context.runner, now) ||
      context.runner.id !== run.runnerId ||
      context.runner.build !== run.runnerBuild
    )
      fail("work_runner_unavailable");
    run.lease.expiresAt = run.reconciling ? now + 30000 : Math.min(now + 30000, run.deadline);
    return update(run, now, "lease_renewed");
  }
  if (command.type === "begin_step") {
    if (run.status !== "running" || run.step || run.effect?.status === "started")
      fail("work_step_invalid");
    const cost = context.costReservation;
    if (
      !cost ||
      cost.ownerId !== run.ownerId ||
      cost.runId !== run.id ||
      cost.epoch !== run.epoch ||
      cost.model !== run.model ||
      cost.expiresAt <= now ||
      cost.verified !== true
    )
      fail("work_cost_reservation_required");
    workUuid(cost.id);
    workUuid(command.id);
    if (run.reservationIds.includes(cost.id) || run.stepIds.includes(command.id))
      fail("work_step_already_used");
    integer(cost.tokens, 1, run.limits.maxTokens);
    integer(cost.outputTokens, 1, cost.tokens);
    integer(cost.costMicros, 1, run.limits.maxCostMicros);
    if (
      run.usage.actions + 1 > run.limits.maxActions ||
      run.usage.tokens + cost.tokens > run.limits.maxTokens ||
      run.usage.costMicros + cost.costMicros > run.limits.maxCostMicros
    )
      fail("work_budget_exceeded");
    run.usage.actions++;
    run.usage.tokens += cost.tokens;
    run.usage.costMicros += cost.costMicros;
    run.reservationIds.push(cost.id);
    run.stepIds.push(command.id);
    const input = workStepInput(run, command.id, cost);
    if (input.approval) {
      if (input.approval.expiresAt <= now) fail("work_approval_stale");
      run.approval.status = "consumed";
      run.effect = {
        id: run.approval.id,
        status: "started",
        epoch: run.epoch,
        inputHash: run.approval.inputHash,
      };
    }
    run.step = {
      id: workUuid(command.id),
      reservationId: cost.id,
      epoch: run.epoch,
      startedAt: now,
      input,
      inputHash: await workInputHash(input),
      tokens: cost.tokens,
      costMicros: cost.costMicros,
    };
    return update(run, now, "step_started", { id: command.id, reservationId: cost.id });
  }
  if (command.type === "finish_step") {
    if (!run.step || run.step.id !== command.id || context.accountingSettled !== true)
      fail("work_step_unsettled");
    const receipt = run.step.receipt;
    if (!receipt) fail("work_adapter_receipt_invalid");
    const directive = receipt.directive;
    if (command.budgetViolation === true) {
      run.status = "failed";
      run.lease = null;
      run.evidence = [
        "Provider usage exceeded the reserved step budget; actual usage was recorded.",
      ];
    } else if (directive?.kind === "question") {
      if (run.effect?.status === "started") fail("work_effect_unresolved");
      run.question = {
        id: workUuid(directive.id),
        text: bounded(directive.text, 4000),
        answer: null,
      };
      run.status = "waiting_for_user";
      run.lease = null;
    } else if (directive?.kind === "approval") {
      if (run.effect?.status === "started" || !ACTIONS.has(directive.action))
        fail("work_action_invalid");
      const canonicalInput = canonicalWorkInput(directive.input);
      if (new TextEncoder().encode(canonicalInput).length > 12000)
        fail("work_approval_input_too_large");
      run.approval = {
        id: workUuid(directive.id),
        action: directive.action,
        canonicalInput,
        inputHash: await workInputHash(directive.input),
        revision: run.revision + 1,
        expiresAt: Math.min(now + 300000, run.deadline),
        status: "pending",
      };
      run.status = "approval_required";
      run.lease = null;
    } else if (directive?.kind === "effect_result") {
      if (
        !run.effect ||
        run.effect.status !== "started" ||
        run.effect.id !== directive.id ||
        !["completed", "not_executed", "failed"].includes(directive.outcome)
      )
        fail("work_effect_unresolved");
      run.effect.status = directive.outcome;
      if (directive.result) {
        if (new TextEncoder().encode(canonicalWorkInput(directive.result)).length > 12000)
          fail("work_effect_result_invalid");
        run.effect.result = structuredClone(directive.result);
      }
      run.status = directive.outcome === "failed" ? "failed" : "queued";
      run.lease = null;
      run.reconciling = false;
    } else if (directive?.kind === "failure" || !receipt.outputs?.length) {
      run.status = "failed";
      run.lease = null;
      run.evidence = [
        "The runner returned no verified deliverable. This attempt will not be repeated.",
      ];
    } else {
      if (
        run.effect?.status === "started" ||
        context.outputsVerified !== true ||
        !Array.isArray(command.outputRefs) ||
        !command.outputRefs.length ||
        command.outputRefs.length > 20
      )
        fail("work_outputs_unverified");
      run.outputRefs = command.outputRefs.map((output) => ({
        kind: output.kind === "library" ? "library" : fail("work_output_kind_invalid"),
        id: workUuid(output.id),
      }));
    }
    // Only directions present in the exact provider input have been consumed;
    // newly queued owner directions survive receipt publication.
    const sentIds = new Set((run.step.input.directions ?? []).map((item) => item.id));
    run.directions = run.directions.filter((item) => !sentIds.has(item.id));
    run.step = null;
    return update(run, now, "step_completed", { id: command.id, result: run.status });
  }
  if (command.type === "record_step_receipt") {
    const receipt = command.receipt;
    if (
      !run.step ||
      context.accountingSettled !== true ||
      !receipt ||
      receipt.ownerId !== run.ownerId ||
      receipt.runId !== run.id ||
      receipt.epoch !== run.step.epoch ||
      receipt.stepId !== run.step.id ||
      receipt.reservationId !== run.step.reservationId ||
      receipt.inputHash !== run.step.inputHash
    )
      fail("work_adapter_receipt_invalid");
    run.step.receipt = structuredClone(receipt);
    return update(run, now, "step_receipt_recorded", { id: run.step.id });
  }
  if (command.type === "finish_effect") {
    if (
      !run.effect ||
      run.effect.status !== "started" ||
      run.effect.id !== command.id ||
      context.effectVerified !== true ||
      !["completed", "not_executed", "failed"].includes(command.outcome)
    )
      fail("work_effect_unresolved");
    run.effect.status = command.outcome;
    return update(run, now, "effect_settled", { id: command.id, outcome: command.outcome });
  }
  if (command.type === "ack_directions") {
    if (
      !Array.isArray(command.ids) ||
      command.ids.some((id) => !run.directions.some((item) => item.id === id))
    )
      fail("work_direction_invalid");
    run.directions = run.directions.filter((item) => !command.ids.includes(item.id));
    return update(run, now, "directions_received", { ids: command.ids });
  }
  if (command.type === "consume_approval") {
    const approval = run.approval;
    if (!run.step) fail("work_cost_reservation_required");
    if (
      !approval ||
      approval.status !== "approved" ||
      approval.expiresAt <= now ||
      approval.id !== command.approvalId ||
      approval.inputHash !== (await workInputHash(command.input)) ||
      approval.canonicalInput !== canonicalWorkInput(command.input)
    )
      fail("work_approval_stale");
    approval.status = "consumed";
    run.effect = {
      id: approval.id,
      status: "started",
      epoch: run.epoch,
      inputHash: approval.inputHash,
    };
    return update(run, now, "effect_started", { id: approval.id, inputHash: approval.inputHash });
  }
  if (run.step || run.effect?.status === "started") fail("work_step_unsettled");
  if (command.type === "question") {
    run.question = { id: workUuid(command.id), text: bounded(command.text, 4000), answer: null };
    run.status = "waiting_for_user";
    run.lease = null;
    return update(run, now, "question_requested", { id: command.id });
  }
  if (command.type === "request_approval") {
    if (!ACTIONS.has(command.action)) fail("work_action_invalid");
    if (run.approval?.status === "approved") fail("work_approval_unconsumed");
    const canonicalInput = canonicalWorkInput(command.input);
    if (new TextEncoder().encode(canonicalInput).length > 12000)
      fail("work_approval_input_too_large");
    run.approval = {
      id: workUuid(command.id),
      action: command.action,
      canonicalInput,
      inputHash: await workInputHash(command.input),
      revision: run.revision + 1,
      expiresAt: Math.min(now + 300000, run.deadline),
      status: "pending",
    };
    run.status = "approval_required";
    run.lease = null;
    return update(run, now, "approval_requested", {
      id: command.id,
      inputHash: run.approval.inputHash,
    });
  }
  if (command.type === "complete" || command.type === "fail") {
    if (run.approval?.status === "approved" || run.approval?.status === "pending")
      fail("work_approval_unconsumed");
    if (command.type === "complete") {
      if (
        !Array.isArray(command.outputRefs) ||
        !command.outputRefs.length ||
        command.outputRefs.length > 20 ||
        context.outputsVerified !== true
      )
        fail("work_outputs_unverified");
      run.outputRefs = command.outputRefs.map((output) => ({
        kind: output.kind === "library" ? "library" : fail("work_output_kind_invalid"),
        id: workUuid(output.id),
      }));
      run.evidence = (command.evidence ?? []).slice(0, 20).map((item) => bounded(item, 2000));
    }
    run.status = command.type === "complete" ? "completed" : "failed";
    run.lease = null;
    return update(run, now, run.status);
  }
  fail("work_command_invalid");
}

// Ambiguous effects/accounting are reconciled by trusted backend evidence, never owner assertions.
export function reconcileWorkRun(previous, evidence, now = Date.now()) {
  if (
    evidence.verified !== true ||
    evidence.expectedRevision !== previous.revision ||
    evidence.runId !== previous.id ||
    evidence.ownerId !== previous.ownerId
  )
    fail("work_reconciliation_unverified");
  const run = structuredClone(previous);
  if (run.lease?.expiresAt > now) fail("work_reconciliation_active");
  if (run.effect?.status === "started") {
    if (
      evidence.effectId !== run.effect.id ||
      !["completed", "not_executed", "failed"].includes(evidence.effectOutcome)
    )
      fail("work_effect_unresolved");
    run.effect.status = evidence.effectOutcome;
  }
  if (run.step) {
    if (evidence.reservationId !== run.step.reservationId || evidence.accountingSettled !== true)
      fail("work_step_unsettled");
    run.step = null;
  }
  return update(run, now, "reconciled");
}

/** Only a signed exact-attempt tombstone plus settled zero usage can clear an undispatched step. */
export function reconcileUndispatchedWorkRun(
  previous,
  attempt,
  accountingSettled,
  now = Date.now(),
) {
  const step = previous.step,
    receipt = attempt?.receipt;
  if (
    !["paused", "cancelled"].includes(previous.status) ||
    !step ||
    accountingSettled !== true ||
    attempt?.status !== "not_executed" ||
    !UUID.test(attempt.attemptId ?? "") ||
    !receipt ||
    ["runId", "ownerId", "epoch", "stepId", "inputHash"].some(
      (key) => attempt[key] !== receipt[key],
    ) ||
    receipt.runId !== previous.id ||
    receipt.ownerId !== previous.ownerId ||
    receipt.epoch !== step.epoch ||
    receipt.stepId !== step.id ||
    receipt.inputHash !== step.inputHash ||
    receipt.reservationId !== step.reservationId ||
    !Array.isArray(receipt.outputs) ||
    receipt.outputs.length ||
    receipt.directive ||
    [
      "inputTokens",
      "outputTokens",
      "cachedInputTokens",
      "reasoningTokens",
      "latencyMs",
      "costMicros",
    ].some((key) => receipt[key] !== 0)
  )
    fail("work_nonexecution_proof_invalid");
  const reconciled = reconcileWorkRun(
    previous,
    {
      verified: true,
      expectedRevision: previous.revision,
      runId: previous.id,
      ownerId: previous.ownerId,
      reservationId: step.reservationId,
      accountingSettled: true,
      ...(previous.effect?.status === "started"
        ? { effectId: previous.effect.id, effectOutcome: "not_executed" }
        : {}),
    },
    now,
  );
  // Retain the attempt/action IDs so the old approval can never be executed later.
  reconciled.usage.tokens = Math.max(0, reconciled.usage.tokens - step.tokens);
  reconciled.usage.costMicros = Math.max(0, reconciled.usage.costMicros - step.costMicros);
  reconciled.event = { kind: "undispatched_step_reconciled", at: now, detail: { stepId: step.id } };
  return reconciled;
}
