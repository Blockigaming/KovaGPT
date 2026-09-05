import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWorkModelChoice,
  parseWorkModelCapabilities,
  workModelOptions,
  selectWorkModel,
  assertWorkRunnerModel,
} from "../../src/lib/work-model-policy.mjs";
import { configuredProvider } from "../../work-runner/provider.mjs";
import * as protocol from "../../src/lib/work-execution-protocol.mjs";
import { executeIsolatedWorkStep } from "../../src/lib/work-runner-protocol.mjs";
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
  reasoningEfforts: ["low", "medium", "high"],
  maxOutputTokens: 8192,
}));
const options = (overrides = {}) =>
  workModelOptions({ capabilities, models, roles, plan: "plus", ...overrides });

test("Work logical modes resolve exact configured models and refuse premium downgrade", () => {
  const plus = options();
  assert.equal(selectWorkModel({ mode: "normal" }, plus).model, "luna");
  assert.equal(selectWorkModel({ mode: "thinking", reasoningEffort: "high" }, plus).model, "terra");
  assert.equal(plus.find((item) => item.mode === "deep").available, false);
  assert.throws(() => selectWorkModel({ mode: "deep" }, plus), /unavailable/);
  assert.equal(selectWorkModel({ mode: "deep" }, options({ plan: "pro" })).model, "sol");
  assert.equal(selectWorkModel({ mode: "instant" }, plus).selection.maxOutputTokens, 1200);
});
test("unknown, unpriced, wrong-plan, non-tool and disconnected models fail closed", () => {
  for (const overrides of [
    { plan: "free" },
    { capabilities: [] },
    { models: [] },
    { models: models.map((item) => ({ ...item, tools: false })) },
    { models: models.map((item) => ({ ...item, tiers: [] })) },
  ])
    assert.ok(options(overrides).every((item) => !item.available));
  assert.throws(() => selectWorkModel({ mode: "unknown" }, options()), /invalid/);
  assert.throws(() => parseWorkModelChoice({ reasoningEffort: "turbo" }), /invalid/);
  assert.throws(
    () => selectWorkModel({ mode: "normal", reasoningEffort: "max" }, options()),
    /unavailable/,
  );
  assert.throws(
    () =>
      selectWorkModel(
        { reasoningEffort: "low" },
        options({ models: models.map((item) => ({ ...item, reasoning: false })) }),
      ),
    /unavailable/,
  );
});
test("provider capability metadata rejects duplicates, unbounded output and invented effort", () => {
  for (const input of [
    [capabilities[0], capabilities[0]],
    [{ ...capabilities[0], maxOutputTokens: 8193 }],
    [{ ...capabilities[0], reasoningEfforts: ["ultra-fast"] }],
    [{ ...capabilities[0], url: "https://other.test" }],
  ])
    assert.throws(() => parseWorkModelCapabilities(input), /invalid/);
});
test("current runner capability drift denies the saved choice before reserving or executing", async () => {
  const selected = selectWorkModel({ mode: "thinking", reasoningEffort: "high" }, options());
  const run = {
    id: crypto.randomUUID(),
    model: selected.model,
    modelSelection: selected.selection,
    runnerId: crypto.randomUUID(),
    runnerBuild: "a".repeat(40),
  };
  assertWorkRunnerModel(run, { modelCapabilities: capabilities });
  for (const modelCapabilities of [
    [],
    capabilities.map((item) => ({ ...item, reasoningEfforts: ["low"] })),
    capabilities.map((item) => ({ ...item, maxOutputTokens: 1000 })),
  ]) {
    let reserved = 0;
    await assert.rejects(
      executeIsolatedWorkStep(
        {
          repository: { load: async () => run },
          adapter: {
            attestation: async () => ({
              id: run.runnerId,
              build: run.runnerBuild,
              authenticated: true,
              enabled: true,
              protocol: "kova-work-v1",
              heartbeatAt: Date.now(),
              expiresAt: Date.now() + 45000,
              capabilities: [...protocol.WORK_RUNNER_CAPABILITIES],
              modelCapabilities,
            }),
          },
          costBroker: {
            reserve: () => {
              reserved++;
            },
          },
        },
        run.id,
        crypto.randomUUID(),
      ),
      /choice_unavailable/,
    );
    assert.equal(reserved, 0);
  }
});
test("mode and effort are canonical request and step inputs, distinct from provider defaults", async () => {
  const base = { mutationId: crypto.randomUUID(), objective: "Draft", source: "work" };
  const normal = protocol.parseWorkSubmission(base),
    high = protocol.parseWorkSubmission({ ...base, mode: "thinking", reasoningEffort: "high" });
  assert.notEqual(await protocol.workInputHash(normal), await protocol.workInputHash(high));
  const run = {
    id: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    epoch: 1,
    model: "terra",
    modelSelection: selectWorkModel(high, options()).selection,
    request: high,
    sessionContext: null,
    directions: [],
  };
  const cost = { id: crypto.randomUUID(), tokens: 10000, outputTokens: 4096, costMicros: 1000 };
  const step = protocol.workStepInput(run, crypto.randomUUID(), cost);
  assert.equal(step.reasoningEffort, "high");
  assert.notEqual(
    await protocol.workInputHash(step),
    await protocol.workInputHash({ ...step, reasoningEffort: "low" }),
  );
});
test("actual provider sends only explicitly supported effort and preserves exact output admission", async () => {
  const calls = [];
  const provider = configuredProvider(
    {
      responsesUrl: "https://provider.example.test/responses",
      providerKey: "k".repeat(32),
      models: ["terra"],
      modelCapabilities: [capabilities[1]],
    },
    async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return Response.json({
        output_text: JSON.stringify({ kind: "question", text: "Which report?" }),
        usage: { input_tokens: 2, output_tokens: 3 },
      });
    },
  );
  const input = {
    model: "terra",
    reasoningEffort: "high",
    maxOutputTokens: 4096,
    reservationId: crypto.randomUUID(),
    objective: "Draft",
    directions: [],
  };
  await provider.reason(input, { signal: new AbortController().signal });
  assert.deepEqual(calls[0].reasoning, { effort: "high" });
  assert.equal(calls[0].max_output_tokens, 4096);
  assert.equal(calls[0].service_tier, undefined);
  await provider.reason(
    { ...input, reasoningEffort: null },
    { signal: new AbortController().signal },
  );
  assert.equal(calls[1].reasoning, undefined);
  await assert.rejects(
    provider.reason({ ...input, reasoningEffort: "max" }, { signal: new AbortController().signal }),
    /model_invalid/,
  );
  await assert.rejects(
    provider.reason({ ...input, maxOutputTokens: 9000 }, { signal: new AbortController().signal }),
    /model_invalid/,
  );
  assert.equal(calls.length, 2);
});
