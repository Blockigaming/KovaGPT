import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/lib/scheduled-execution-v2.server.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const evaluateModule = new Function("require", "exports", "Date", compiled);

class FakeProviderError extends Error {
  constructor(envelope) {
    super(envelope.error);
    Object.assign(this, envelope);
  }
}

function claim(overrides = {}) {
  return {
    task_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    occurrence_id: "33333333-3333-4333-8333-333333333333",
    attempt_id: "44444444-4444-4444-8444-444444444444",
    attempt_number: 1,
    lease_token: "55555555-5555-4555-8555-555555555555",
    lease_expires_at: "2026-08-31T13:02:00.000Z",
    task_state_version: 3,
    scheduled_for: "2026-08-31T13:00:00.000Z",
    title: "Fixture",
    prompt: "Return a concise fixture result.",
    repeat: "none",
    time_zone: "UTC",
    schedule_rule: null,
    ...overrides,
  };
}

function harness(options = {}) {
  const queue = [...(options.claims ?? [])];
  const calls = [];
  const providerCalls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "pause_ineligible_scheduled_tasks_v2") {
        return options.entitlementSweep ?? { data: 0, error: null };
      }
      if (name === "recover_expired_scheduled_task_attempts_v2") {
        return options.recovery ?? { data: 0, error: null };
      }
      if (name === "claim_due_scheduled_task_occurrence_v2") {
        if (options.claimResult) return options.claimResult(args);
        const next = queue.shift();
        return { data: next ? [next] : [], error: null };
      }
      if (name === "heartbeat_scheduled_task_attempt_v2") {
        if (options.heartbeat) return options.heartbeat(args);
        return {
          data: [{ lease_expires_at: "2026-08-31T13:02:00.000Z", cancel_requested: false }],
          error: null,
        };
      }
      if (name === "settle_scheduled_task_success_v2") {
        if (options.success) return options.success(args);
        return { data: [{ next_run_at: null, outbox_queued: true }], error: null };
      }
      if (name === "settle_scheduled_task_failure_v2") {
        if (options.failure) return options.failure(args);
        return { data: [{ retry_at: null, terminal: true }], error: null };
      }
      if (name === "settle_scheduled_task_canceled_v2") {
        if (options.canceled) return options.canceled(args);
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from() {
      throw new Error("v2 executor must not perform direct table writes");
    },
  };

  class FixtureDate extends Date {
    constructor(...values) {
      super(...(values.length ? values : [Date.parse("2026-08-31T13:00:00.000Z")]));
    }
    static now() {
      return Date.parse("2026-08-31T13:00:00.000Z");
    }
  }

  const exports = {};
  evaluateModule(
    (name) => {
      if (name === "node:crypto") return { createHash, randomUUID };
      if (name === "@/integrations/supabase/client.server") return { supabaseAdmin: client };
      if (name === "@/lib/ai/provider.server") {
        return {
          AiProviderError: FakeProviderError,
          chatModel: () => "fixture-model",
          async chatCompletions(body, init) {
            providerCalls.push({ body, init });
            if (options.provider) return options.provider(body, init);
            return new Response(
              JSON.stringify({ choices: [{ message: { content: "Fixture result" } }] }),
              { status: 200, headers: { "x-request-id": "fixture-provider-request" } },
            );
          },
        };
      }
      throw new Error(`Unexpected import ${name}`);
    },
    exports,
    FixtureDate,
  );

  return { run: exports.runScheduledExecutionBatchV2, calls, providerCalls };
}

const rpc = (fixture, name) => fixture.calls.filter((item) => item.name === name);

for (const limit of [NaN, Infinity, -1, 0, 1.5, 26, "2"]) {
  test(`invalid v2 batch limit ${String(limit)} spends nothing`, async () => {
    const fixture = harness({ claims: [claim()] });
    await assert.rejects(fixture.run({ limit }), /integer between 1 and 25/u);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.providerCalls.length, 0);
  });
}

test("empty v2 queue runs entitlement and recovery once then stops", async () => {
  const fixture = harness();
  const result = await fixture.run({ workerId: "worker-v2" });
  assert.equal(result.claimed, 0);
  assert.deepEqual(
    fixture.calls.map((item) => item.name),
    [
      "pause_ineligible_scheduled_tasks_v2",
      "recover_expired_scheduled_task_attempts_v2",
      "claim_due_scheduled_task_occurrence_v2",
    ],
  );
  assert.equal(fixture.providerCalls.length, 0);
});

test("successful v2 execution is heartbeat-fenced and settles with provider evidence", async () => {
  const fixture = harness({ claims: [claim()] });
  const result = await fixture.run({ workerId: "worker-v2", limit: 1 });
  assert.equal(result.claimed, 1);
  assert.equal(result.complete, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.canceled, 0);
  assert.equal(rpc(fixture, "heartbeat_scheduled_task_attempt_v2").length, 1);
  const settled = rpc(fixture, "settle_scheduled_task_success_v2")[0].args;
  assert.equal(settled.p_task_id, claim().task_id);
  assert.equal(settled.p_occurrence_id, claim().occurrence_id);
  assert.equal(settled.p_attempt_id, claim().attempt_id);
  assert.equal(settled.p_lease_token, claim().lease_token);
  assert.equal(settled.p_provider_request_id, "fixture-provider-request");
  assert.equal(
    settled.p_provider_receipt,
    createHash("sha256").update("Fixture result").digest("hex"),
  );
  assert.equal(fixture.providerCalls[0].body.max_tokens, 1800);
  assert.equal(fixture.providerCalls[0].body.stream, false);
  assert.ok(fixture.providerCalls[0].init.signal instanceof AbortSignal);
});

test("provider failure uses fenced failure settlement and safe classification", async () => {
  const fixture = harness({
    claims: [claim()],
    provider: async () => ({
      ok: false,
      status: 429,
      body: { cancel: async () => undefined },
    }),
    failure: async (args) => {
      assert.equal(args.p_failure_type, "temporary");
      assert.equal(args.p_retryable, true);
      assert.doesNotMatch(args.p_safe_error, /429/u);
      return { data: [{ retry_at: "2026-08-31T13:01:00.000Z", terminal: false }], error: null };
    },
  });
  const result = await fixture.run({ limit: 1 });
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].retryAt, "2026-08-31T13:01:00.000Z");
  assert.equal(rpc(fixture, "settle_scheduled_task_success_v2").length, 0);
});

test("owner cancellation observed at final heartbeat discards generated result", async () => {
  const fixture = harness({
    claims: [claim()],
    heartbeat: async () => ({
      data: [{ lease_expires_at: "2026-08-31T13:02:00.000Z", cancel_requested: true }],
      error: null,
    }),
  });
  const result = await fixture.run({ limit: 1 });
  assert.equal(result.canceled, 1);
  assert.equal(rpc(fixture, "settle_scheduled_task_canceled_v2").length, 1);
  assert.equal(rpc(fixture, "settle_scheduled_task_success_v2").length, 0);
  assert.equal(rpc(fixture, "settle_scheduled_task_failure_v2").length, 0);
});

test("ambiguous success settlement never becomes a contradictory failure", async () => {
  const fixture = harness({
    claims: [claim()],
    success: async () => ({ data: null, error: { message: "response lost" } }),
  });
  await assert.rejects(fixture.run({ limit: 1 }), /success settlement failed/u);
  assert.equal(fixture.providerCalls.length, 1);
  assert.equal(rpc(fixture, "settle_scheduled_task_success_v2").length, 1);
  assert.equal(rpc(fixture, "settle_scheduled_task_failure_v2").length, 0);
});

test("heartbeat uncertainty after provider success prevents any terminal settlement", async () => {
  const fixture = harness({
    claims: [claim()],
    heartbeat: async () => ({ data: null, error: { message: "lease store unavailable" } }),
  });
  await assert.rejects(fixture.run({ limit: 1 }), /heartbeat failed/u);
  assert.equal(fixture.providerCalls.length, 1);
  assert.equal(rpc(fixture, "settle_scheduled_task_success_v2").length, 0);
  assert.equal(rpc(fixture, "settle_scheduled_task_failure_v2").length, 0);
});

test("the same occurrence cannot be executed twice inside one batch", async () => {
  const fixture = harness({ claims: [claim(), claim()] });
  await assert.rejects(fixture.run({ limit: 2 }), /same occurrence twice/u);
  assert.equal(fixture.providerCalls.length, 1);
  assert.equal(rpc(fixture, "settle_scheduled_task_success_v2").length, 1);
});
