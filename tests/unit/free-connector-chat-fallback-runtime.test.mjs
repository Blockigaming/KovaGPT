import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";
import { estimateProviderInput } from "../../src/lib/ai/token-estimator.server.ts";
import { planAllowance } from "../../src/lib/plan-usage-policy.mjs";

const bundled = await build({
  entryPoints: ["src/lib/ai/free-connector-budget.server.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { FreeConnectorBudget, connectedToolsUnavailableMessages } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const route = readFileSync("src/routes/api/chat.ts", "utf8");
const start = route.indexOf("const catalogModel = OPENAI_TEXT_MODELS.find");
const end = route.indexOf("const workingMessages:", start);
assert.ok(start >= 0 && end > start, "Execute the actual chat admission and reservation boundary");
const compiled = ts.transpileModule(route.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const messages = () => [
  { role: "system", content: "Retain all application and account instructions." },
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hi! How can I help?" },
  { role: "user", content: "What is 12 times 13? Answer briefly." },
];
const tools = (large) => [
  {
    type: "function",
    function: {
      name: "read_account",
      description: large ? "schema ".repeat(15000) : "Read permitted account data",
      parameters: { type: "object" },
    },
  },
];

async function admission({
  large = true,
  headroom = 10000,
  rejection,
  maxCost = 1,
  Budget = FreeConnectorBudget,
} = {}) {
  const reservations = [];
  const original = messages();
  const body = { messages: original, max_completion_tokens: 1000 };
  const deps = {
    body,
    availableTools: tools(large),
    enableTools: true,
    freeConnectorRequest: true,
    finalMessages: original,
    toolPlanningMessages: original,
    model: "test-model",
    OPENAI_TEXT_MODELS: [{ id: "test-model" }],
    estimateProviderInput,
    estimateMaximumCostUsd: (_model, input, output) => (input + output) / 1e6,
    getAiRuntimeConfig: () => ({
      maxTokensPerUserDay: 50000,
      maxTokensPerUserMonth: 50000,
      maxCostUsdPerRequest: maxCost,
    }),
    selectedHostedTool: null,
    preflight: { run: (_name, action) => action(new AbortController().signal) },
    getGenerationTokenHeadroom: async () => ({
      tokenLimit: headroom,
      limitingQuota: "daily_tokens",
    }),
    planAllowance,
    FreeConnectorBudget: Budget,
    connectedToolsUnavailableMessages,
    Response,
    ChatPreflightError: class extends Error {},
    auth: { userId: "owner" },
    callerTier: "free",
    clientKey: null,
    hashGuestIp: async () => {
      throw new Error("signed-in calls must not use guest admission");
    },
    request: new Request("https://kovagpt.com/api/chat", {
      headers: { "idempotency-key": "generation-test-123" },
    }),
    requestId: "request-test",
    chatId: "chat-test",
    m: { id: "instant" },
    messages: original,
    HISTORY_TURNS: 24,
    acquireGeneration: async (input) => {
      reservations.push(input);
      return rejection ? { rejection } : { eventId: "event-test" };
    },
  };
  const run = new AsyncFunction(
    ...Object.keys(deps),
    `${compiled}\nreturn { enableTools, finalMessages, toolPlanningMessages, freeConnectorBudget, inputEstimate, maximumProviderCalls, estimatedCost };`,
  );
  return { result: await run(...Object.values(deps)), reservations, original, body };
}

test("an oversized optional tool catalog preserves ordinary chat and reserves exactly one complete call", async () => {
  const { result, reservations, original, body } = await admission();
  assert.equal(result.enableTools, false);
  assert.equal(result.freeConnectorBudget, null);
  assert.equal(result.maximumProviderCalls, 1);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].plan, "free");
  assert.equal(reservations[0].userId, "owner");
  assert.equal(
    reservations[0].reservedTokens,
    estimateProviderInput({ messages: body.messages }).tokens + 1000,
  );
  assert.equal(reservations[0].estimatedCostUsd, result.estimatedCost);
  assert.equal(body.max_completion_tokens, 1000);
  assert.deepEqual(result.finalMessages.slice(1), original.slice(1));
  assert.equal(original[0].content, "Retain all application and account instructions.");
  assert.match(
    result.finalMessages[0].content,
    /^Retain all application and account instructions\./,
  );
  assert.match(
    result.finalMessages[0].content,
    /Connected tools were not run; no new connected-tool results or external action receipts are available/,
  );
  assert.match(
    result.finalMessages[0].content,
    /Never invent retrieved data or claim an action succeeded/,
  );
  assert.deepEqual(result.toolPlanningMessages, result.finalMessages);
});

test("a fitting catalog retains the original connector budget and complete metered reservation", async () => {
  const { result, reservations, original } = await admission({ large: false });
  assert.equal(result.enableTools, true);
  assert.ok(result.freeConnectorBudget instanceof FreeConnectorBudget);
  assert.deepEqual(result.finalMessages, original);
  assert.equal(reservations[0].reservedTokens, result.freeConnectorBudget.reservedTokens);
  assert.ok(reservations[0].reservedTokens <= 10000);
});

test("zero remaining quota still rejects before reserving a provider call", async () => {
  const { result, reservations } = await admission({ headroom: 0 });
  assert.equal(result.status, 429);
  assert.equal((await result.json()).code, "daily_tokens");
  assert.equal(reservations.length, 0);
});

test("the fallback cannot bypass actual account quota or the per-request cost ceiling", async () => {
  const quota = await admission({ rejection: "daily_tokens" });
  assert.equal(quota.result.status, 429);
  assert.equal((await quota.result.json()).code, "daily_tokens");
  assert.equal(quota.reservations.length, 1);
  const cost = await admission({ maxCost: 0.000001 });
  assert.equal(cost.result.status, 413);
  assert.equal((await cost.result.json()).code, "request_budget");
  assert.equal(cost.reservations.length, 0);
});

test("unexpected budget failures remain failures instead of silently dropping connected access", async () => {
  class BrokenBudget {
    constructor() {
      throw new Error("invalid_connector_budget");
    }
  }
  await assert.rejects(admission({ Budget: BrokenBudget }), /invalid_connector_budget/);
  assert.throws(
    () => connectedToolsUnavailableMessages([{ role: "user", content: "Hi" }]),
    /invalid_connector_fallback_context/,
  );
});
