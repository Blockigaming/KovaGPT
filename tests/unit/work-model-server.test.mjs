import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as protocol from "../../src/lib/work-execution-protocol.mjs";
import * as policy from "../../src/lib/work-model-policy.mjs";
const owner = crypto.randomUUID();
const roles = { DEFAULT_CHAT: "luna", ADVANCED_REASONING: "terra", PREMIUM_REASONING: "sol" };
const models = Object.values(roles).map((id) => ({
  id,
  reasoning: true,
  tools: true,
  tiers: ["plus", "pro"],
  maxOutputTokens: 128000,
}));
const capabilities = Object.values(roles).map((model) => ({
  model,
  reasoningEfforts: ["low", "high"],
  maxOutputTokens: 8192,
}));
const config = {
  generationEnabled: true,
  maxTokensPerUserDay: 100000,
  maxTokensPerUserMonth: 100000,
  maxCostUsdPerRequest: 1,
  maxConcurrentPerUser: 2,
  leaseSeconds: 30,
};
function load(file, modules) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (!(name in modules)) throw Error(name);
        return modules[name];
      },
      crypto,
      Date,
      Error,
      Math,
      Number,
      Object,
    },
  );
  return exports;
}
function fixture() {
  const committed = [];
  let plan = "plus",
    activeRoles = { ...roles },
    generation = true;
  const db = {
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({ data: null, error: null }),
    }),
    rpc: async (name, input) => {
      assert.equal(name, "commit_work_execution");
      committed.push(input.p_state);
      return { data: { state: input.p_state, idempotent: false }, error: null };
    },
  };
  const modules = {
    "@/lib/work-execution-database.server": { workExecutionDatabase: () => db },
    "@/lib/api-auth.server": { assertNotBanned: async () => null },
    "@/agents/execution.server": {
      getAgentEntitlement: async () => plan,
      AGENT_LIMITS: {
        plus: { maxActions: 20, maxRuntimeMs: 900000, concurrency: 2 },
        pro: { maxActions: 30, maxRuntimeMs: 900000, concurrency: 3 },
      },
    },
    "@/lib/lockdown-policy.mjs": { assertLockdownAllows: async () => {} },
    "@/lib/ai/config.server": {
      getAiRuntimeConfig: () => ({ ...config, generationEnabled: generation }),
    },
    "@/lib/ai/model-router.server": { activeModelConfig: () => activeRoles },
    "@/lib/ai/model-catalog.server": { OPENAI_TEXT_MODELS: models },
    "@/lib/work-model-policy.mjs": policy,
    "@/lib/work-runner.server": {
      registeredWorkRunner: async () => ({
        id: crypto.randomUUID(),
        protocol: "kova-work-v1",
        build: "a".repeat(40),
        authenticated: true,
        enabled: true,
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 45000,
        capabilities: [...protocol.WORK_RUNNER_CAPABILITIES],
        modelCapabilities: capabilities,
      }),
      configuredWorkRunnerTransport: () => ({ dispatch: async () => {} }),
    },
    "@/lib/work-execution-protocol.mjs": protocol,
  };
  return {
    api: load("src/lib/work-execution.server.ts", modules),
    caller: { userId: owner, supabaseAdmin: {} },
    committed,
    plan: (next) => {
      plan = next;
    },
    roles: (next) => {
      activeRoles = next;
    },
    disable: () => {
      generation = false;
    },
  };
}
const input = () => ({
  mutationId: crypto.randomUUID(),
  objective: "Debug a distributed race condition and refactor architecture",
  source: "work",
  mode: "normal",
  reasoningEffort: "low",
});
test("actual Work admission pins explicit model and effort despite a complex objective", async () => {
  const f = fixture();
  const result = await f.api.submitWorkExecution(f.caller, input());
  assert.equal(result.state.model, "luna");
  assert.equal(result.state.modelSelection.mode, "normal");
  assert.equal(result.state.modelSelection.reasoningEffort, "low");
  assert.equal(f.committed.length, 1);
  const readiness = await f.api.workExecutionReadiness(f.caller);
  assert.equal(readiness.available, true);
  assert.equal(readiness.modelOptions.find((item) => item.mode === "deep").available, false);
  f.disable();
  assert.equal((await f.api.workExecutionReadiness(f.caller)).available, false);
});
test("actual admission refuses unavailable effort and premium mode before committing", async () => {
  const f = fixture();
  await assert.rejects(
    f.api.submitWorkExecution(f.caller, { ...input(), mode: "deep" }),
    /choice_unavailable/,
  );
  await assert.rejects(
    f.api.submitWorkExecution(f.caller, { ...input(), reasoningEffort: "max" }),
    /choice_unavailable/,
  );
  assert.equal(f.committed.length, 0);
  f.plan("pro");
  assert.equal(
    (await f.api.submitWorkExecution(f.caller, { ...input(), mode: "deep" })).state.model,
    "sol",
  );
});
test("current plan and role changes prevent further authorization of a saved choice", async () => {
  const f = fixture();
  const { state } = await f.api.submitWorkExecution(f.caller, input());
  await f.api.createWorkExecutionRepository(f.caller).authorize(state);
  f.roles({ ...roles, DEFAULT_CHAT: "terra" });
  await assert.rejects(
    f.api.createWorkExecutionRepository(f.caller).authorize(state),
    /choice_unavailable/,
  );
  f.roles(roles);
  f.plan(null);
  await assert.rejects(
    f.api.createWorkExecutionRepository(f.caller).authorize(state),
    /admission_denied/,
  );
});
test("actual quota broker records the chosen Work mode and exact model", async () => {
  let acquired;
  const api = load("src/lib/work-runner.server.ts", {
    "@/integrations/supabase/client.server": {},
    "@/lib/work-execution-database.server": {},
    "@/lib/ai/accounting.server": {
      acquireGeneration: async (value) => {
        acquired = value;
        return { eventId: crypto.randomUUID() };
      },
    },
    "@/lib/work-accounting-settlement.server": {},
    "@/lib/ai/model-catalog.server": {
      OPENAI_TEXT_MODELS: models,
      estimateMaximumCostUsd: () => 0.001,
    },
    "@/lib/ai/config.server": { getAiRuntimeConfig: () => config },
    "@/lib/runtime-env.server": {},
    "@/lib/work-runner-transport.mjs": {},
  });
  for (const [mode, expected] of [
    ["instant", "instant"],
    ["normal", "medium"],
    ["thinking", "high"],
    ["deep", "pro"],
  ]) {
    await api.reserveWorkStepCost(
      {
        id: crypto.randomUUID(),
        ownerId: owner,
        epoch: 1,
        model: "terra",
        modelSelection: { mode },
        premium: mode === "deep",
        plan: "pro",
        usage: { tokens: 0, costMicros: 0 },
        limits: { maxTokens: 10000, maxCostMicros: 100000 },
      },
      crypto.randomUUID(),
      100,
      100,
    );
    assert.equal(acquired.mode, expected);
    assert.equal(acquired.model.id, "terra");
    assert.equal(acquired.premium, mode === "deep");
  }
});
