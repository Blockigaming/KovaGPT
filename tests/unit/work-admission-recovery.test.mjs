import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as protocol from "../../src/lib/work-execution-protocol.mjs";
const owner = crypto.randomUUID(),
  runId = crypto.randomUUID(),
  runnerId = crypto.randomUUID();
const runner = () => ({
  id: runnerId,
  protocol: "kova-work-v1",
  build: "a".repeat(40),
  authenticated: true,
  enabled: true,
  heartbeatAt: Date.now(),
  expiresAt: Date.now() + 45000,
  capabilities: [...protocol.WORK_RUNNER_CAPABILITIES],
});
async function fixture({
  uncertain = false,
  settlementFailure = false,
  changedBuild = false,
  cancelled = false,
} = {}) {
  const now = Date.now();
  let state = await protocol.admitWorkRun(
    {
      mutationId: crypto.randomUUID(),
      objective: "Private objective",
      source: "work",
      sessionId: null,
      sessionRevision: null,
    },
    {
      runId,
      ownerId: owner,
      model: "gpt-5.6-luna",
      plan: "plus",
      accountActive: true,
      lockdownAllowed: true,
      costAllowed: true,
      maxActions: 10,
      maxTokens: 10000,
      maxCostMicros: 100000,
      runtimeMs: 900000,
    },
    runner(),
  );
  const ctx = () => ({
    actor: "runner",
    runnerId,
    epoch: state.epoch,
    expectedRevision: state.revision,
    runner: runner(),
  });
  state = await protocol.transitionWorkRun(state, { type: "claim" }, ctx());
  const action = crypto.randomUUID();
  state = await protocol.transitionWorkRun(
    state,
    {
      type: "request_approval",
      id: action,
      action: "send_email",
      input: { to: "person@example.test", body: "Approved exact text" },
    },
    ctx(),
  );
  state = await protocol.transitionWorkRun(
    state,
    {
      type: "approve",
      approvalId: action,
      actionRevision: state.approval.revision,
      inputHash: state.approval.inputHash,
      canonicalInput: state.approval.canonicalInput,
    },
    { actor: "owner", ownerId: owner, expectedRevision: state.revision },
  );
  state = await protocol.transitionWorkRun(state, { type: "claim" }, ctx());
  const cost = {
    id: crypto.randomUUID(),
    ownerId: owner,
    runId,
    epoch: state.epoch,
    model: state.model,
    tokens: 1000,
    outputTokens: 500,
    costMicros: 1000,
    verified: true,
    expiresAt: now + 45000,
  };
  state = await protocol.transitionWorkRun(
    state,
    { type: "begin_step", id: crypto.randomUUID() },
    { ...ctx(), costReservation: cost },
  );
  state = await protocol.transitionWorkRun(
    state,
    { type: cancelled ? "cancel" : "pause" },
    { actor: "owner", ownerId: owner, expectedRevision: state.revision },
  );
  const binding = {
    runId,
    ownerId: owner,
    epoch: state.step.epoch,
    stepId: state.step.id,
    inputHash: state.step.inputHash,
  };
  const proof = {
    ...binding,
    attemptId: crypto.randomUUID(),
    status: "not_executed",
    receipt: {
      ...binding,
      reservationId: cost.id,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      latencyMs: 0,
      costMicros: 0,
      outputs: [],
    },
  };
  const calls = [];
  const repository = {
    load: async () => structuredClone(state),
    commit: async (next, revision) => {
      assert.equal(revision, state.revision);
      calls.push("commit");
      state = next;
      return next;
    },
    authorize: async () => calls.push("authorize"),
  };
  const adapter = {
    attestation: async () => ({ ...runner(), ...(changedBuild ? { build: "b".repeat(40) } : {}) }),
    reconcile: async () => ({ ...binding, status: "unknown" }),
    sealUndispatched: async (input) => {
      assert.deepEqual(JSON.parse(JSON.stringify(input)), { ...binding, reservationId: cost.id });
      calls.push("seal");
      return uncertain ? { ...binding, status: "unknown" } : proof;
    },
  };
  const exports = {};
  const modules = {
    "@/lib/ai/accounting.server": {},
    "@/lib/ai/model-catalog.server": {},
    "@/lib/work-runner.server": {
      configuredWorkRunnerAdapter: () => adapter,
      settleWorkStepCost: async (run, receipt) => {
        assert.equal(run.step.inputHash, receipt.inputHash);
        assert.equal(receipt.inputTokens, 0);
        calls.push("settle");
        if (settlementFailure) throw new Error("settlement_failed");
      },
    },
    "@/lib/work-execution.server": { createWorkExecutionRepository: () => repository },
    "@/lib/work-runner-protocol.mjs": {},
    "@/lib/work-execution-protocol.mjs": protocol,
    "@/lib/work-output-publisher.server": {},
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/work-execution-driver.server.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: (name) => modules[name], crypto, Date, Error, Math },
  );
  return {
    recover: () => exports.recoverConfiguredWorkRun({ userId: owner }, runId),
    state: () => state,
    calls,
  };
}
test("actual driver settles a signed zero-use tombstone before clearing an undispatched approved effect", async () => {
  const f = await fixture();
  const run = await f.recover();
  assert.deepEqual(f.calls, ["seal", "settle", "commit"]);
  assert.equal(run.status, "paused");
  assert.equal(run.step, null);
  assert.equal(run.effect.status, "not_executed");
  assert.equal(run.approval.status, "consumed");
  assert.equal(run.usage.tokens, 0);
});
test("canceled undispatched runs remain canceled after exact zero-use recovery", async () => {
  const f = await fixture({ cancelled: true });
  const run = await f.recover();
  assert.equal(run.status, "cancelled");
  assert.equal(run.step, null);
  assert.equal(run.effect.status, "not_executed");
});
test("unknown execution, unsettled accounting and a changed runner build never become nonexecution proof", async () => {
  const unknown = await fixture({ uncertain: true });
  await unknown.recover();
  assert.deepEqual(unknown.calls, ["seal"]);
  assert.ok(unknown.state().step);
  const failed = await fixture({ settlementFailure: true });
  await assert.rejects(failed.recover(), /settlement_failed/);
  assert.deepEqual(failed.calls, ["seal", "settle"]);
  assert.ok(failed.state().step);
  const changed = await fixture({ changedBuild: true });
  await assert.rejects(changed.recover(), /runner_unavailable/);
  assert.deepEqual(changed.calls, []);
  assert.ok(changed.state().step);
});
