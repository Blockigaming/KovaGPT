import assert from "node:assert/strict";
import test from "node:test";
import {
  admitWorkRun,
  canonicalWorkInput,
  parseWorkSubmission,
  reconcileWorkRun,
  reconcileUndispatchedWorkRun,
  runnerReady,
  transitionWorkRun,
  WORK_RUNNER_CAPABILITIES,
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
