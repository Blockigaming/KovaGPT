import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/lib/scheduled-delivery-v2.server.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(handlers = {}) {
  const calls = [];
  const admin = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (handlers[name]) return handlers[name](args);
      if (name === "recover_stale_scheduled_delivery_v2") return { data: 2, error: null };
      if (name === "deliver_scheduled_in_app_outbox_v2") {
        return {
          data: [{ claimed: 3, sent: 2, failed: 1, disabled: 0 }],
          error: null,
        };
      }
      if (name === "scheduled_worker_readiness_v2") {
        return {
          data: [
            {
              ready: true,
              status: "ready",
              heartbeat_age_seconds: 2,
              source_sha: "a".repeat(40),
              worker_revision: "revision-1",
              due_tasks: 1,
              running_attempts: 0,
              expired_attempts: 0,
              ready_deliveries: 4,
              failed_deliveries: 1,
              disabled_deliveries: 0,
            },
          ],
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const exports = {};
  new Function("require", "exports", compiled)(
    (name) => {
      if (name === "@/integrations/supabase/client.server") return { supabaseAdmin: admin };
      throw new Error(`Unexpected import ${name}`);
    },
    exports,
  );
  return { ...exports, calls };
}

test("delivery recovers stale rows before draining in-app outbox", async () => {
  const fixture = harness();
  const result = await fixture.runScheduledDeliveryBatchV2({ limit: 25, staleSeconds: 420 });
  assert.deepEqual(result, {
    claimed: 3,
    sent: 2,
    failed: 1,
    disabled: 0,
    recovered: 2,
  });
  assert.deepEqual(fixture.calls, [
    {
      name: "recover_stale_scheduled_delivery_v2",
      args: { p_stale_seconds: 420, p_limit: 100 },
    },
    {
      name: "deliver_scheduled_in_app_outbox_v2",
      args: { p_limit: 25 },
    },
  ]);
});

for (const [label, options] of [
  ["zero limit", { limit: 0 }],
  ["high limit", { limit: 201 }],
  ["fractional limit", { limit: 1.5 }],
  ["short stale interval", { staleSeconds: 10 }],
  ["high stale interval", { staleSeconds: 3601 }],
]) {
  test(`invalid delivery ${label} stops before database work`, async () => {
    const fixture = harness();
    await assert.rejects(fixture.runScheduledDeliveryBatchV2(options), /integer between/u);
    assert.equal(fixture.calls.length, 0);
  });
}

test("delivery recovery errors preserve the underlying cause", async () => {
  const cause = { message: "private db detail" };
  const fixture = harness({
    recover_stale_scheduled_delivery_v2: async () => ({ data: null, error: cause }),
  });
  await assert.rejects(fixture.runScheduledDeliveryBatchV2(), (error) => {
    assert.match(error.message, /recovery failed/u);
    assert.equal(error.cause, cause);
    assert.doesNotMatch(error.message, /private db detail/u);
    return true;
  });
});

test("delivery rejects malformed or inconsistent database acknowledgements", async () => {
  for (const data of [
    null,
    [],
    [{ claimed: 3, sent: 1, failed: 0, disabled: 0 }],
    [{ claimed: -1, sent: 0, failed: 0, disabled: -1 }],
    [{ claimed: 1, sent: 0.5, failed: 0.5, disabled: 0 }],
  ]) {
    const fixture = harness({
      deliver_scheduled_in_app_outbox_v2: async () => ({ data, error: null }),
    });
    await assert.rejects(fixture.runScheduledDeliveryBatchV2());
  }
});

test("readiness maps the database snapshot without exposing implementation rows", async () => {
  const fixture = harness();
  const result = await fixture.readScheduledWorkerReadinessV2({
    environment: "staging",
    maxStaleSeconds: 240,
    maxDeliveryBacklog: 250,
  });
  assert.deepEqual(result, {
    ready: true,
    status: "ready",
    heartbeatAgeSeconds: 2,
    sourceSha: "a".repeat(40),
    workerRevision: "revision-1",
    dueTasks: 1,
    runningAttempts: 0,
    expiredAttempts: 0,
    readyDeliveries: 4,
    failedDeliveries: 1,
    disabledDeliveries: 0,
  });
  assert.deepEqual(fixture.calls[0], {
    name: "scheduled_worker_readiness_v2",
    args: {
      p_environment: "staging",
      p_max_stale_seconds: 240,
      p_max_delivery_backlog: 250,
    },
  });
});

for (const environment of ["", "Bad Env", "_bad", "x".repeat(51)]) {
  test(`invalid readiness environment ${JSON.stringify(environment)} stops before RPC`, async () => {
    const fixture = harness();
    await assert.rejects(
      fixture.readScheduledWorkerReadinessV2({ environment }),
      /environment is invalid/u,
    );
    assert.equal(fixture.calls.length, 0);
  });
}

test("readiness rejects invalid counters and heartbeat ages", async () => {
  for (const patch of [
    { due_tasks: -1 },
    { running_attempts: 1.5 },
    { heartbeat_age_seconds: -1 },
    { ready: "yes" },
    { status: "" },
  ]) {
    const fixture = harness({
      scheduled_worker_readiness_v2: async () => ({
        data: [
          {
            ready: true,
            status: "ready",
            heartbeat_age_seconds: 0,
            source_sha: "a".repeat(40),
            worker_revision: "revision-1",
            due_tasks: 0,
            running_attempts: 0,
            expired_attempts: 0,
            ready_deliveries: 0,
            failed_deliveries: 0,
            disabled_deliveries: 0,
            ...patch,
          },
        ],
        error: null,
      }),
    });
    await assert.rejects(
      fixture.readScheduledWorkerReadinessV2({ environment: "staging" }),
      /invalid snapshot/u,
    );
  }
});
