import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/workers/work-v2-runner.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("exports", "process", compiled)(exports, { env: {} });
const { runWorkWorkerOnce } = exports;

const validEnv = {
  KOVA_WORK_WORKER_ENABLED: "1",
  KOVA_WORK_WORKER_ENVIRONMENT: "staging",
  KOVA_WORKER_REVISION: "revision-1",
  KOVA_SOURCE_SHA: "a".repeat(40),
  KOVA_WORK_WORKER_CAPACITY: "1",
  KOVA_WORK_WORKER_BATCH_LIMIT: "3",
  KOVA_WORK_WORKER_LEASE_SECONDS: "180",
  KOVA_WORK_WORKER_HEARTBEAT_MS: "30000",
  KOVA_WORK_WORKER_READINESS_STALE_SECONDS: "300",
};

function harness(options = {}) {
  const calls = [];
  const logs = [];
  const dependencies = {
    hostname: () => options.hostname ?? "work-host",
    validateProviderBoundary() {
      calls.push("validate-provider");
      if (options.providerBoundary) return options.providerBoundary();
    },
    log(level, event, fields = {}) {
      calls.push(`log:${event}`);
      logs.push({ level, event, fields });
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
        claimed: 2,
        complete: 1,
        failed: 1,
        paused: 0,
        cancelled: 0,
        results: [],
      };
    },
    async readReadiness(input) {
      calls.push("readiness");
      if (options.readiness) return options.readiness(input);
      return {
        healthy: true,
        workerStatus: "healthy",
        workerRevision: validEnv.KOVA_WORKER_REVISION,
        sourceSha: validEnv.KOVA_SOURCE_SHA,
        heartbeatAgeSeconds: 0,
        activeJobs: 0,
        capacity: 1,
        dueJobs: 0,
        expiredAttempts: 0,
        runtimeEnabled: true,
      };
    },
  };
  return { dependencies, calls, logs };
}

test("the Work worker is fail-closed unless explicitly enabled", async () => {
  const fixture = harness();
  await assert.rejects(
    runWorkWorkerOnce(fixture.dependencies, {
      ...validEnv,
      KOVA_WORK_WORKER_ENABLED: "0",
    }),
    /work_worker_disabled/u,
  );
  assert.deepEqual(fixture.calls, []);
});

for (const [name, patch, message] of [
  ["environment", { KOVA_WORK_WORKER_ENVIRONMENT: "" }, /environment_required/u],
  ["environment characters", { KOVA_WORK_WORKER_ENVIRONMENT: "Bad Env" }, /environment_invalid/u],
  ["revision", { KOVA_WORKER_REVISION: "" }, /revision_required/u],
  ["source SHA", { KOVA_SOURCE_SHA: "short" }, /source_sha_invalid/u],
  ["capacity", { KOVA_WORK_WORKER_CAPACITY: "0" }, /capacity_invalid/u],
  ["batch", { KOVA_WORK_WORKER_BATCH_LIMIT: "26" }, /batch_limit_invalid/u],
  ["lease", { KOVA_WORK_WORKER_LEASE_SECONDS: "59" }, /lease_seconds_invalid/u],
  ["heartbeat", { KOVA_WORK_WORKER_HEARTBEAT_MS: "90000" }, /heartbeat_interval_invalid/u],
  [
    "readiness stale",
    { KOVA_WORK_WORKER_READINESS_STALE_SECONDS: "29" },
    /readiness_stale_invalid/u,
  ],
]) {
  test(`invalid ${name} stops before provider validation or database work`, async () => {
    const fixture = harness();
    await assert.rejects(
      runWorkWorkerOnce(fixture.dependencies, { ...validEnv, ...patch }),
      message,
    );
    assert.deepEqual(fixture.calls, []);
  });
}

test("managed-identity validation happens before heartbeat and paid batch execution", async () => {
  const original = new Error("fixture boundary failure");
  const fixture = harness({
    providerBoundary() {
      throw original;
    },
  });
  await assert.rejects(runWorkWorkerOnce(fixture.dependencies, validEnv), original);
  assert.deepEqual(fixture.calls, ["validate-provider"]);
});

test("healthy one-shot Work records lifecycle heartbeats and exact-SHA readiness", async () => {
  const fixture = harness();
  const summary = await runWorkWorkerOnce(fixture.dependencies, validEnv);
  assert.deepEqual(fixture.calls, [
    "validate-provider",
    "log:work_worker_started",
    "heartbeat:running",
    "batch",
    "heartbeat:healthy",
    "readiness",
    "log:work_worker_completed",
  ]);
  assert.equal(summary.claimed, 2);
  assert.equal(summary.complete, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.sourceSha, validEnv.KOVA_SOURCE_SHA);
  assert.equal(summary.readiness.runtimeEnabled, true);
});

test("bounded execution settings and sanitized worker identity are forwarded exactly", async () => {
  let received;
  const fixture = harness({
    hostname: "host with spaces / unsafe",
    batch(input) {
      received = input;
      return {
        workerId: input.workerId,
        claimed: 0,
        complete: 0,
        failed: 0,
        paused: 0,
        cancelled: 0,
        results: [],
      };
    },
  });
  await runWorkWorkerOnce(fixture.dependencies, {
    ...validEnv,
    KOVA_WORK_WORKER_CAPACITY: "3",
    KOVA_WORK_WORKER_BATCH_LIMIT: "9",
    KOVA_WORK_WORKER_LEASE_SECONDS: "240",
    KOVA_WORK_WORKER_HEARTBEAT_MS: "20000",
  });
  assert.equal(received.capacity, 3);
  assert.equal(received.limit, 9);
  assert.equal(received.leaseSeconds, 240);
  assert.equal(received.heartbeatIntervalMs, 20000);
  assert.equal(received.workerId, "staging-revision-1-host-with-spaces---unsafe");
});

for (const [name, patch] of [
  ["unhealthy", { healthy: false }],
  ["wrong SHA", { sourceSha: "b".repeat(40) }],
  ["wrong revision", { workerRevision: "other" }],
  ["expired attempts", { expiredAttempts: 1 }],
  ["disabled runtime", { runtimeEnabled: false }],
]) {
  test(`${name} readiness changes the terminal heartbeat to failed`, async () => {
    const fixture = harness({
      readiness() {
        return {
          healthy: true,
          workerStatus: "healthy",
          workerRevision: validEnv.KOVA_WORKER_REVISION,
          sourceSha: validEnv.KOVA_SOURCE_SHA,
          heartbeatAgeSeconds: 0,
          activeJobs: 0,
          capacity: 1,
          dueJobs: 0,
          expiredAttempts: 0,
          runtimeEnabled: true,
          ...patch,
        };
      },
    });
    await assert.rejects(runWorkWorkerOnce(fixture.dependencies, validEnv), /one-shot batch/u);
    assert.deepEqual(fixture.calls.slice(-2), ["heartbeat:failed", "log:work_worker_failed"]);
  });
}

test("batch failure records a bounded failed heartbeat and preserves the original cause", async () => {
  const original = new Error("private batch detail");
  const fixture = harness({
    batch() {
      throw original;
    },
  });
  await assert.rejects(runWorkWorkerOnce(fixture.dependencies, validEnv), (error) => {
    assert.equal(error.message, "The Work worker could not complete its one-shot batch.");
    assert.equal(error.cause, original);
    return true;
  });
  assert.equal(fixture.calls.includes("readiness"), false);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /private batch detail/u);
});

test("failed terminal heartbeat never hides the original Work failure", async () => {
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
    runWorkWorkerOnce(fixture.dependencies, validEnv),
    (error) => error.cause === original,
  );
  assert.equal(fixture.calls.includes("log:work_worker_failure_heartbeat_failed"), true);
  assert.doesNotMatch(
    JSON.stringify(fixture.logs),
    /private batch detail|private heartbeat detail/u,
  );
});

test("startup heartbeat failure prevents batch execution", async () => {
  const fixture = harness({
    heartbeat(heartbeat) {
      if (heartbeat.status === "running") throw new Error("fixture unavailable");
    },
  });
  await assert.rejects(runWorkWorkerOnce(fixture.dependencies, validEnv), /fixture unavailable/u);
  assert.deepEqual(fixture.calls, [
    "validate-provider",
    "log:work_worker_started",
    "heartbeat:running",
  ]);
});
