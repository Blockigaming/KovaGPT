import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { estimateProviderInput } from "../../src/lib/ai/token-estimator.server.ts";

const compiled = await build({
  entryPoints: ["src/lib/ai/free-connector-budget.server.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { FreeConnectorBudget } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const finalMessages = [
  { role: "system", content: "Complete final instructions." },
  { role: "user", content: "Read my README." },
];
function budget(overrides = {}) {
  return new FreeConnectorBudget({
    planningMessages: [
      { role: "system", content: "Select a permitted connector tool." },
      finalMessages[1],
    ],
    finalMessages,
    tools: [
      { type: "function", function: { name: "github_read", parameters: { type: "object" } } },
    ],
    outputCeiling: 2_200,
    tokenLimit: 10_000,
    ...overrides,
  });
}

test("reservation covers both complete input ceilings and both provider output caps", () => {
  const b = budget();
  assert.equal(
    b.reservedTokens,
    b.planningInputTokens + b.planningOutputTokens + b.finalInputTokenLimit + b.finalOutputTokens,
  );
  assert.ok(b.reservedTokens <= 10_000);
  const smaller = budget({ tokenLimit: b.reservedTokens - 400 });
  assert.equal(smaller.finalOutputTokens, b.finalOutputTokens - 400);
  assert.equal(smaller.reservedTokens, b.reservedTokens - 400);
});

test("invalid allowances and a request that cannot retain a usable final answer fail closed", () => {
  for (const tokenLimit of [0, -1, NaN, Infinity, 1.5, 1])
    assert.throws(() => budget({ tokenLimit }), /budget/);
});

test("remaining tokens can shorten marked source excerpts while preserving the final answer floor", () => {
  const full = budget();
  const floor =
    full.planningInputTokens +
    full.planningOutputTokens +
    full.finalInputTokenLimit -
    1_536 +
    512 +
    1_024;
  const tight = budget({ tokenLimit: floor });
  assert.equal(tight.reservedTokens, floor);
  assert.equal(tight.finalOutputTokens, 1_024);
  assert.equal(tight.finalInputTokenLimit, full.finalInputTokenLimit - 1_024);
  assert.throws(() => budget({ tokenLimit: floor - 1 }), /budget/);
});

test("unknown planning and final outcomes retain conservative usage until valid receipts arrive", () => {
  const b = budget();
  b.startPlanning();
  b.startFinal(finalMessages);
  const reserved = b.usage();
  assert.equal(reserved.outputTokens, b.planningOutputTokens + b.finalOutputTokens);
  assert.ok(reserved.inputTokens + reserved.outputTokens <= b.reservedTokens);
  for (const usage of [
    {},
    { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: "4" },
  ]) {
    assert.equal(b.reportPlanning({ usage }), true);
    b.reportFinal(usage);
    assert.deepEqual(b.usage(), reserved);
  }
  b.reportPlanning({
    usage: {
      input_tokens: 40,
      output_tokens: 20,
      input_tokens_details: { cached_tokens: 50 },
      output_tokens_details: { reasoning_tokens: 30 },
    },
  });
  b.reportFinal({ prompt_tokens: 50, completion_tokens: 30 });
  assert.deepEqual(b.usage(), {
    inputTokens: 90,
    outputTokens: 50,
    cachedInputTokens: 40,
    reasoningTokens: 20,
  });
});

test("one planning call and one final call cannot be replayed through the budget", () => {
  const b = budget();
  b.startPlanning();
  assert.throws(() => b.startPlanning(), /call_budget/);
  b.startFinal(finalMessages);
  assert.throws(() => b.startFinal(finalMessages), /call_budget/);
  assert.throws(() => b.startPlanning(), /call_budget/);
});

test("source excerpt fitting retains IDs and leaves original input messages unchanged", () => {
  const b = budget();
  const source = "Raw Unicode source 你好 👋🏽 ".repeat(10_000);
  const messages = [
    ...finalMessages,
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-a", function: { name: "read", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "call-a", content: source },
  ];
  const bounded = b.boundFinalMessages(messages);
  assert.ok(bounded);
  assert.equal(messages.at(-1).content, source);
  assert.equal(bounded.at(-1).tool_call_id, "call-a");
  assert.equal(bounded.at(-2).tool_calls[0].id, "call-a");
  assert.equal(JSON.parse(bounded.at(-1).content).source_excerpt_truncated, true);
  assert.ok(estimateProviderInput({ messages: bounded }).tokens + 128 <= b.finalInputTokenLimit);
  assert.doesNotThrow(() => b.startFinal(bounded));
});

test("unfittable non-source context is rejected instead of silently dropping instructions or arguments", () => {
  const b = budget();
  const large = [...finalMessages, { role: "assistant", content: "x".repeat(30_000) }];
  assert.equal(b.boundFinalMessages(large), null);
  assert.throws(() => b.startFinal(large), /request_budget/);
  assert.equal(b.usage().inputTokens, 0);
});

test("a known client rejection releases only its own call; an uncertain server failure retains it", () => {
  const b = budget();
  b.startPlanning();
  const spent = b.usage();
  b.rejectPlanning(503);
  assert.deepEqual(b.usage(), spent);
  b.reportPlanning({ usage: { prompt_tokens: 100, completion_tokens: 40 } });
  b.startFinal(finalMessages);
  b.rejectFinal(429);
  assert.deepEqual(b.usage(), {
    inputTokens: 100,
    outputTokens: 40,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  });
});
