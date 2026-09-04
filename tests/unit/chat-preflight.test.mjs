import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatPreflightError,
  createChatPreflightRunner,
} from "../../src/lib/chat-preflight.server.mjs";

test("required preflight stages reject a never-settling dependency within their bound", async () => {
  const milestones = [];
  const runner = createChatPreflightRunner({
    requiredTimeoutMs: 20,
    totalTimeoutMs: 200,
    onMilestone: (event) => milestones.push(event),
  });
  const startedAt = Date.now();
  try {
    await assert.rejects(
      runner.run("accounting", () => new Promise(() => {})),
      (error) => {
        assert.ok(error instanceof ChatPreflightError);
        assert.equal(error.code, "chat_preflight_timeout");
        assert.equal(error.status, 504);
        assert.equal(error.retryable, true);
        assert.equal(error.stage, "accounting");
        return true;
      },
    );
  } finally {
    runner.close();
  }

  assert.ok(Date.now() - startedAt < 1_000);
  assert.deepEqual(
    milestones.map(({ stage, state, required }) => ({ stage, state, required })),
    [
      { stage: "accounting", state: "started", required: true },
      { stage: "accounting", state: "timed_out", required: true },
    ],
  );
});

test("optional preflight failures fail open and still publish a failure milestone", async () => {
  const milestones = [];
  const runner = createChatPreflightRunner({
    onMilestone: (event) => milestones.push(event),
  });
  try {
    const result = await runner.run(
      "memory",
      () => Promise.reject(new Error("database unavailable")),
      { required: false },
    );
    assert.equal(result, undefined);
  } finally {
    runner.close();
  }
  assert.equal(milestones.at(-1)?.state, "failed");
  assert.equal(milestones.at(-1)?.required, false);
});

test("required failures preserve explicit status, code, and retryability", async () => {
  const runner = createChatPreflightRunner();
  const source = Object.assign(new Error("rate limited"), {
    code: "quota_backend_busy",
    status: 429,
    retryable: false,
  });
  try {
    await assert.rejects(
      runner.run("quota", () => Promise.reject(source)),
      (error) => {
        assert.ok(error instanceof ChatPreflightError);
        assert.equal(error.code, "quota_backend_busy");
        assert.equal(error.status, 429);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    runner.close();
  }
});

test("required failures default retryability from their normalized status", async () => {
  const runner = createChatPreflightRunner();
  try {
    await assert.rejects(
      runner.run("authorization", () => Promise.reject(new Error("offline"))),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    runner.close();
  }
});

test("caller abort terminates a never-settling stage without waiting for its timeout", async () => {
  const controller = new AbortController();
  const runner = createChatPreflightRunner({
    signal: controller.signal,
    requiredTimeoutMs: 5_000,
    totalTimeoutMs: 10_000,
  });
  const pending = runner.run("session", () => new Promise(() => {}));
  controller.abort();
  try {
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, "chat_request_aborted");
      assert.equal(error.status, 499);
      assert.equal(error.retryable, false);
      return true;
    });
  } finally {
    runner.close();
  }
});

test("a runner whose total deadline elapsed rejects later work before it starts", async () => {
  const runner = createChatPreflightRunner({
    optionalTimeoutMs: 5_000,
    totalTimeoutMs: 20,
  });
  try {
    await assert.rejects(
      runner.run("memory", () => new Promise(() => {}), { required: false }),
      (error) => error?.code === "chat_preflight_timeout",
    );

    let started = false;
    await assert.rejects(
      runner.run("connector_tools", () => {
        started = true;
        return new Promise(() => {});
      }),
      (error) => error?.code === "chat_preflight_timeout",
    );
    assert.equal(started, false);
  } finally {
    runner.close();
  }
});

test("a pre-aborted request never starts preflight work", async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  const runner = createChatPreflightRunner({ signal: controller.signal });
  try {
    await assert.rejects(
      runner.run("session", () => {
        started = true;
      }),
      (error) => error?.code === "chat_request_aborted",
    );
  } finally {
    runner.close();
  }
  assert.equal(started, false);
});
