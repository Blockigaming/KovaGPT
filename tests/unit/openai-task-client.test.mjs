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
  assert.deepEqual(availability, {
    configured: true,
    agent: true,
    browser: false,
    decisions: false,
    moderation: false,
  });
  assert.equal(calls[0].url, "/api/ai/services");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers["x-kova-service-owner"], "owner-one");
});

test("Decisions submits exactly one bounded predicate and renders its actual probability", async () => {
  const calls = [];
  const task = {
    ownerId: "owner-one",
    operation: "decisions",
    input: "  The parcel arrived with a cracked screen.  ",
    question: "  Does the customer report a damaged item?  ",
    requestId: "task_12345678",
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      operation: "decisions",
      answers: [{ name: "question", type: "predicate", probability: 0.982 }],
    });
  };
  const result = await submitOpenAiTask(task, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    operation: "decisions",
    input: "The parcel arrived with a cracked screen.",
    questions: [
      {
        name: "question",
        type: "predicate",
        instructions: "Does the customer report a damaged item?",
      },
    ],
  });
  assert.equal(calls[0].init.headers["x-kova-service-owner"], "owner-one");
  assert.equal(calls[0].init.headers["idempotency-key"], "task_12345678");
  assert.match(result.text, /98\.2%/);
  for (const question of ["", " ", "x".repeat(1001)])
    await assert.rejects(
      submitOpenAiTask({ ...task, question }, { fetchImpl }),
      /yes\/no question/,
    );
  assert.equal(calls.length, 1, "invalid questions never dispatch");
});

test("Decisions refuses mismatched and invalid answers and displays a real refusal", async () => {
  const task = {
    ownerId: "owner-one",
    operation: "decisions",
    input: "A parcel.",
    question: "Is the parcel damaged?",
    requestId: "task_12345678",
  };
  for (const answers of [
    [],
    [{ name: "other", type: "predicate", probability: 0.9 }],
    [{ name: "question", type: "predicate", probability: 1.1 }],
    [{ name: "question", type: "predicate", probability: "0.9" }],
    [{ name: "question", type: "choice", choice: "yes" }],
  ])
    await assert.rejects(
      submitOpenAiTask(task, {
        fetchImpl: async () => Response.json({ operation: "decisions", answers }),
      }),
      /unreadable response/,
    );
  const refusal = await submitOpenAiTask(task, {
    fetchImpl: async () =>
      Response.json({ operation: "decisions", answers: [{ name: "question", type: "refusal" }] }),
  });
  assert.match(refusal.text, /declined/);
});

test("moderation renders actual flags and categories without labelling unflagged content safe", async () => {
  const task = {
    ownerId: "owner-one",
    operation: "moderation",
    input: "Check this text.",
    requestId: "task_12345678",
  };
  const calls = [];
  for (const [flagged, categories, expected] of [
    [true, { violence: true, hate: false }, /Flagged categories: violence/],
    [false, { violence: false, hate: false }, /No categories flagged/],
  ]) {
    const result = await submitOpenAiTask(task, {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json({ operation: "moderation", results: [{ flagged, categories }] });
      },
    });
    assert.match(result.text, expected);
    assert.doesNotMatch(result.text, /\bsafe\b/i);
    assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
      operation: "moderation",
      input: "Check this text.",
    });
  }
  for (const result of [
    { flagged: false },
    { flagged: "false", categories: { violence: false } },
    { flagged: false, categories: { violence: "false" } },
    { flagged: false, categories: { violence: true } },
    { flagged: true, categories: { violence: false } },
  ])
    await assert.rejects(
      submitOpenAiTask(task, {
        fetchImpl: async () => Response.json({ operation: "moderation", results: [result] }),
      }),
      /unreadable response/,
    );
  await assert.rejects(
    submitOpenAiTask(
      { ...task, question: "Injected question" },
      {
        fetchImpl: async () => {
          throw Error("must not dispatch");
        },
      },
    ),
    /does not accept/,
  );
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
