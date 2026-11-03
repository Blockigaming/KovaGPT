import assert from "node:assert/strict";
import test from "node:test";
import { invokeScheduledExecution } from "../../scripts/scheduled-tasks/production-worker.mjs";

const secret = "x".repeat(40);
const endpoint = "https://kovagpt.com/api/internal/scheduled-execution";
const env = { SCHEDULED_TASK_SECRET: secret, KOVA_SCHEDULED_TASK_ENDPOINT: endpoint };
const response = (receipt, status = 200) =>
  new Response(JSON.stringify(receipt), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("one-shot worker sends only authenticated bounded batch request", async () => {
  let calls = 0;
  const result = await invokeScheduledExecution({
    env,
    request: async (url, options) => {
      calls++;
      assert.equal(url, endpoint);
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, `Bearer ${secret}`);
      assert.equal(options.body, "{}");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      return response({ ok: true, claimed: 1, complete: 1, failed: 0 });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { claimed: 1, complete: 1, failed: 0 });
});

test("missing secret, wrong host, wrong scheme and altered path fail before network", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    throw new Error("should not call network");
  };
  for (const unsafe of [
    { ...env, SCHEDULED_TASK_SECRET: "" },
    { ...env, KOVA_SCHEDULED_TASK_ENDPOINT: "https://example.com/api/internal/scheduled-execution" },
    { ...env, KOVA_SCHEDULED_TASK_ENDPOINT: "http://kovagpt.com/api/internal/scheduled-execution" },
    { ...env, KOVA_SCHEDULED_TASK_ENDPOINT: "https://kovagpt.com/api/chat" },
    { ...env, KOVA_SCHEDULED_TASK_ENDPOINT: "https://kovagpt.com/api/internal/scheduled-execution?token=x" },
  ]) {
    await assert.rejects(invokeScheduledExecution({ env: unsafe, request }), /task_worker_/);
  }
  assert.equal(calls, 0);
});

test("unauthorized, upstream failures and invalid success receipts fail closed", async () => {
  for (const reply of [
    response({ ok: false, claimed: 0, complete: 0, failed: 0 }),
    response({ ok: true, claimed: 3, complete: 3, failed: 0 }),
    response({ ok: true, claimed: 1, complete: 2, failed: 0 }),
    response({ ok: true, claimed: 1, complete: 0, failed: -1 }),
    response({ error: "unauthorized" }, 401),
    response({ error: "not ready" }, 503),
  ]) {
    await assert.rejects(
      invokeScheduledExecution({ env, request: async () => reply }),
      /task_worker_/,
    );
  }
});
