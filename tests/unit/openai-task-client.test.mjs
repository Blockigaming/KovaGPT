import test from "node:test";
import assert from "node:assert/strict";
import { loadOpenAiTaskAvailability, submitOpenAiTask } from "../../src/lib/openai-task-client.mjs";

test("task availability uses the same-origin owner-bound route and never probes provider directly", async () => {
  const calls = [];
  const availability = await loadOpenAiTaskAvailability("owner-one", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        configured: true,
        operations: [
          { operation: "agent", available: true },
          { operation: "browser", available: false },
        ],
      });
    },
  });
  assert.deepEqual(availability, { configured: true, agent: true, browser: false });
  assert.equal(calls[0].url, "/api/ai/services");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers["x-kova-service-owner"], "owner-one");
});

test("submitted task binds owner and unique request identifier without retries", async () => {
  const calls = [];
  const result = await submitOpenAiTask(
    {
      ownerId: "owner-one",
      operation: "browser",
      input: "  Read a public page  ",
      requestId: "task_12345678",
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json({ operation: "browser", text: "Done", toolCalls: 2 });
      },
    },
  );
  assert.deepEqual(result, { text: "Done", toolCalls: 2 });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    operation: "browser",
    input: "Read a public page",
  });
  assert.equal(calls[0].init.headers["idempotency-key"], "task_12345678");
  assert.equal(calls[0].init.headers["x-kova-service-owner"], "owner-one");
  assert.equal(calls[0].init.credentials, "same-origin");
});

test("plan denial is explicit, and malformed provider results are withheld", async () => {
  const task = {
    ownerId: "owner-one",
    operation: "agent",
    input: "Count",
    requestId: "task_12345678",
  };
  await assert.rejects(
    submitOpenAiTask(task, {
      fetchImpl: async () => Response.json({ error: "subscription_required" }, { status: 403 }),
    }),
    /Kova Plus or Pro/,
  );
  await assert.rejects(
    submitOpenAiTask(task, {
      fetchImpl: async () => Response.json({ operation: "browser", text: "wrong" }),
    }),
    /unreadable response/,
  );
});
