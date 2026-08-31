import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/workers/scheduled-v2-runner.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("exports", "process", compiled)(exports, { env: {} });
const { runScheduledWorkerOnce } = exports;

const validEnv = {
  KOVA_SCHEDULED_WORKER_ENABLED: "1",
  KOVA_SCHEDULED_WORKER_ENVIRONMENT: "staging",
  KOVA_WORKER_REVISION: "revision-1",
  KOVA_SOURCE_SHA: "a".repeat(40),
  KOVA_SCHEDULED_WORKER_BATCH_LIMIT: "5",
  KOVA_SCHEDULED_DELIVERY_BATCH_LIMIT: "50",
  KOVA_SCHEDULED_DELIVERY_STALE_SECONDS: "300",
  KOVA_SCHEDULED_WORKER_MAX_STALE_SECONDS: "180",
  KOVA_SCHEDULED_WORKER_MAX_DELIVERY_BACKLOG: "100",
};

function healthyReadiness() {
  return {
    ready: true,
    status: "ready",
    heartbeatAgeSeconds: 0,
    sourceSha: validEnv.KOVA_SOURCE_SHA,
    workerRevision: validEnv.KOVA_WORKER_REVISION,
    dueTasks: 1,
    runningAttempts: 0,
    expiredAttempts: 0,
    readyDeliveries: 0,
    failedDeliveries: 0,
    disabledDeliveries: 0,
  };
}

function harness(options = {}) {
  const calls = [];
  const logs = [];
  const dependencies = {
    hostname: () => options.hostname ?? "worker-host",
    log(level, event, fields = {}) {
      logs.push({ level, event, fields });
      calls.push(`log:${event}`);
    },
    async recordHeartbeat(heartbeat) {
      calls.push(`heartbeat:${heartbeat.status}`);
      if (options.heartbeat) return options.heartbeat(heartbeat);
    },
    async runBatch(input) {
      calls.push("batch");
      if (options.batch) return options.batch(input);
      return {
        workerId: input.workerId,
        claimed: 3,
        complete: 2,
        failed: 1,
        canceled: 0,
        results: [],
      };
    },
    async runDeliveryBatch(input) {
      calls.push("delivery");
      if (options.delivery) return options.delivery(input);
      return {
        claimed: 2,
        sent: 2,
        failed: 0,
        disabled: 0,
        recovered: 0,
      };
    },
    async readReadiness(input) {
      calls.push("readiness");
      if (options.readiness) return options.readiness(input);
      return healthyReadiness();
    },
  };
  return { dependencies, calls, logs };
}

test("the worker is fail-closed unless explicitly enabled", async () => {
  const fixture = harness();
  await assert.rejects(
    runScheduledWorkerOnce(fixture.dependencies, {
      ...validEnv,
      KOVA_SCHEDULED_WORKER_ENABLED: "0",
    }),
    /scheduled_worker_disabled/u,
  );
  assert.deepEqual(fixture.calls, []);
});

for (const [name, patch, message] of [
  ["environment", { KOVA_SCHEDULED_WORKER_ENVIRONMENT: "" }, /environment_required/u],
  [
    "environment characters",
    { KOVA_SCHEDULED_WORKER_ENVIRONMENT: "Bad Env" },
    /environment_invalid/u,
  ],
  ["revision", { KOVA_WORKER_REVISION: "" }, /revision_required/u],
  ["source SHA", { KOVA_SOURCE_SHA: "short" }, /source_sha_invalid/u],
  ["batch zero", { KOVA_SCHEDULED_WORKER_BATCH_LIMIT: "0" }, /batch_limit_invalid/u],
  ["batch high", { KOVA_SCHEDULED_WORKER_BATCH_LIMIT: "26" }, /batch_limit_invalid/u],
  ["batch fractional", { KOVA_SCHEDULED_WORKER_BATCH_LIMIT: "1.5" }, /batch_limit_invalid/u],
  [
    "delivery batch zero",
    { KOVA_SCHEDULED_DELIVERY_BATCH_LIMIT: "0" },
    /scheduled_delivery_batch_limit_invalid/u,
  ],
  [
    "delivery stale interval",
    { KOVA_SCHEDULED_DELIVERY_STALE_SECONDS: "10" },
    /scheduled_delivery_stale_interval_invalid/u,
  ],
  [
    "readiness stale interval",
    { KOVA_SCHEDULED_WORKER_MAX_STALE_SECONDS: "10" },
    /scheduled_readiness_stale_interval_invalid/u,
  ],
  [
    "delivery backlog",
    { KOVA_SCHEDULED_WORKER_MAX_DELIVERY_BACKLOG: "10001" },
    /scheduled_delivery_backlog_limit_invalid/u,
  ],
]) {
  test(`invalid ${name} stops before heartbeat or batch execution`, async () => {
    const fixture = harness();
    await assert.rejects(
      runScheduledWorkerOnce(fixture.dependencies, { ...validEnv, ...patch }),
      message,
    );
    assert.deepEqual(fixture.calls, []);
  });
}

test("a healthy one-shot run executes, drains delivery, records health, then verifies readiness", async () => {
  const fixture = harness();
  const summary = await runScheduledWorkerOnce(fixture.dependencies, validEnv);
  assert.deepEqual(fixture.calls, [
    "log:scheduled_worker_started",
    "heartbeat:running",
    "batch",
    "delivery",
    "heartbeat:healthy",
    "readiness",
    "log:scheduled_worker_completed",
  ]);
  assert.equal(summary.claimed, 3);
  assert.equal(summary.complete, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.canceled, 0);
  assert.equal(summary.deliveryClaimed, 2);
  assert.equal(summary.deliverySent, 2);
  assert.equal(summary.deliveryFailed, 0);
  assert.equal(summary.deliveryDisabled, 0);
  assert.equal(summary.readinessStatus, "ready");
  assert.equal(summary.dueTasks, 1);
  assert.match(summary.workerId, /^staging-revision-1-worker-host$/u);
});

test("batch, delivery and readiness limits are forwarded exactly", async () => {
  let batchInput;
  let deliveryInput;
  let readinessInput;
  const fixture = harness({
    hostname: "host with spaces and / unsafe",
    batch(input) {
      batchInput = input;
      return {
        workerId: input.workerId,
        claimed: 0,
        complete: 0,
        failed: 0,
        canceled: 0,
        results: [],
      };
    },
    delivery(input) {
      deliveryInput = input;
      return { claimed: 0, sent: 0, failed: 0, disabled: 0, recovered: 0 };
    },
    readiness(input) {
      readinessInput = input;
      return healthyReadiness();
    },
  });
  await runScheduledWorkerOnce(fixture.dependencies, {
    ...validEnv,
    KOVA_SCHEDULED_WORKER_BATCH_LIMIT: "9",
    KOVA_SCHEDULED_DELIVERY_BATCH_LIMIT: "75",
    KOVA_SCHEDULED_DELIVERY_STALE_SECONDS: "420",
    KOVA_SCHEDULED_WORKER_MAX_STALE_SECONDS: "240",
    KOVA_SCHEDULED_WORKER_MAX_DELIVERY_BACKLOG: "250",
  });
  assert.equal(batchInput.limit, 9);
  assert.equal(batchInput.workerId, "staging-revision-1-host-with-spaces-and---unsafe");
  assert.deepEqual(deliveryInput, { limit: 75, staleSeconds: 420 });
  assert.deepEqual(readinessInput, {
    environment: "staging",
    maxStaleSeconds: 240,
    maxDeliveryBacklog: 250,
  });
});

test("batch failure records a failed heartbeat and preserves the original cause", async () => {
  const original = new Error("private fixture detail");
  const fixture = harness({
    batch() {
      throw original;
    },
  });
  await assert.rejects(runScheduledWorkerOnce(fixture.dependencies, validEnv), (error) => {
    assert.equal(error.message, "The scheduled worker could not complete its one-shot batch.");
    assert.equal(error.cause, original);
    return true;
  });
  assert.deepEqual(fixture.calls, [
    "log:scheduled_worker_started",
    "heartbeat:running",
    "batch",
    "heartbeat:failed",
    "log:scheduled_worker_failed",
  ]);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /private fixture detail/u);
});

test("delivery failure stops before a healthy heartbeat", async () => {
  const original = new Error("private delivery detail");
  const fixture = harness({
    delivery() {
      throw original;
    },
  });
  await assert.rejects(
    runScheduledWorkerOnce(fixture.dependencies, validEnv),
    (error) => error.cause === original,
  );
  assert.deepEqual(fixture.calls, [
    "log:scheduled_worker_started",
    "heartbeat:running",
    "batch",
    "delivery",
    "heartbeat:failed",
    "log:scheduled_worker_failed",
  ]);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /private delivery detail/u);
});

test("an unhealthy readiness snapshot flips the terminal heartbeat to failed", async () => {
  const fixture = harness({
    readiness() {
      return { ...healthyReadiness(), ready: false, status: "delivery_backlog" };
    },
  });
  await assert.rejects(runScheduledWorkerOnce(fixture.dependencies, validEnv), (error) => {
    assert.match(String(error.cause), /scheduled_worker_readiness_unhealthy/u);
    return true;
  });
  assert.deepEqual(fixture.calls, [
    "log:scheduled_worker_started",
    "heartbeat:running",
    "batch",
    "delivery",
    "heartbeat:healthy",
    "readiness",
    "heartbeat:failed",
    "log:scheduled_worker_failed",
  ]);
});

test("readiness must match the exact source SHA and worker revision", async () => {
  for (const patch of [{ sourceSha: "b".repeat(40) }, { workerRevision: "older-revision" }]) {
    const fixture = harness({
      readiness() {
        return { ...healthyReadiness(), ...patch };
      },
    });
    await assert.rejects(runScheduledWorkerOnce(fixture.dependencies, validEnv), (error) => {
      assert.match(String(error.cause), /scheduled_worker_readiness_unhealthy/u);
      return true;
    });
  }
});

test("a failed terminal heartbeat never hides the original batch failure", async () => {
  const original = new Error("private batch detail");
  const fixture = harness({
    batch() {
      throw original;
    },
    heartbeat(heartbeat) {
      if (heartbeat.status === "failed") throw new Error("private heartbeat detail");
    },
  });
  await assert.rejects(
    runScheduledWorkerOnce(fixture.dependencies, validEnv),
    (error) => error.cause === original,
  );
  assert.deepEqual(fixture.calls, [
    "log:scheduled_worker_started",
    "heartbeat:running",
    "batch",
    "heartbeat:failed",
    "log:scheduled_worker_failure_heartbeat_failed",
    "log:scheduled_worker_failed",
  ]);
  assert.doesNotMatch(
    JSON.stringify(fixture.logs),
    /private batch detail|private heartbeat detail/u,
  );
});

test("startup heartbeat failure prevents paid batch execution", async () => {
  const fixture = harness({
    heartbeat(heartbeat) {
      if (heartbeat.status === "running") throw new Error("fixture unavailable");
    },
  });
  await assert.rejects(
    runScheduledWorkerOnce(fixture.dependencies, validEnv),
    /fixture unavailable/u,
  );
  assert.deepEqual(fixture.calls, ["log:scheduled_worker_started", "heartbeat:running"]);
});
