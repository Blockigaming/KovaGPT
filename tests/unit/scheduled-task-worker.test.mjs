import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../src/lib/scheduled-task-policy.mjs";
import { estimateProviderInput } from "../../src/lib/ai/token-estimator.server.ts";
import { readProviderJsonObject } from "../../src/lib/provider-response.server.mjs";
class ProviderError extends Error {
  constructor(input) {
    super(input.error);
    Object.assign(this, input);
  }
}
class ConnectionError extends Error {}
function worker({
  rejectUsage = false,
  revokedBeforeDispatch = false,
  providerFailure = false,
  ready = true,
  eventPumpFailure = false,
} = {}) {
  const calls = [],
    exports = {},
    task = {
      id: randomUUID(),
      user_id: randomUUID(),
      title: "Task",
      prompt: "Summarize this saved prompt.",
      run_at: new Date().toISOString(),
      next_run_at: new Date().toISOString(),
      repeat: "none",
      status: "running",
      execution_attempts: 1,
      context_refs: [],
    };
  const rpc = (name, args) => ({
    abortSignal: async () => {
      calls.push({ name, args });
      const data =
        name === "scheduled_task_heartbeat"
          ? true
          : name === "claim_due_scheduled_tasks"
            ? [task]
            : name === "begin_scheduled_task_run"
              ? { task, plan: "plus", event: null, connectionGrants: [] }
              : name === "read_scheduled_task_saved_context"
                ? []
                : name === "scheduled_task_check_execution"
                  ? !revokedBeforeDispatch
                  : name === "settle_scheduled_task_failure"
                    ? [{ retry_at: null, delivery_status: "sent" }]
                    : name === "settle_scheduled_task_success"
                      ? [{ next_run_at: null, delivery_status: "sent" }]
                      : 0;
      return { data, error: null };
    },
  });
  const model = {
    id: "gpt-5.6-luna",
    outputCeiling: 1800,
    maxOutputTokens: 32000,
    pricePerMillion: { input: 0.5, output: 1.5 },
  };
  const modules = {
    "@/lib/scheduled-task-events.server": {
      pumpScheduledTaskEvents: async (args) => {
        calls.push({
          name: "event-pump",
          limit: args.limit,
          hasDeadline: args.signal instanceof AbortSignal,
        });
        if (eventPumpFailure) throw new Error("event service unavailable");
        return { processed: 0 };
      },
    },
    "node:crypto": { randomUUID },
    "@/integrations/supabase/client.server": { supabaseAdmin: { rpc } },
    "@/lib/ai/provider.server": {
      AiProviderError: ProviderError,
      chatCompletions: async (body) => {
        calls.push({ name: "provider", body });
        return providerFailure
          ? new Response("", { status: 503 })
          : Response.json({
              choices: [{ message: { content: "Verified result" } }],
              usage: { prompt_tokens: 41, completion_tokens: 19 },
            });
      },
    },
    "@/lib/ai/accounting.server": {
      acquireGeneration: async (args) => {
        calls.push({ name: "acquire", args });
        return rejectUsage ? { rejection: "daily_limit" } : { eventId: "usage" };
      },
      finalizeGeneration: async (args) => {
        calls.push({ name: "finalize", args });
      },
    },
    "@/lib/ai/config.server": {
      getAiRuntimeConfig: () => ({ generationEnabled: true, maxCostUsdPerRequest: 0.1 }),
    },
    "@/lib/ai/model-catalog.server": { modelForPolicy: () => model },
    "@/lib/ai/token-estimator.server": { estimateProviderInput },
    "@/lib/provider-response.server.mjs": { readProviderJsonObject },
    "@/lib/scheduled-execution-readiness.server": {
      scheduledExecutionReadiness: () => ({ configured: ready }),
    },
    "@/lib/runtime-env.server": { runtimeEnv: () => "test-v1" },
    "@/lib/scheduled-task-policy.mjs": policy,
    "@/lib/scheduled-task-connected.server": {
      TaskConnectionError: ConnectionError,
      readTaskConnectedContext: async () => {
        throw new Error("unexpected connector");
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/scheduled-execution.server.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => modules[name],
      Date,
      Error,
      DOMException,
      console: { warn: () => {} },
      AbortSignal,
      process: { pid: 1 },
    },
  );
  return {
    run: () => exports.runScheduledExecutionBatch({ workerId: "test-worker", limit: 10 }),
    calls,
  };
}
test("worker reserves consumer usage before provider dispatch and finalizes before result publication", async () => {
  const { run, calls } = worker();
  const result = await run();
  assert.equal(result.complete, 1);
  const names = calls.map((call) => call.name);
  assert.ok(names.indexOf("event-pump") < names.indexOf("claim_due_scheduled_tasks"));
  assert.equal(calls.find((call) => call.name === "event-pump").limit, 3);
  assert.ok(names.indexOf("acquire") < names.indexOf("provider"));
  assert.ok(names.indexOf("finalize") < names.indexOf("settle_scheduled_task_success"));
  const acquisition = calls.find((call) => call.name === "acquire").args;
  assert.equal(acquisition.plan, "plus");
  assert.equal(acquisition.mode, "medium");
  assert.equal(acquisition.premium, false);
  assert.ok(acquisition.reservedTokens > acquisition.estimatedInputTokens);
  assert.equal(calls.find((call) => call.name === "claim_due_scheduled_tasks").args.p_limit, 1);
  assert.equal(calls.find((call) => call.name === "finalize").args.inputTokens, 41);
});
test("usage rejection never calls the provider and retains normal failure settlement", async () => {
  const { run, calls } = worker({ rejectUsage: true });
  assert.equal((await run()).failed, 1);
  assert.equal(
    calls.some((call) => call.name === "provider"),
    false,
  );
  assert.equal(
    calls.some((call) => call.name === "finalize"),
    false,
  );
  assert.ok(calls.some((call) => call.name === "settle_scheduled_task_failure"));
});
test("current consent is rechecked after reservation and a revoked grant spends no tokens", async () => {
  const { run, calls } = worker({ revokedBeforeDispatch: true });
  await run();
  assert.equal(
    calls.some((call) => call.name === "provider"),
    false,
  );
  const usage = calls.find((call) => call.name === "finalize").args;
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
  const failure = calls.find((call) => call.name === "settle_scheduled_task_failure").args;
  assert.equal(failure.p_failure_type, "authorization");
  assert.equal(failure.p_retryable, false);
});
test("uncertain provider failures settle a conservative bounded reservation, never free repeated attempts", async () => {
  const { run, calls } = worker({ providerFailure: true });
  await run();
  const acquired = calls.find((call) => call.name === "acquire").args,
    finished = calls.find((call) => call.name === "finalize").args;
  assert.equal(finished.inputTokens, acquired.estimatedInputTokens);
  assert.equal(finished.outputTokens, 1800);
  assert.equal(
    calls.some((call) => call.name === "settle_scheduled_task_success"),
    false,
  );
});
test("unconfigured worker cannot publish its own readiness heartbeat", async () => {
  const { run, calls } = worker({ ready: false });
  await assert.rejects(run(), /not_ready/);
  assert.equal(calls.length, 0);
});
test("Task policy rejects credential-like context fields, mixed triggers, malformed clocks and excess cost", () => {
  assert.throws(() =>
    policy.parseTaskContext([
      {
        kind: "snapshot",
        text: "Saved",
        sourceChatId: "chat",
        capturedAt: new Date().toISOString(),
        accessToken: "secret",
      },
    ]),
  );
  assert.throws(() =>
    policy.parseTaskPayload({
      title: "Task",
      prompt: "Prompt",
      run_at: new Date().toISOString(),
      triggerMode: "event",
      eventTriggers: [{ provider: "gmail", grantId: randomUUID(), resource: "inbox" }],
    }),
  );
  assert.throws(() => policy.taskResource("github", "../private"));
  assert.throws(() => policy.taskTimezone("America/Unknown"));
  const model = {
      outputCeiling: 1800,
      maxOutputTokens: 2000,
      pricePerMillion: { input: 0.5, output: 1.5 },
    },
    config = { generationEnabled: true, maxCostUsdPerRequest: 0.1 };
  const ascii = policy.consumerTaskBounds(
      model,
      config,
      estimateProviderInput("a".repeat(1000)).tokens,
    ),
    unicode = policy.consumerTaskBounds(
      model,
      config,
      estimateProviderInput("漢".repeat(1000)).tokens,
    );
  assert.ok(unicode.inputTokens > ascii.inputTokens);
  assert.throws(
    () => policy.consumerTaskBounds(model, { ...config, maxCostUsdPerRequest: 0.0001 }, 1000),
    /cost_admission_failed/,
  );
});

test("native event intake failure leaves durable inbox retries and time schedules independent", async () => {
  const { run, calls } = worker({ eventPumpFailure: true });
  assert.equal((await run()).complete, 1);
  assert.equal(calls.filter((call) => call.name === "provider").length, 1);
});
