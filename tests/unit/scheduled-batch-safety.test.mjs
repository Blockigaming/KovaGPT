import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

// Execute the real server module with inert database/provider adapters. No
// project secrets, cloud account, network request or model generation is used.
const source = readFileSync("src/lib/scheduled-execution.server.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const evaluateModule = new Function("require", "exports", "fetch", "Date", compiled);

class FakeProviderError extends Error {
  constructor(envelope) {
    super(envelope.error);
    Object.assign(this, envelope);
  }
}

function task(id = "task-1") {
  return {
    id,
    user_id: "fixture-owner",
    title: "Local fixture",
    prompt: "Explain one useful idea.",
    run_at: "2026-08-30T10:00:00.000Z",
    next_run_at: "2026-08-30T10:00:00.000Z",
    repeat: "none",
    status: "running",
    execution_attempts: 1,
    worker_id: "fixture-worker",
    lease_expires_at: "2026-08-30T10:02:00.000Z",
  };
}

function harness(options = {}) {
  const queue = [...(options.tasks ?? [])];
  const now = () => options.now?.() ?? Date.parse("2026-08-30T10:00:00.000Z");
  class FixtureDate extends Date {
    constructor(...values) {
      super(...(values.length ? values : [now()]));
    }
    static now() {
      return now();
    }
  }
  const calls = [];
  const providers = [];
  const upserts = [];
  const rpcCalls = [];
  const client = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      calls.push(name);
      if (name === "recover_expired_scheduled_task_leases") {
        return options.recovery ?? { data: 0, error: null };
      }
      if (name === "claim_due_scheduled_tasks") {
        if (options.claim) return options.claim(args);
        return {
          data: queue.splice(0, args.p_limit).map((item) => ({
            ...item,
            worker_id: args.p_worker_id,
          })),
          error: null,
        };
      }
      if (name === "settle_scheduled_task_success") {
        if (options.success) return options.success(args);
        return { data: [{ next_run_at: null, delivery_status: "sent" }], error: null };
      }
      if (name === "settle_scheduled_task_failure") {
        if (options.failure) return options.failure(args);
        return { data: [{ retry_at: null, delivery_status: "sent" }], error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      assert.equal(table, "scheduled_task_runs");
      return {
        async upsert(row, config) {
          calls.push("write-run");
          upserts.push({ row, config });
          if (typeof options.upsert === "function") return options.upsert(row, config);
          return options.upsert ?? { data: null, error: null };
        },
      };
    },
  };
  const exports = {};
  evaluateModule(
    (name) => {
      if (name === "node:crypto") return { randomUUID };
      if (name === "@/integrations/supabase/client.server") return { supabaseAdmin: client };
      if (name === "@/lib/ai/provider.server") {
        return {
          AiProviderError: FakeProviderError,
          chatModel: () => "fixture-model",
          async chatCompletions(body) {
            calls.push("generate");
            providers.push(body);
            if (options.provider) return options.provider(body);
            return Response.json({ choices: [{ message: { content: "Fixture result" } }] });
          },
        };
      }
      throw new Error(`Unexpected module import: ${name}`);
    },
    exports,
    () => {
      throw new Error("Network calls are forbidden in this isolated test");
    },
    FixtureDate,
  );
  return { run: exports.runScheduledExecutionBatch, calls, providers, upserts, rpcCalls };
}

const byRpc = (fixture, name) => fixture.rpcCalls.filter((call) => call.name === name);
const claims = (fixture) => byRpc(fixture, "claim_due_scheduled_tasks");
const failures = (fixture) => byRpc(fixture, "settle_scheduled_task_failure");
const successes = (fixture) => byRpc(fixture, "settle_scheduled_task_success");

for (const limit of [NaN, Infinity, -Infinity, 0, -1, 1.5, 26, "2"]) {
  test(`invalid limit ${String(limit)} cannot claim or generate`, async () => {
    const fixture = harness({ tasks: [task()] });
    await assert.rejects(fixture.run({ limit }), /integer between 1 and 25/u);
    assert.equal(fixture.calls.length, 0);
  });
}

test("an empty queue stops without model calls", async () => {
  const fixture = harness();
  const result = await fixture.run({ workerId: "fixture-worker" });
  assert.deepEqual(result, {
    workerId: "fixture-worker",
    claimed: 0,
    complete: 0,
    failed: 0,
    results: [],
  });
  assert.equal(claims(fixture).length, 1);
  assert.equal(claims(fixture)[0].args.p_limit, 1);
  assert.equal(fixture.providers.length, 0);
});

test("leases are acquired one at a time after prior settlement", async () => {
  const fixture = harness({ tasks: [task("first"), task("second"), task("not-claimed")] });
  const result = await fixture.run({ workerId: "fixture-worker", limit: 2 });
  assert.deepEqual(fixture.calls, [
    "recover_expired_scheduled_task_leases",
    "claim_due_scheduled_tasks",
    "write-run",
    "generate",
    "settle_scheduled_task_success",
    "claim_due_scheduled_tasks",
    "write-run",
    "generate",
    "settle_scheduled_task_success",
  ]);
  assert.equal(result.claimed, 2);
  assert.equal(result.complete, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    claims(fixture).map((call) => call.args.p_limit),
    [1, 1],
  );
  assert.equal(fixture.providers.length, 2);
});

test("the default batch is bounded to five tasks", async () => {
  const fixture = harness({ tasks: Array.from({ length: 7 }, (_, i) => task(`task-${i}`)) });
  const result = await fixture.run();
  assert.equal(result.claimed, 5);
  assert.equal(fixture.providers.length, 5);
  assert.equal(claims(fixture).length, 5);
});

test("recovery failure aborts before claiming", async () => {
  const fixture = harness({ recovery: { data: null, error: { message: "fixture failure" } } });
  await assert.rejects(fixture.run(), /lease recovery failed/u);
  assert.equal(claims(fixture).length, 0);
  assert.equal(fixture.providers.length, 0);
});

for (const [label, value] of [
  ["null response", null],
  ["object response", {}],
  ["string response", "invalid"],
  ["oversized batch", [task("a"), task("b")]],
  ["null task", [null]],
  ["missing task identity", [{}]],
]) {
  test(`invalid claim (${label}) cannot trigger generation`, async () => {
    const fixture = harness({ claim: async () => ({ data: value, error: null }) });
    await assert.rejects(fixture.run(), /invalid/u);
    assert.equal(fixture.providers.length, 0);
    assert.equal(fixture.upserts.length, 0);
  });
}

test("claim RPC failure aborts without generation", async () => {
  const fixture = harness({
    claim: async () => ({ data: [], error: { message: "fixture failure" } }),
  });
  await assert.rejects(fixture.run(), /claim failed/u);
  assert.equal(fixture.providers.length, 0);
});

test("a repeated task cannot generate twice in one batch", async () => {
  const fixture = harness({ tasks: [task(), task()] });
  await assert.rejects(fixture.run({ limit: 2 }), /repeated task/u);
  assert.equal(fixture.providers.length, 1);
  assert.equal(successes(fixture).length, 1);
  assert.equal(fixture.upserts.length, 1);
});

test("a missing run record prevents spending on generation", async () => {
  const fixture = harness({
    tasks: [task()],
    upsert: { data: null, error: { message: "fixture failure" } },
  });
  await assert.rejects(fixture.run(), /Could not create scheduled run/u);
  assert.equal(fixture.providers.length, 0);
  assert.equal(failures(fixture).length, 0);
});

test("invalid scheduled time prevents both history writes and generation", async () => {
  const fixture = harness({ tasks: [{ ...task(), next_run_at: "invalid date" }] });
  await assert.rejects(fixture.run(), /invalid execution time/u);
  assert.equal(fixture.providers.length, 0);
  assert.equal(fixture.upserts.length, 0);
});

for (const [name, success] of [
  ["database error", async () => ({ data: null, error: { message: "fixture database error" } })],
  ["empty acknowledgement", async () => ({ data: [], error: null })],
  [
    "lost response",
    async () => {
      throw new Error("fixture response lost after commit");
    },
  ],
  [
    "non-array acknowledgement",
    async () => ({ data: { 0: { delivery_status: "sent" } }, error: null }),
  ],
  ["missing delivery acknowledgement", async () => ({ data: [{}], error: null })],
]) {
  test(`ambiguous success settlement (${name}) never writes a contradictory failure`, async () => {
    const fixture = harness({ tasks: [task("first"), task("second")], success });
    await assert.rejects(fixture.run({ limit: 2 }));
    assert.equal(fixture.providers.length, 1);
    assert.equal(claims(fixture).length, 1);
    assert.equal(successes(fixture).length, 1);
    assert.equal(failures(fixture).length, 0);
  });
}

for (const [status, type, retryable] of [
  [400, "permanent", false],
  [401, "authorization", false],
  [402, "authorization", false],
  [403, "authorization", false],
  [429, "temporary", true],
  [503, "temporary", true],
]) {
  test(`provider HTTP ${status} preserves classified safe failure settlement`, async () => {
    let canceled = false;
    const fixture = harness({
      tasks: [task()],
      provider: async () => ({
        ok: false,
        status,
        body: {
          cancel: async () => {
            canceled = true;
          },
        },
        text: async () => {
          throw new Error("Raw provider error bodies must not be consumed");
        },
      }),
    });
    const result = await fixture.run({ limit: 1 });
    assert.equal(result.failed, 1);
    assert.equal(result.complete, 0);
    assert.equal(canceled, true);
    assert.equal(successes(fixture).length, 0);
    assert.equal(failures(fixture).length, 1);
    assert.equal(failures(fixture)[0].args.p_failure_type, type);
    assert.equal(failures(fixture)[0].args.p_retryable, retryable);
    assert.doesNotMatch(failures(fixture)[0].args.p_safe_error, /Raw provider/u);
  });
}

test("a failed failure-settlement stops the batch rather than retrying it", async () => {
  const fixture = harness({
    tasks: [task("first"), task("second")],
    provider: async () => {
      throw new Error("fixture private provider text");
    },
    failure: async () => ({ data: null, error: { message: "fixture settlement error" } }),
  });
  await assert.rejects(fixture.run({ limit: 2 }), /failure settlement failed/u);
  assert.equal(fixture.providers.length, 1);
  assert.equal(claims(fixture).length, 1);
  assert.equal(failures(fixture).length, 1);
});

test("result limits and stable task/scheduled-for identity are retained", async () => {
  const fixture = harness({
    tasks: [task()],
    provider: async () => Response.json({ choices: [{ message: { content: "x".repeat(13000) } }] }),
  });
  await fixture.run({ limit: 1, workerId: "fixture-worker" });
  const request = fixture.providers[0];
  assert.equal(request.max_tokens, 1800);
  assert.equal(request.stream, false);
  assert.equal(request.tools, undefined);
  const settled = successes(fixture)[0].args;
  assert.equal(settled.p_result.length, 12000);
  assert.equal(settled.p_run_id, `${task().id}:${Date.parse(task().next_run_at)}`);
  assert.equal(settled.p_worker_id, "fixture-worker");
});

for (const [label, fields] of [
  ["missing owner", { user_id: null }],
  ["empty prompt", { prompt: "   " }],
  ["wrong status", { status: "complete" }],
  ["foreign worker", { worker_id: "another-worker" }],
  ["missing lease", { lease_expires_at: null }],
  ["invalid lease", { lease_expires_at: "invalid" }],
  ["expired lease", { lease_expires_at: "2026-08-30T09:59:59.000Z" }],
  ["lease expiring now", { lease_expires_at: "2026-08-30T10:00:00.000Z" }],
  ["invalid attempt", { execution_attempts: 0 }],
]) {
  test(`unusable claim (${label}) stops before history writes or generation`, async () => {
    const fixture = harness({
      claim: async () => ({ data: [{ ...task(), ...fields }], error: null }),
    });
    await assert.rejects(fixture.run({ workerId: "fixture-worker" }), /invalid|expired/u);
    assert.equal(fixture.upserts.length, 0);
    assert.equal(fixture.providers.length, 0);
    assert.equal(failures(fixture).length, 0);
  });
}

test("a lease that expires during the history write cannot trigger paid work", async () => {
  let now = Date.parse("2026-08-30T10:00:00.000Z");
  const fixture = harness({
    tasks: [task()],
    now: () => now,
    upsert: async () => {
      now += 120_000;
      return { data: null, error: null };
    },
  });
  await assert.rejects(fixture.run({ workerId: "fixture-worker" }), /expired lease/u);
  assert.equal(fixture.upserts.length, 1);
  assert.equal(fixture.providers.length, 0);
  assert.equal(failures(fixture).length, 0);
});

for (const [label, reason, expectedType] of [
  ["abort", new DOMException("fixture aborted", "AbortError"), "timeout"],
  [
    "provider timeout",
    new FakeProviderError({
      error: "private",
      code: "provider_timeout",
      retryable: true,
      status: 504,
    }),
    "timeout",
  ],
]) {
  test(`${label} preserves bounded failure classification`, async () => {
    const fixture = harness({
      tasks: [task()],
      provider: async () => {
        throw reason;
      },
    });
    const result = await fixture.run({ limit: 1 });
    assert.equal(result.failed, 1);
    assert.equal(failures(fixture)[0].args.p_failure_type, expectedType);
    assert.equal(failures(fixture)[0].args.p_retryable, true);
    assert.doesNotMatch(failures(fixture)[0].args.p_safe_error, /private|fixture/u);
  });
}
