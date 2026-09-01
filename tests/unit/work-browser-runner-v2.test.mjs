import assert from "node:assert/strict";
import test from "node:test";
import { runBrowserWorkOnce } from "../../browser-worker/src/runner.mjs";

const future = new Date(Date.now() + 10 * 60_000).toISOString();
const job = {
  job_id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  attempt_id: "33333333-3333-4333-8333-333333333333",
  attempt_number: 1,
  lease_token: "44444444-4444-4444-8444-444444444444",
  lease_expires_at: future,
  state_version: 1,
  input: {
    objective: "Prepare a report from the supplied evidence.",
    sourceUrls: ["https://example.com/report"],
  },
  tool_policy: { allowed_tools: ["browser.read"], max_pages: 1 },
  allowed_domains: ["example.com"],
  entitlement: "pro",
  token_budget: 12_000,
};

const environment = {
  KOVA_WORK_BROWSER_WORKER_ENABLED: "1",
  KOVA_WORK_BROWSER_ENVIRONMENT: "staging",
  KOVA_WORKER_REVISION: "revision-1",
  KOVA_SOURCE_SHA: "a".repeat(40),
  KOVA_WORK_BROWSER_CAPACITY: "1",
  KOVA_WORK_BROWSER_BATCH_LIMIT: "1",
  KOVA_WORK_BROWSER_LEASE_SECONDS: "300",
  KOVA_WORK_BROWSER_NAVIGATION_TIMEOUT_MS: "20000",
  KOVA_WORK_BROWSER_READINESS_STALE_SECONDS: "600",
};

function harness(options = {}) {
  const calls = [];
  const logs = [];
  const uploads = [];
  const toolResults = [];
  let claims = 0;
  const dependencies = {
    now: Date.now,
    hostname: () => "browser host / 1",
    log(level, event, fields = {}) {
      calls.push(`log:${event}`);
      logs.push({ level, event, fields });
    },
    async recordWorkerHeartbeat(value) {
      calls.push(`worker-heartbeat:${value.status}:${value.activeJobs}`);
      if (options.workerHeartbeat) return options.workerHeartbeat(value);
    },
    async recover() {
      calls.push("recover");
      if (options.recover) return options.recover();
    },
    async claim(input) {
      calls.push("claim");
      claims += 1;
      if (options.claim) return options.claim(input, claims);
      return claims === 1 ? job : null;
    },
    async heartbeatJob(value, leaseSeconds) {
      calls.push("job-heartbeat");
      assert.equal(value.job_id, job.job_id);
      assert.equal(leaseSeconds, 300);
      if (options.jobHeartbeat) return options.jobHeartbeat(value);
    },
    async capture(input) {
      calls.push("capture");
      if (options.capture) return options.capture(input);
      return {
        url: "https://example.com/report",
        hostname: "example.com",
        title: "Fixture report",
        text: "A bounded source capture with enough factual text to be useful for research synthesis.",
        screenshot: Buffer.from("png-fixture"),
        status: 200,
        contentType: "text/html; charset=utf-8",
        pinnedAddressFamily: 4,
      };
    },
    async upload(value) {
      calls.push(`upload:${value.contentType}`);
      uploads.push(value);
      if (options.upload) return options.upload(value);
    },
    async recordToolResult(_job, value) {
      calls.push(`tool:${value.status}`);
      toolResults.push(value);
      if (options.recordToolResult) return options.recordToolResult(value);
    },
    async synthesize(input) {
      calls.push("synthesize");
      if (options.synthesize) return options.synthesize(input);
      return {
        report: "# Research report\n\nSupported finding [1].",
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        providerRequestId: "fixture-request",
      };
    },
    async settleSuccess(_job, value) {
      calls.push("settle-success");
      if (options.settleSuccess) return options.settleSuccess(value);
      return { status: "complete" };
    },
    async settleFailure(_job, value) {
      calls.push("settle-failure");
      if (options.settleFailure) return options.settleFailure(value);
      return { status: "failed" };
    },
    async readReadiness(input) {
      calls.push("readiness");
      if (options.readReadiness) return options.readReadiness(input);
      return {
        healthy: true,
        sourceSha: input.sourceSha,
        expiredAttempts: 0,
        runtimeEnabled: true,
      };
    },
  };
  return { dependencies, calls, logs, uploads, toolResults };
}

test("the browser worker is fail-closed before any dependency call", async () => {
  const fixture = harness();
  await assert.rejects(
    runBrowserWorkOnce(fixture.dependencies, {
      ...environment,
      KOVA_WORK_BROWSER_WORKER_ENABLED: "0",
    }),
    /browser_work_worker_disabled/u,
  );
  assert.deepEqual(fixture.calls, []);
});

for (const [label, patch, pattern] of [
  ["environment", { KOVA_WORK_BROWSER_ENVIRONMENT: "" }, /environment_required/u],
  ["environment characters", { KOVA_WORK_BROWSER_ENVIRONMENT: "Bad Env" }, /environment_invalid/u],
  ["revision", { KOVA_WORKER_REVISION: "" }, /revision_required/u],
  ["SHA", { KOVA_SOURCE_SHA: "short" }, /source_sha_invalid/u],
  ["capacity", { KOVA_WORK_BROWSER_CAPACITY: "5" }, /capacity_invalid/u],
  ["batch", { KOVA_WORK_BROWSER_BATCH_LIMIT: "0" }, /batch_limit_invalid/u],
  ["lease", { KOVA_WORK_BROWSER_LEASE_SECONDS: "60" }, /lease_invalid/u],
  ["navigation timeout", { KOVA_WORK_BROWSER_NAVIGATION_TIMEOUT_MS: "1000" }, /timeout_invalid/u],
]) {
  test(`invalid ${label} stops before database, browser, or provider work`, async () => {
    const fixture = harness();
    await assert.rejects(
      runBrowserWorkOnce(fixture.dependencies, { ...environment, ...patch }),
      pattern,
    );
    assert.deepEqual(fixture.calls, []);
  });
}

test("a healthy run captures, stores, records, synthesizes, settles, and proves readiness", async () => {
  const fixture = harness();
  const summary = await runBrowserWorkOnce(fixture.dependencies, environment);
  assert.equal(summary.claimed, 1);
  assert.equal(summary.complete, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(fixture.calls, [
    "log:work_browser_worker_started",
    "worker-heartbeat:running:0",
    "recover",
    "claim",
    "worker-heartbeat:running:1",
    "job-heartbeat",
    "capture",
    "upload:application/json",
    "upload:image/png",
    "tool:succeeded",
    "job-heartbeat",
    "synthesize",
    "job-heartbeat",
    "upload:text/plain",
    "settle-success",
    "worker-heartbeat:running:0",
    "worker-heartbeat:healthy:0",
    "readiness",
    "log:work_browser_worker_completed",
  ]);
  assert.equal(fixture.uploads.length, 3);
  assert.equal(fixture.toolResults[0].evidence.length, 2);
  assert.match(fixture.uploads[2].path, /research-report-[a-f0-9]{20}\.md$/u);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /example\.com|supplied evidence/u);
});

test("a source failure is audited and completes as a bounded terminal failure without provider spend", async () => {
  const fixture = harness({
    capture() {
      throw new Error("private browser detail");
    },
  });
  const summary = await runBrowserWorkOnce(fixture.dependencies, environment);
  assert.equal(summary.claimed, 1);
  assert.equal(summary.complete, 0);
  assert.equal(summary.failed, 1);
  assert.equal(fixture.calls.includes("synthesize"), false);
  assert.equal(fixture.calls.includes("settle-success"), false);
  assert.equal(fixture.calls.includes("settle-failure"), true);
  assert.equal(fixture.toolResults[0].status, "failed");
  assert.equal(fixture.toolResults[0].safeError, "The source could not be read safely.");
});

test("an ambiguous completion settlement never becomes a contradictory failure", async () => {
  const original = new Error("private settlement response lost");
  const fixture = harness({
    settleSuccess() {
      throw original;
    },
  });
  await assert.rejects(
    runBrowserWorkOnce(fixture.dependencies, environment),
    (error) => error.cause === original,
  );
  assert.equal(fixture.calls.includes("settle-failure"), false);
  assert.ok(fixture.calls.includes("worker-heartbeat:failed:0"));
  assert.doesNotMatch(JSON.stringify(fixture.logs), /private settlement response lost/u);
});

test("readiness must bind to the exact source SHA and enabled browser runtime", async () => {
  const fixture = harness({
    readReadiness() {
      return {
        healthy: true,
        sourceSha: "b".repeat(40),
        expiredAttempts: 0,
        runtimeEnabled: true,
      };
    },
  });
  await assert.rejects(
    runBrowserWorkOnce(fixture.dependencies, environment),
    /browser research worker could not complete/u,
  );
  assert.ok(fixture.calls.includes("worker-heartbeat:failed:0"));
});
