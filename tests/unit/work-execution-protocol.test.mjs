import assert from "node:assert/strict";
import test from "node:test";
import {
  admitWorkRun,
  canonicalWorkInput,
  canonicalWorkRunnerRequest,
  estimateWorkStepInputTokens,
  parseWorkSubmission,
  reconcileWorkRun,
  reconcileUndispatchedWorkRun,
  remainingWorkPhaseInputTokens,
  runnerReady,
  transitionWorkRun,
  workStepInput,
  WORK_COORDINATOR_OBJECTIVE,
  WORK_RUNNER_CAPABILITIES,
  WORK_SYNTHESIS_OBJECTIVE,
} from "../../src/lib/work-execution-protocol.mjs";
import { executeIsolatedWorkStep } from "../../src/lib/work-runner-protocol.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333",
  ID = "44444444-4444-4444-8444-444444444444";
const RES = "55555555-5555-4555-8555-555555555555",
  RUNNER = "66666666-6666-4666-8666-666666666666";
const now = Date.now();
const heartbeat = (at = now) => ({
  id: RUNNER,
  protocol: "kova-work-v1",
  build: "a".repeat(40),
  authenticated: true,
  enabled: true,
  heartbeatAt: at,
  expiresAt: at + 50000,
  capabilities: [...WORK_RUNNER_CAPABILITIES],
});
const submission = () => ({
  mutationId: ID,
  objective: "Prepare a sourced report",
  source: "work",
  sessionId: null,
  sessionRevision: null,
});
const policy = () => ({
  runId: RUN,
  ownerId: OWNER,
  model: "gpt-5.6-luna",
  plan: "plus",
  accountActive: true,
  lockdownAllowed: true,
  costAllowed: true,
  maxActions: 2,
  maxTokens: 1000,
  maxCostMicros: 10000,
  runtimeMs: 900000,
});
const fresh = () => admitWorkRun(submission(), policy(), heartbeat(), now);
const owner = (run) => ({ actor: "owner", ownerId: OWNER, expectedRevision: run.revision });
const worker = (run, at = now) => ({
  actor: "runner",
  runnerId: RUNNER,
  epoch: run.epoch,
  expectedRevision: run.revision,
  runner: heartbeat(at),
});
const claim = (run, at = now) => transitionWorkRun(run, { type: "claim" }, worker(run, at), at);
const cost = (run) => ({
  id: RES,
  ownerId: OWNER,
  runId: RUN,
  epoch: run.epoch,
  model: run.model,
  verified: true,
  tokens: 100,
  outputTokens: 50,
  costMicros: 1000,
  expiresAt: now + 20000,
});

test("admission requires authenticated current pinned protocol and every runner capability", async () => {
  for (const change of [
    { authenticated: false },
    { enabled: false },
    { protocol: "old" },
    { build: "latest" },
    { heartbeatAt: now - 30000 },
    { heartbeatAt: now + 1 },
    { expiresAt: now + 60001 },
    { capabilities: WORK_RUNNER_CAPABILITIES.slice(1) },
  ]) {
    const runner = { ...heartbeat(), ...change };
    assert.equal(runnerReady(runner, now), false);
    await assert.rejects(admitWorkRun(submission(), policy(), runner, now), /unavailable/);
  }
  await assert.rejects(admitWorkRun(submission(), policy(), null, now), /unavailable/);
  for (const field of ["accountActive", "lockdownAllowed", "costAllowed"])
    await assert.rejects(
      admitWorkRun(submission(), { ...policy(), [field]: false }, heartbeat(), now),
      /denied/,
    );
  assert.equal((await fresh()).status, "queued");
});
test("admission rejects tools, URLs as authority, arbitrary models, oversized input and incomplete session binding", () => {
  for (const change of [
    { tools: ["shell"] },
    { model: "arbitrary" },
    { url: "http://127.0.0.1" },
    { objective: "x".repeat(12001) },
    { sessionId: RUN },
  ])
    assert.throws(() => parseWorkSubmission({ ...submission(), ...change }));
  assert.equal(canonicalWorkInput({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.throws(() => canonicalWorkInput({ x: undefined }), /invalid/);
});
test("exact ownership, CAS revisions, and immutable source are preserved", async () => {
  const run = await fresh();
  await assert.rejects(
    transitionWorkRun(run, { type: "cancel" }, { ...owner(run), ownerId: OTHER }, now),
    /owner/,
  );
  await assert.rejects(
    transitionWorkRun(run, { type: "cancel" }, { ...owner(run), expectedRevision: 99 }, now),
    /conflict/,
  );
  assert.equal(run.revision, 1);
  assert.equal(run.status, "queued");
});
test("only one epoch claims, expiry rejects stale workers and safe recovery permits a fresh lease", async () => {
  let run = await claim(await fresh());
  await assert.rejects(claim(run), /unavailable/);
  await assert.rejects(
    transitionWorkRun(run, { type: "renew" }, { ...worker(run), epoch: 0 }, now),
    /stale/,
  );
  await assert.rejects(
    transitionWorkRun(run, { type: "renew" }, worker(run), now + 30000),
    /stale/,
  );
  run = await transitionWorkRun(run, { type: "recover" }, worker(run), now + 30000);
  assert.equal(run.status, "queued");
  assert.equal(run.epoch, 2);
  run = await claim(run, now + 30001);
  assert.equal(run.epoch, 3);
});
test("queued directions can be edited or removed only until acknowledged; questions bind exact identity", async () => {
  let run = await claim(await fresh());
  run = await transitionWorkRun(
    run,
    { type: "direction", id: ID, text: "Use primary sources" },
    owner(run),
    now,
  );
  run = await transitionWorkRun(
    run,
    { type: "edit_direction", id: ID, text: "Use official sources" },
    owner(run),
    now,
  );
  assert.equal(run.directions[0].text, "Use official sources");
  run = await transitionWorkRun(run, { type: "ack_directions", ids: [ID] }, worker(run), now);
  await assert.rejects(
    transitionWorkRun(run, { type: "remove_direction", id: ID }, owner(run), now),
    /already_received/,
  );
  run = await transitionWorkRun(
    run,
    { type: "question", id: ID, text: "Which region?" },
    worker(run),
    now,
  );
  await assert.rejects(
    transitionWorkRun(run, { type: "answer", questionId: RUN, text: "US" }, owner(run), now),
    /stale/,
  );
  run = await transitionWorkRun(
    run,
    { type: "answer", questionId: ID, text: "US" },
    owner(run),
    now,
  );
  assert.equal(run.status, "queued");
  assert.equal(run.question.answer, "US");
});
async function approved() {
  let run = await claim(await fresh());
  run = await transitionWorkRun(
    run,
    {
      type: "request_approval",
      id: ID,
      action: "send_email",
      input: { to: "owner@example.test", body: "Exact text" },
    },
    worker(run),
    now,
  );
  const command = {
    type: "approve",
    approvalId: ID,
    actionRevision: run.approval.revision,
    inputHash: run.approval.inputHash,
    canonicalInput: run.approval.canonicalInput,
  };
  return { run, command };
}
test("approval reviews exact canonical bytes, action revision, expiration and hash", async () => {
  const { run, command } = await approved();
  for (const change of [
    { approvalId: RUN },
    { actionRevision: 99 },
    { inputHash: "f".repeat(64) },
    { canonicalInput: '{"changed":true}' },
  ])
    await assert.rejects(
      transitionWorkRun(run, { ...command, ...change }, owner(run), now),
      /stale/,
    );
  await assert.rejects(transitionWorkRun(run, command, owner(run), now + 300000), /stale/);
  assert.equal(
    (await transitionWorkRun(run, command, owner(run), now)).approval.status,
    "approved",
  );
});
test("consequential actions consume approval once with a bound cost reservation; cancellation preserves uncertainty", async () => {
  let { run, command } = await approved();
  run = await transitionWorkRun(run, command, owner(run), now);
  run = await claim(run);
  const consume = {
    type: "consume_approval",
    approvalId: ID,
    input: { body: "Exact text", to: "owner@example.test" },
  };
  await assert.rejects(transitionWorkRun(run, consume, worker(run), now), /reservation/);
  run = await transitionWorkRun(
    run,
    { type: "begin_step", id: ID },
    { ...worker(run), costReservation: cost(run) },
    now,
  );
  assert.equal(run.approval.status, "consumed");
  assert.equal(run.step.input.approval.canonicalInput, command.canonicalInput);
  await assert.rejects(transitionWorkRun(run, consume, worker(run), now), /stale/);
  run = await transitionWorkRun(run, { type: "cancel" }, owner(run), now);
  assert.equal(run.status, "cancelled");
  assert.equal(run.effect.status, "started");
  assert.equal(run.lease, null);
  assert.throws(() => reconcileWorkRun(run, { verified: false }, now), /unverified/);
  const reconciled = reconcileWorkRun(
    run,
    {
      verified: true,
      expectedRevision: run.revision,
      runId: RUN,
      ownerId: OWNER,
      effectId: ID,
      effectOutcome: "completed",
      reservationId: RES,
      accountingSettled: true,
    },
    now,
  );
  assert.equal(reconciled.status, "cancelled");
  assert.equal(reconciled.effect.status, "completed");
  assert.equal(reconciled.step, null);
});
test("expired effects and unsettled cost reservations pause for evidence instead of replaying", async () => {
  let run = await claim(await fresh());
  run = await transitionWorkRun(
    run,
    { type: "begin_step", id: ID },
    { ...worker(run), costReservation: cost(run) },
    now,
  );
  run = await transitionWorkRun(run, { type: "recover" }, worker(run), now + 30000);
  assert.equal(run.status, "paused");
  await assert.rejects(
    transitionWorkRun(
      run,
      { type: "resume" },
      { ...owner(run), runner: heartbeat(now + 30000) },
      now + 30000,
    ),
    /unsafe/,
  );
});
test("every step has owner/model/epoch-bound accounting and conservative bounded resource consumption", async () => {
  let run = await claim(await fresh());
  for (const change of [
    { ownerId: OTHER },
    { runId: OTHER },
    { epoch: 0 },
    { model: "other" },
    { verified: false },
    { expiresAt: now },
    { tokens: 1001 },
  ])
    await assert.rejects(
      transitionWorkRun(
        run,
        { type: "begin_step", id: ID },
        { ...worker(run), costReservation: { ...cost(run), ...change } },
        now,
      ),
    );
  for (let i = 0; i < 2; i++) {
    const id = crypto.randomUUID();
    run = await transitionWorkRun(
      run,
      { type: "begin_step", id },
      { ...worker(run), costReservation: { ...cost(run), id: crypto.randomUUID() } },
      now,
    );
    await assert.rejects(
      transitionWorkRun(run, { type: "finish_step", id }, worker(run), now),
      /unsettled/,
    );
    run = await transitionWorkRun(
      run,
      {
        type: "record_step_receipt",
        receipt: {
          ownerId: OWNER,
          runId: RUN,
          epoch: run.epoch,
          stepId: id,
          reservationId: run.step.reservationId,
          inputHash: run.step.inputHash,
          outputs: [{ artifactId: ID }],
        },
      },
      { ...worker(run), accountingSettled: true },
      now,
    );
    run = await transitionWorkRun(
      run,
      { type: "finish_step", id, outputRefs: [{ kind: "library", id: ID }] },
      { ...worker(run), accountingSettled: true, outputsVerified: true },
      now,
    );
  }
  await assert.rejects(
    transitionWorkRun(
      run,
      { type: "begin_step", id: ID },
      { ...worker(run), costReservation: cost(run) },
      now,
    ),
    /budget/,
  );
  assert.deepEqual(run.usage, { actions: 2, tokens: 200, costMicros: 2000 });
});
test("completion requires verified owned artifacts and no unresolved step", async () => {
  let run = await claim(await fresh());
  await assert.rejects(
    transitionWorkRun(
      run,
      { type: "complete", outputRefs: [{ kind: "library", id: ID }] },
      worker(run),
      now,
    ),
    /unverified/,
  );
  run = await transitionWorkRun(
    run,
    {
      type: "complete",
      outputRefs: [{ kind: "library", id: ID }],
      evidence: ["Provider receipt verified"],
    },
    { ...worker(run), outputsVerified: true },
    now,
  );
  assert.equal(run.status, "completed");
  await assert.rejects(transitionWorkRun(run, { type: "cancel" }, owner(run), now), /terminal/);
});
test("deadlines are terminal on recovery; pause revokes the current epoch", async () => {
  let run = await claim(await fresh());
  const epoch = run.epoch;
  run = await transitionWorkRun(run, { type: "pause" }, owner(run), now);
  assert.equal(run.epoch, epoch + 1);
  assert.equal(run.lease, null);
  run = await transitionWorkRun(run, { type: "recover" }, worker(run), run.deadline);
  assert.equal(run.status, "failed");
});

async function beginSpecialistTestStep(run) {
  if (run.status === "queued") run = await claim(run);
  const id = crypto.randomUUID();
  run = await transitionWorkRun(
    run,
    { type: "begin_step", id },
    {
      ...worker(run),
      costReservation: { ...cost(run), id: crypto.randomUUID() },
    },
    now,
  );
  return { run, id };
}

async function finishSpecialistTestStep(run, id, directive) {
  run = await transitionWorkRun(
    run,
    {
      type: "record_step_receipt",
      receipt: {
        ownerId: OWNER,
        runId: RUN,
        epoch: run.epoch,
        stepId: id,
        reservationId: run.step.reservationId,
        inputHash: run.step.inputHash,
        outputs: [],
        directive,
      },
    },
    { ...worker(run), accountingSettled: true },
    now,
  );
  return transitionWorkRun(
    run,
    { type: "finish_step", id },
    { ...worker(run), accountingSettled: true, outputsVerified: true },
    now,
  );
}

test("specialist cost estimates include the exact long coordinator objective", async () => {
  const coordinatorObjective = "c".repeat(12000);
  let run = await admitWorkRun(
    { ...submission(), objective: coordinatorObjective },
    { ...policy(), maxActions: 3, maxTokens: 20000 },
    heartbeat(),
    now,
  );
  const coordinator = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(coordinator.run, coordinator.id, {
    kind: "specialists",
    tasks: [
      {
        id: crypto.randomUUID(),
        role: "research",
        objective: "Check one fact",
        context: [],
        tools: [],
      },
    ],
  });
  const stepId = crypto.randomUUID();
  const projection = workStepInput(run, stepId, {
    id: "00000000-0000-4000-8000-000000000001",
    tokens: run.limits.maxTokens,
    outputTokens: 2048,
    costMicros: run.limits.maxCostMicros,
  });
  assert.equal(projection.phase, "specialist");
  assert.equal(projection.coordinatorObjective, coordinatorObjective);
  const bytes = new TextEncoder().encode(canonicalWorkInput(projection)).length;
  assert.equal(estimateWorkStepInputTokens(run, stepId), Math.ceil(bytes / 3) + 512);
  assert.ok(estimateWorkStepInputTokens(run, stepId) > 4500);
});

test("multilingual coordinator objectives are carried once in bounded step input", async () => {
  const coordinatorObjective = "界".repeat(10000);
  const run = await admitWorkRun(
    { ...submission(), objective: coordinatorObjective },
    { ...policy(), maxTokens: 20000 },
    heartbeat(),
    now,
  );
  const input = workStepInput(run, crypto.randomUUID(), {
    id: crypto.randomUUID(),
    tokens: run.limits.maxTokens,
    outputTokens: 2048,
    costMicros: run.limits.maxCostMicros,
  });
  assert.equal(input.objective, WORK_COORDINATOR_OBJECTIVE);
  assert.equal(input.coordinatorObjective, coordinatorObjective);
  assert.doesNotThrow(() => canonicalWorkInput(input));
  assert.doesNotThrow(() => estimateWorkStepInputTokens(run, crypto.randomUUID()));
  await assert.rejects(
    admitWorkRun(
      { ...submission(), objective: "界".repeat(10650) },
      { ...policy(), maxTokens: 20000 },
      heartbeat(),
      now,
    ),
    /work_input_too_large/,
  );
});

test("bounded specialists run sequentially with narrow context and immutable results before synthesis", async () => {
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  let run = await admitWorkRun(
    { ...submission(), sessionId: ID, sessionRevision: 1 },
    {
      ...policy(),
      maxActions: 5,
      maxTokens: 10000,
      sessionContext: { privateConversation: "coordinator only" },
    },
    heartbeat(),
    now,
  );
  assert.deepEqual(run.specialists, []);

  let step = await beginSpecialistTestStep(run);
  run = step.run;
  assert.equal(run.step.input.phase, "coordinator");
  assert.deepEqual(run.step.input.sessionContext, { privateConversation: "coordinator only" });
  run = await finishSpecialistTestStep(run, step.id, {
    kind: "specialists",
    tasks: [
      {
        id: firstId,
        role: "research",
        objective: "Check the supplied evidence",
        context: ["Only this fact"],
        tools: [],
      },
      {
        id: secondId,
        role: "review",
        objective: "Review the proposed conclusion",
        context: [],
        tools: [],
      },
    ],
  });
  assert.deepEqual(
    run.specialists.map((item) => item.status),
    ["queued", "queued"],
  );

  step = await beginSpecialistTestStep(run);
  run = step.run;
  assert.equal(run.step.input.phase, "specialist");
  assert.equal(run.step.input.specialist.id, firstId);
  assert.equal(run.step.input.objective, "Check the supplied evidence");
  assert.equal(run.step.input.sessionContext, null);
  assert.deepEqual(run.step.input.specialist.tools, []);
  assert.deepEqual(run.step.input.specialistResults, []);
  const rejectedSpecialist = await finishSpecialistTestStep(run, step.id, {
    kind: "specialist_result",
    id: secondId,
    summary: "Wrong specialist",
    evidence: [],
  });
  assert.equal(rejectedSpecialist.status, "failed");
  assert.equal(rejectedSpecialist.specialists[0].status, "failed");
  assert.equal(rejectedSpecialist.specialists[0].result, null);
  const overreachingSpecialist = await finishSpecialistTestStep(run, step.id, {
    kind: "approval",
    id: crypto.randomUUID(),
    action: "send_email",
    input: { to: "someone@example.test" },
  });
  assert.equal(overreachingSpecialist.status, "failed");
  assert.match(overreachingSpecialist.evidence[0], /exceeded this step's authority/);
  run = await finishSpecialistTestStep(run, step.id, {
    kind: "specialist_result",
    id: firstId,
    summary: "Evidence checked",
    evidence: ["Fact matches the supplied record"],
  });
  assert.equal(run.specialists[0].status, "completed");
  assert.equal(run.specialists[0].result.summary, "Evidence checked");

  step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialist_result",
    id: secondId,
    summary: "Conclusion reviewed",
    evidence: [],
  });
  assert.deepEqual(
    run.specialists.map((item) => item.status),
    ["completed", "completed"],
  );

  step = await beginSpecialistTestStep(run);
  run = step.run;
  assert.equal(run.step.input.phase, "synthesis");
  assert.equal(run.step.input.objective, WORK_SYNTHESIS_OBJECTIVE);
  assert.equal(run.step.input.sessionContext, null);
  assert.equal(run.step.input.specialistResults.length, 2);
  assert.equal(run.step.input.specialistResults[0].result.summary, "Evidence checked");
  await assert.rejects(
    transitionWorkRun(
      run,
      { type: "complete", outputRefs: [{ kind: "library", id: ID }] },
      { ...worker(run), outputsVerified: true },
      now,
    ),
    /step_unsettled/,
  );
});

test("consumed coordinator directions are excluded from specialist phase projections", async () => {
  let run = await admitWorkRun(
    submission(),
    { ...policy(), maxActions: 6, maxTokens: 500000 },
    heartbeat(),
    now,
  );
  for (let index = 0; index < 7; index++)
    run = await transitionWorkRun(
      run,
      { type: "direction", id: crypto.randomUUID(), text: String(index).repeat(3500) },
      owner(run),
      now,
    );
  const step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: Array.from({ length: 4 }, (_, index) => ({
      id: crypto.randomUUID(),
      role: "research",
      objective: String(index).repeat(2000),
      context: [],
      tools: [],
    })),
  });
  assert.equal(run.status, "queued");
  assert.equal(run.directions.length, 0);
  assert.equal(run.specialists.length, 4);
});

test("cancelling a parent run cascades only to open specialists", async () => {
  const completedId = crypto.randomUUID();
  const queuedId = crypto.randomUUID();
  let run = await admitWorkRun(
    submission(),
    { ...policy(), maxActions: 5, maxTokens: 10000 },
    heartbeat(),
    now,
  );
  let step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: [
      {
        id: completedId,
        role: "writing",
        objective: "Draft a section",
        context: [],
        tools: [],
      },
      {
        id: queuedId,
        role: "review",
        objective: "Review the section",
        context: [],
        tools: [],
      },
    ],
  });
  step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialist_result",
    id: completedId,
    summary: "Draft complete",
    evidence: [],
  });
  step = await beginSpecialistTestStep(run);
  run = await transitionWorkRun(step.run, { type: "cancel" }, owner(step.run), now);
  assert.equal(run.status, "cancelled");
  assert.equal(run.specialists[0].status, "completed");
  assert.equal(run.specialists[0].result.summary, "Draft complete");
  assert.equal(run.specialists[1].status, "cancelled");
});

test("a reserved running specialist is excluded from later remaining-phase checks", async () => {
  const specialistId = crypto.randomUUID();
  let run = await admitWorkRun(
    submission(),
    { ...policy(), maxActions: 3, maxTokens: 5000 },
    heartbeat(),
    now,
  );
  let step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: [
      {
        id: specialistId,
        role: "review",
        objective: "Review the bounded result",
        context: [],
        tools: [],
      },
    ],
  });
  step = await beginSpecialistTestStep(run);
  run = step.run;
  const remaining = remainingWorkPhaseInputTokens(run);
  assert.equal(remaining.length, 1);
  run.limits.maxTokens = run.usage.tokens + remaining[0] + 100;
  run = await transitionWorkRun(
    run,
    { type: "direction", id: crypto.randomUUID(), text: "Use concise citations" },
    owner(run),
    now,
  );
  assert.equal(run.status, "running");
  assert.equal(run.directions.length, 1);
});

test("a specialist plan must leave parent action budget for every task and synthesis", async () => {
  let run = await fresh();
  const step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: [
      {
        id: crypto.randomUUID(),
        role: "research",
        objective: "First task",
        context: [],
        tools: [],
      },
      {
        id: crypto.randomUUID(),
        role: "review",
        objective: "Second task",
        context: [],
        tools: [],
      },
    ],
  });
  assert.equal(run.status, "failed");
  assert.deepEqual(run.specialists, []);
  assert.match(run.evidence[0], /parent run's remaining action budget/);
});

test("a specialist plan must leave minimum token budget for every remaining phase", async () => {
  let run = await admitWorkRun(
    submission(),
    { ...policy(), maxActions: 4, maxTokens: 1200 },
    heartbeat(),
    now,
  );
  const step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: [
      {
        id: crypto.randomUUID(),
        role: "research",
        objective: "First task",
        context: [],
        tools: [],
      },
      {
        id: crypto.randomUUID(),
        role: "review",
        objective: "Second task",
        context: [],
        tools: [],
      },
    ],
  });
  assert.equal(run.status, "failed");
  assert.match(run.evidence[0], /remaining token budget/);
});

test("a specialist plan durably rejects an individually oversized specialist input", async () => {
  let run = await admitWorkRun(
    { ...submission(), objective: "界".repeat(10050) },
    { ...policy(), maxActions: 3, maxTokens: 100000 },
    heartbeat(),
    now,
  );
  const step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: [
      {
        id: crypto.randomUUID(),
        role: "research",
        objective: "Check the bounded source material",
        context: ["a".repeat(500), "b".repeat(500), "c".repeat(500), "d".repeat(500)],
        tools: [],
      },
    ],
  });
  assert.equal(run.status, "failed");
  assert.equal(run.step, null);
  assert.match(run.evidence[0], /bounded specialist input/);
});

test("aggregate specialist results fail durably before an oversized synthesis step", async () => {
  let run = await admitWorkRun(
    { ...submission(), objective: "p".repeat(12000) },
    { ...policy(), maxActions: 6, maxTokens: 100000 },
    heartbeat(),
    now,
  );
  let step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: Array.from({ length: 4 }, (_, index) => ({
      id: crypto.randomUUID(),
      role: "research",
      objective: String(index).repeat(2000),
      context: [],
      tools: [],
    })),
  });
  assert.equal(run.status, "queued");
  while (run.status === "queued") {
    step = await beginSpecialistTestStep(run);
    const specialistId = step.run.step.input.specialist.id;
    run = await finishSpecialistTestStep(step.run, step.id, {
      kind: "specialist_result",
      id: specialistId,
      summary: "s".repeat(3000),
      evidence: Array.from({ length: 4 }, () => "e".repeat(500)),
    });
  }
  assert.equal(run.status, "failed");
  assert.equal(run.step, null);
  assert.match(run.evidence[0], /bounded synthesis input/);
  assert.ok(run.specialists.some((item) => item.result?.summary.length === 3000));
});

test("synthesis projections include the complete signed submit envelope", async () => {
  const specialistIds = Array.from({ length: 4 }, () => crypto.randomUUID());
  let run = await admitWorkRun(
    { ...submission(), objective: "p".repeat(12000) },
    { ...policy(), maxActions: 6, maxTokens: 500000, maxCostMicros: 10000000 },
    heartbeat(),
    now,
  );
  let step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: specialistIds.map((id, index) => ({
      id,
      role: "research",
      objective: String(index).repeat(2000),
      context: [],
      tools: [],
    })),
  });
  for (let index = 0; index < specialistIds.length - 1; index++) {
    step = await beginSpecialistTestStep(run);
    run = await finishSpecialistTestStep(step.run, step.id, {
      kind: "specialist_result",
      id: specialistIds[index],
      summary: "s".repeat(2864),
      evidence: [],
    });
    assert.equal(run.status, "queued");
  }
  step = await beginSpecialistTestStep(run);
  const projectedRun = structuredClone(step.run);
  const last = projectedRun.specialists.find((item) => item.id === specialistIds.at(-1));
  last.status = "completed";
  last.result = { summary: "s".repeat(2864), evidence: [] };
  const projectionId = "00000000-0000-4000-8000-000000000001";
  const input = workStepInput(projectedRun, projectionId, {
    id: projectionId,
    tokens: projectedRun.limits.maxTokens,
    outputTokens: 2048,
    costMicros: projectedRun.limits.maxCostMicros,
  });
  assert.doesNotThrow(() => canonicalWorkInput(input));
  assert.throws(
    () =>
      canonicalWorkRunnerRequest({
        runnerId: projectedRun.runnerId,
        build: projectedRun.runnerBuild,
        requestId: projectionId,
        at: Number.MAX_SAFE_INTEGER,
        operation: "submit",
        payload: { ...input, inputHash: "f".repeat(64) },
      }),
    /work_input_too_large/,
  );
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialist_result",
    id: specialistIds.at(-1),
    summary: "s".repeat(2864),
    evidence: [],
  });
  assert.equal(run.status, "failed");
  assert.match(run.evidence[0], /bounded synthesis input/);
});

test("a recovered specialist receipt exits reconciliation before the next phase", async () => {
  const specialistId = crypto.randomUUID();
  let run = await admitWorkRun(
    submission(),
    { ...policy(), maxActions: 3, maxTokens: 5000 },
    heartbeat(),
    now,
  );
  let step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: [
      {
        id: specialistId,
        role: "review",
        objective: "Review the bounded result",
        context: [],
        tools: [],
      },
    ],
  });
  step = await beginSpecialistTestStep(run);
  run = step.run;
  const receipt = {
    ownerId: OWNER,
    runId: RUN,
    epoch: run.step.epoch,
    stepId: step.id,
    reservationId: run.step.reservationId,
    inputHash: run.step.inputHash,
    outputs: [],
    directive: {
      kind: "specialist_result",
      id: specialistId,
      summary: "Review complete",
      evidence: [],
    },
  };
  run = await transitionWorkRun(run, { type: "pause" }, owner(run), now);
  run = await transitionWorkRun(
    run,
    { type: "claim_reconciliation" },
    { ...worker(run), runner: heartbeat() },
    now,
  );
  assert.equal(run.reconciling, true);
  run = await transitionWorkRun(
    run,
    { type: "record_step_receipt", receipt },
    { ...worker(run), accountingSettled: true },
    now,
  );
  run = await transitionWorkRun(
    run,
    { type: "finish_step", id: step.id },
    { ...worker(run), accountingSettled: true, outputsVerified: true },
    now,
  );
  assert.equal(run.status, "queued");
  assert.equal(run.reconciling, false);
  run = await claim(run);
  step = await beginSpecialistTestStep(run);
  assert.equal(step.run.step.input.phase, "synthesis");
});

test("proven-undispatched specialist work returns to queued while the parent is paused", async () => {
  const specialistId = crypto.randomUUID();
  let run = await admitWorkRun(
    submission(),
    { ...policy(), maxActions: 3, maxTokens: 5000 },
    heartbeat(),
    now,
  );
  let step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialists",
    tasks: [
      {
        id: specialistId,
        role: "review",
        objective: "Review the bounded result",
        context: [],
        tools: [],
      },
    ],
  });
  step = await beginSpecialistTestStep(run);
  run = await transitionWorkRun(step.run, { type: "pause" }, owner(step.run), now);
  assert.equal(run.specialists[0].status, "running");
  const receipt = {
    ownerId: OWNER,
    runId: RUN,
    epoch: run.step.epoch,
    stepId: run.step.id,
    inputHash: run.step.inputHash,
    reservationId: run.step.reservationId,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    latencyMs: 0,
    costMicros: 0,
    outputs: [],
  };
  const attempt = { ...receipt, attemptId: crypto.randomUUID(), status: "not_executed", receipt };
  run = reconcileUndispatchedWorkRun(run, attempt, true, now);
  assert.equal(run.status, "paused");
  assert.equal(run.usage.actions, 1);
  assert.equal(run.specialists[0].status, "queued");
  assert.equal(run.specialists[0].startedAt, null);
  assert.equal(run.specialists[0].completedAt, null);
  run = await transitionWorkRun(
    run,
    { type: "resume" },
    { ...owner(run), runner: heartbeat() },
    now,
  );
  step = await beginSpecialistTestStep(run);
  run = await finishSpecialistTestStep(step.run, step.id, {
    kind: "specialist_result",
    id: specialistId,
    summary: "Review complete after verified nonexecution",
    evidence: [],
  });
  step = await beginSpecialistTestStep(run);
  assert.equal(step.run.step.input.phase, "synthesis");
  assert.equal(step.run.usage.actions, 3);
});

async function fakeDriver(options = {}) {
  let state = await claim(await fresh());
  let called = 0,
    released = 0,
    settled = 0;
  const repository = {
    load: async () => structuredClone(state),
    authorize: async () => {
      if (options.denied) throw new Error("blocked");
    },
    assertLease: async () => {
      if (options.cancelled) throw new Error("stale");
    },
    commit: async (next, revision) => {
      if (options.conflict) throw new Error("work_revision_conflict");
      assert.equal(revision, state.revision);
      state = next;
      if (options.lostCommitResponse) throw new Error("commit_response_lost");
      return structuredClone(state);
    },
  };
  const adapter = {
    attestation: async () => heartbeat(Date.now()),
    reason: async (input) => {
      called++;
      assert.equal(input.model, "gpt-5.6-luna");
      assert.equal("tools" in input, false);
      return {
        reservationId: RES,
        runId: RUN,
        ownerId: OWNER,
        epoch: state.epoch,
        stepId: ID,
        inputHash: state.step.inputHash,
      };
    },
  };
  const costBroker = {
    reserve: async () => {
      if (options.noCost) throw new Error("no_quota");
      return cost(state);
    },
    releaseUnused: async () => {
      released++;
    },
    settle: async () => {
      settled++;
      if (options.accountingFailure) throw new Error("accounting_failed");
    },
  };
  return {
    dependencies: { repository, adapter, costBroker },
    counts: () => ({ called, released, settled }),
    state: () => state,
  };
}
test("fake adapter executes only after authenticated admission and durable cost-bound CAS", async () => {
  const fake = await fakeDriver();
  const final = await executeIsolatedWorkStep(fake.dependencies, RUN, ID);
  assert.equal(final.state.step.receipt.stepId, ID);
  assert.deepEqual(fake.counts(), { called: 1, released: 0, settled: 1 });
});
test("fake adapter never executes after quota denial, failed admission, lost CAS or cancellation", async () => {
  for (const options of [
    { denied: true },
    { noCost: true },
    { conflict: true },
    { cancelled: true },
  ]) {
    const fake = await fakeDriver(options);
    await assert.rejects(executeIsolatedWorkStep(fake.dependencies, RUN, ID));
    assert.equal(fake.counts().called, 0);
    if (options.conflict) assert.equal(fake.counts().released, 1);
  }
});
test("fake adapter accounting failure leaves a durable ambiguous step for reconciliation", async () => {
  const fake = await fakeDriver({ accountingFailure: true });
  await assert.rejects(executeIsolatedWorkStep(fake.dependencies, RUN, ID), /accounting_failed/);
  assert.equal(fake.state().step.id, ID);
  assert.equal(fake.counts().called, 1);
});

test("a settled completed receipt with no output atomically fails and cannot be recovered into another execution", async () => {
  let run = await claim(await fresh());
  run = await transitionWorkRun(
    run,
    { type: "begin_step", id: ID },
    { ...worker(run), costReservation: cost(run) },
    now,
  );
  const receipt = {
    ownerId: OWNER,
    runId: RUN,
    epoch: run.epoch,
    stepId: ID,
    reservationId: run.step.reservationId,
    inputHash: run.step.inputHash,
    outputs: [],
  };
  run = await transitionWorkRun(
    run,
    { type: "record_step_receipt", receipt },
    { ...worker(run), accountingSettled: true },
    now,
  );
  run = await transitionWorkRun(
    run,
    { type: "finish_step", id: ID },
    { ...worker(run), accountingSettled: true },
    now,
  );
  assert.equal(run.status, "failed");
  assert.equal(run.step, null);
  await assert.rejects(transitionWorkRun(run, { type: "claim" }, worker(run), now), /terminal/);
});

test("settled budget overruns terminate without losing newly queued owner directions or repeating provider work", async () => {
  let run = await claim(await fresh());
  run = await transitionWorkRun(
    run,
    { type: "begin_step", id: ID },
    { ...worker(run), costReservation: cost(run) },
    now,
  );
  run = await transitionWorkRun(
    run,
    { type: "direction", id: crypto.randomUUID(), text: "Queued after submission" },
    owner(run),
    now,
  );
  const receipt = {
    ownerId: OWNER,
    runId: RUN,
    epoch: run.epoch,
    stepId: ID,
    reservationId: run.step.reservationId,
    inputHash: run.step.inputHash,
    outputs: [],
  };
  run = await transitionWorkRun(
    run,
    { type: "record_step_receipt", receipt },
    { ...worker(run), accountingSettled: true },
    now,
  );
  run = await transitionWorkRun(
    run,
    { type: "finish_step", id: ID, budgetViolation: true },
    { ...worker(run), accountingSettled: true },
    now,
  );
  assert.equal(run.status, "failed");
  assert.equal(run.directions.length, 1);
  assert.match(run.evidence[0], /actual usage was recorded/);
});

test("a lost begin-step commit response preserves its exact reservation for verified nonexecution recovery", async () => {
  const fake = await fakeDriver({ lostCommitResponse: true });
  await assert.rejects(executeIsolatedWorkStep(fake.dependencies, RUN, ID), /commit_response_lost/);
  assert.equal(fake.state().step.id, ID);
  assert.deepEqual(fake.counts(), { called: 0, released: 0, settled: 0 });
  let paused = await transitionWorkRun(
    fake.state(),
    { type: "pause" },
    owner(fake.state()),
    Date.now(),
  );
  const receipt = {
    ownerId: OWNER,
    runId: RUN,
    epoch: paused.step.epoch,
    stepId: ID,
    inputHash: paused.step.inputHash,
    reservationId: RES,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costMicros: 0,
    latencyMs: 0,
    outputs: [],
  };
  const attempt = { ...receipt, attemptId: crypto.randomUUID(), status: "not_executed", receipt };
  assert.throws(() => reconcileUndispatchedWorkRun(paused, attempt, false), /proof_invalid/);
  for (const altered of [
    { status: "unknown" },
    { receipt: { ...receipt, inputTokens: 1 } },
    { receipt: { ...receipt, reservationId: OTHER } },
    { receipt: { ...receipt, inputHash: "b".repeat(64) } },
  ])
    assert.throws(
      () => reconcileUndispatchedWorkRun(paused, { ...attempt, ...altered }, true),
      /proof_invalid/,
    );
  const recovered = reconcileUndispatchedWorkRun(paused, attempt, true);
  assert.equal(recovered.status, "paused");
  assert.equal(recovered.step, null);
  assert.equal(recovered.usage.actions, 0);
  assert.equal(recovered.usage.tokens, 0);
  assert.equal(recovered.usage.costMicros, 0);
  assert.deepEqual(recovered.reservationIds, [RES]);
  assert.deepEqual(recovered.stepIds, [ID]);
  const resumed = await transitionWorkRun(
    recovered,
    { type: "resume" },
    { ...owner(recovered), runner: heartbeat(Date.now()) },
  );
  assert.equal(resumed.status, "queued");
});
