import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/lib/work-execution-v2.server.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};

class FakeProviderError extends Error {
  constructor(envelope) {
    super(envelope.error);
    this.name = "AiProviderError";
    Object.assign(this, envelope);
  }
}

new Function("require", "exports", compiled)((name) => {
  if (name === "node:crypto") return { createHash };
  if (name === "@/integrations/supabase/client.server") return { supabaseAdmin: {} };
  if (name === "@/lib/ai/provider.server") {
    return {
      AiProviderError: FakeProviderError,
      chatCompletions: async () => {
        throw new Error("Default provider dependency must not run in isolated tests");
      },
      chatModel: (kind) => `fixture-${kind}`,
      async providerErrorFromResponse(response) {
        await response.body?.cancel().catch(() => undefined);
        return new FakeProviderError({
          error: "safe fixture provider failure",
          code: response.status === 429 ? "provider_rate_limited" : "provider_unavailable",
          retryable: response.status === 429 || response.status >= 500,
          status: response.status,
        });
      },
    };
  }
  throw new Error(`Unexpected module import: ${name}`);
}, exports);

const { runWorkExecutionBatchV2, validateWorkManagedIdentityBoundary } = exports;
const sourceSha = "a".repeat(40);

function claim(id = "job-1") {
  return {
    job_id: id,
    owner_id: "owner-1",
    attempt_id: `attempt-${id}`,
    attempt_number: 1,
    lease_token: `lease-${id}`,
    lease_expires_at: "2099-01-01T00:00:00.000Z",
    state_version: 1,
    input: { objective: "Prepare a factual launch checklist." },
    tool_policy: { allowed_tools: [] },
    allowed_domains: [],
    entitlement: "pro",
    token_budget: 12000,
  };
}

function harness(options = {}) {
  const queue = [...(options.claims ?? [])];
  const calls = [];
  const rpcCalls = [];
  const chats = [];
  let heartbeatCount = 0;

  const admin = {
    async rpc(name, args = {}) {
      calls.push(name);
      rpcCalls.push({ name, args });
      if (name === "recover_expired_work_attempts_v2") {
        return options.recovery ?? { data: 0, error: null };
      }
      if (name === "claim_work_job_v2") {
        if (options.claimRpc) return options.claimRpc(args);
        const next = queue.shift();
        return { data: next ? [next] : [], error: null };
      }
      if (name === "heartbeat_work_job_v2") {
        heartbeatCount += 1;
        if (options.heartbeat) return options.heartbeat(args, heartbeatCount);
        return {
          data: [
            {
              status: "running",
              requested_action: null,
              lease_expires_at: "2099-01-01T00:00:00.000Z",
              state_version: 1,
            },
          ],
          error: null,
        };
      }
      if (name === "append_work_event_v2") return { data: rpcCalls.length, error: null };
      if (name === "checkpoint_work_job_v2") return { data: rpcCalls.length, error: null };
      if (name === "settle_work_success_v2") {
        if (options.success) return options.success(args);
        return { data: [{ id: args.p_job_id, status: "completed" }], error: null };
      }
      if (name === "settle_work_failure_v2") {
        if (options.failure) return options.failure(args);
        return {
          data: [
            {
              id: args.p_job_id,
              status: "retrying",
              retry_after: "2099-01-01T00:01:00.000Z",
            },
          ],
          error: null,
        };
      }
      if (name === "settle_work_owner_action_v2") {
        if (options.ownerAction) return options.ownerAction(args);
        return { data: [{ id: args.p_job_id, status: "paused" }], error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };

  const dependencies = {
    admin,
    now: () => Date.parse("2026-09-01T00:00:00.000Z"),
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
    async chat(body, init) {
      calls.push("chat");
      chats.push({ body, init });
      if (options.chat) return options.chat(body, init);
      return Response.json(
        {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Launch checklist prepared.",
                  content: "Use exact-SHA evidence and keep release gates fail-closed.",
                }),
              },
            },
          ],
          usage: { input_tokens: 40, output_tokens: 30, total_tokens: 70 },
        },
        { headers: { "x-request-id": "fixture-request" } },
      );
    },
  };

  return { dependencies, calls, rpcCalls, chats };
}

const options = {
  workerId: "work-worker-fixture",
  workerRevision: "revision-1",
  sourceSha,
  capacity: 1,
  limit: 3,
  leaseSeconds: 180,
  heartbeatIntervalMs: 30_000,
};

for (const [name, patch, message] of [
  ["worker ID", { workerId: "" }, /work_worker_id_invalid/u],
  ["revision", { workerRevision: "" }, /work_worker_revision_invalid/u],
  ["source SHA", { sourceSha: "short" }, /work_source_sha_invalid/u],
  ["limit zero", { limit: 0 }, /work_batch_limit_invalid/u],
  ["limit high", { limit: 26 }, /work_batch_limit_invalid/u],
  ["capacity zero", { capacity: 0 }, /work_worker_capacity_invalid/u],
  ["lease short", { leaseSeconds: 59 }, /work_lease_seconds_invalid/u],
  ["heartbeat too slow", { heartbeatIntervalMs: 90_000 }, /work_heartbeat_interval_invalid/u],
]) {
  test(`invalid ${name} stops before database or provider work`, async () => {
    const fixture = harness({ claims: [claim()] });
    await assert.rejects(
      runWorkExecutionBatchV2({ ...options, ...patch }, fixture.dependencies),
      message,
    );
    assert.deepEqual(fixture.calls, []);
  });
}

test("an empty queue performs recovery and one claim without provider spend", async () => {
  const fixture = harness();
  const result = await runWorkExecutionBatchV2(options, fixture.dependencies);
  assert.deepEqual(result, {
    workerId: options.workerId,
    claimed: 0,
    complete: 0,
    failed: 0,
    paused: 0,
    cancelled: 0,
    results: [],
  });
  assert.deepEqual(fixture.calls, ["recover_expired_work_attempts_v2", "claim_work_job_v2"]);
  assert.equal(fixture.chats.length, 0);
});

test("successful model-only Work is fenced, checkpointed, and settled with provider evidence", async () => {
  const fixture = harness({ claims: [claim()] });
  const result = await runWorkExecutionBatchV2(options, fixture.dependencies);
  assert.equal(result.claimed, 1);
  assert.equal(result.complete, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(fixture.calls, [
    "recover_expired_work_attempts_v2",
    "claim_work_job_v2",
    "heartbeat_work_job_v2",
    "append_work_event_v2",
    "checkpoint_work_job_v2",
    "chat",
    "heartbeat_work_job_v2",
    "checkpoint_work_job_v2",
    "append_work_event_v2",
    "settle_work_success_v2",
    "claim_work_job_v2",
  ]);
  assert.equal(fixture.chats[0].body.model, "fixture-deep");
  assert.equal(fixture.chats[0].body.stream, false);
  assert.equal(fixture.chats[0].body.max_tokens, 6000);
  assert.equal(fixture.chats[0].body.tools, undefined);

  const settled = fixture.rpcCalls.find((call) => call.name === "settle_work_success_v2");
  assert.equal(settled.args.p_provider_request_id, "fixture-request");
  assert.equal(settled.args.p_usage.total_tokens, 70);
  assert.equal(settled.args.p_result.runtime, "model_only_v2");
});

test("provider failure uses safe classified settlement and never exposes raw response content", async () => {
  const fixture = harness({
    claims: [claim()],
    chat: async () => new Response("private upstream failure", { status: 503 }),
  });
  const result = await runWorkExecutionBatchV2(options, fixture.dependencies);
  assert.equal(result.failed, 1);
  const settled = fixture.rpcCalls.find((call) => call.name === "settle_work_failure_v2");
  assert.equal(settled.args.p_failure_type, "temporary");
  assert.equal(settled.args.p_retryable, true);
  assert.doesNotMatch(settled.args.p_safe_error, /private upstream/u);
  assert.equal(
    fixture.rpcCalls.some((call) => call.name === "settle_work_success_v2"),
    false,
  );
});

test("nonempty tool policy fails safely without pretending to execute tools", async () => {
  const fixture = harness({
    claims: [
      {
        ...claim(),
        tool_policy: { allowed_tools: ["browser.navigate"] },
      },
    ],
  });
  const result = await runWorkExecutionBatchV2(options, fixture.dependencies);
  assert.equal(result.failed, 1);
  assert.equal(fixture.chats.length, 0);
  const settled = fixture.rpcCalls.find((call) => call.name === "settle_work_failure_v2");
  assert.equal(settled.args.p_failure_type, "policy");
  assert.equal(settled.args.p_retryable, false);
  assert.match(settled.args.p_safe_error, /tools that are not yet available/u);
});

test("owner pause observed on the initial heartbeat settles before model spend", async () => {
  const fixture = harness({
    claims: [claim()],
    heartbeat: async () => ({
      data: [
        {
          status: "cancelling",
          requested_action: "pause",
          lease_expires_at: "2099-01-01T00:00:00.000Z",
          state_version: 2,
        },
      ],
      error: null,
    }),
  });
  const result = await runWorkExecutionBatchV2(options, fixture.dependencies);
  assert.equal(result.paused, 1);
  assert.equal(fixture.chats.length, 0);
  assert.equal(
    fixture.rpcCalls.some((call) => call.name === "settle_work_owner_action_v2"),
    true,
  );
  assert.equal(
    fixture.rpcCalls.some((call) => call.name === "append_work_event_v2"),
    false,
  );
});

test("ambiguous success settlement never becomes a contradictory failure", async () => {
  const fixture = harness({
    claims: [claim()],
    success: async () => ({ data: null, error: { message: "response lost after commit" } }),
  });
  await assert.rejects(
    runWorkExecutionBatchV2(options, fixture.dependencies),
    /completion settlement failed/u,
  );
  assert.equal(
    fixture.rpcCalls.some((call) => call.name === "settle_work_failure_v2"),
    false,
  );
  assert.equal(fixture.chats.length, 1);
});

test("repeated job identity cannot execute twice in one batch", async () => {
  const fixture = harness({ claims: [claim(), claim()] });
  await assert.rejects(runWorkExecutionBatchV2(options, fixture.dependencies), /repeated job/u);
  assert.equal(fixture.chats.length, 1);
  assert.equal(fixture.rpcCalls.filter((call) => call.name === "settle_work_success_v2").length, 1);
});

test("managed-identity boundary requires Azure Container Apps and rejects every direct key path", () => {
  const valid = {
    KOVA_WORK_MODEL_PROVIDER: "azure-managed-identity",
    KOVA_RUNTIME_PLATFORM: "azure-container-apps",
    AZURE_OPENAI_ENDPOINT: "https://fixture.openai.azure.com",
    AZURE_OPENAI_DEPLOYMENT_DEEP: "gpt-5-6-sol",
    KOVA_WORK_MODEL_DEPLOYMENT: "gpt-5-6-sol",
    IDENTITY_ENDPOINT: "http://127.0.0.1/token",
    IDENTITY_HEADER: "fixture-header",
  };
  assert.doesNotThrow(() => validateWorkManagedIdentityBoundary(valid));
  assert.throws(
    () => validateWorkManagedIdentityBoundary({ ...valid, OPENAI_API_KEY: "forbidden" }),
    /work_direct_api_key_forbidden/u,
  );
  assert.throws(
    () => validateWorkManagedIdentityBoundary({ ...valid, AZURE_OPENAI_API_KEY: "forbidden" }),
    /work_direct_api_key_forbidden/u,
  );
  assert.throws(
    () => validateWorkManagedIdentityBoundary({ ...valid, KOVA_RUNTIME_PLATFORM: "local" }),
    /work_runtime_platform_invalid/u,
  );
  assert.throws(
    () => validateWorkManagedIdentityBoundary({ ...valid, KOVA_WORK_MODEL_DEPLOYMENT: "other" }),
    /work_model_deployment_mismatch/u,
  );
});
