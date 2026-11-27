import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBatchBudget,
  batchBudgetTicks,
  batchChargeTicks,
  developerBatchCapability,
  developerBatchRequestKey,
  developerResponseJobView,
  parseDeveloperBatchRequest,
} from "../../src/lib/pricing/developer-batch-policy.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const item = "22222222-2222-4222-8222-222222222222";
const request = {
  operation: "create",
  id,
  currency: "USD",
  maximum_charge: 1,
  items: [
    {
      id: item,
      input: {
        model: "kova-fast",
        messages: [{ role: "user", content: "Summarize text." }],
        max_completion_tokens: 100,
      },
      quote_token: "payload." + "a".repeat(64),
    },
  ],
};
const parse = (method, query = "", body) =>
  parseDeveloperBatchRequest(method, new URLSearchParams(query), body);
test("batch submission requires stable IDs, a quote per item and bounded text-only input", () => {
  const parsed = parse("POST", "", request);
  assert.equal(parsed.input.maximum_ticks, 100000000);
  assert.equal(parsed.input.items[0].input.stream, false);
  assert.equal(developerBatchRequestKey(id, item), "batch:" + id + ":" + item);
  for (const patch of [
    { items: [] },
    { items: [request.items[0], request.items[0]] },
    { items: [{ ...request.items[0], quote_token: "" }] },
    { items: [{ ...request.items[0], input: { ...request.items[0].input, stream: true } }] },
    { items: [{ ...request.items[0], input: { ...request.items[0].input, tools: [] } }] },
    {
      items: [
        { ...request.items[0], input: { ...request.items[0].input, max_completion_tokens: 2049 } },
      ],
    },
    { owner_id: id },
  ])
    assert.throws(() => parse("POST", "", { ...request, ...patch }), /batch_invalid/);
});
test("batch budget compares summed conservative integer ticks", () => {
  assert.equal(batchBudgetTicks(0.3), 30000000);
  assert.equal(batchChargeTicks(0.123456781), 12345679);
  assertBatchBudget(30000000, [10000000, 20000000]);
  assert.throws(() => assertBatchBudget(30000000, [10000000, 20000001]), /batch_budget_invalid/);
  assert.throws(() => batchBudgetTicks(0.000000001), /batch_invalid/);
  for (const value of [0, -1, Infinity, NaN, "1"])
    assert.throws(() => batchChargeTicks(value), /batch_invalid/);
});
test("list, individual output and cancellation reject ambiguous paths", () => {
  assert.equal(parse("GET").operation, "list");
  assert.equal(parse("GET", "id=" + id).operation, "get");
  assert.equal(parse("GET", "id=" + id + "&item_id=" + item).operation, "get_item");
  assert.equal(parse("POST", "", { operation: "cancel", id }).operation, "cancel");
  assert.throws(() => parse("GET", "item_id=" + item), /batch_invalid/);
  assert.throws(() => parse("GET", "id=" + id + "&id=" + item), /batch_invalid/);
  assert.throws(() => parse("DELETE", "id=" + id), /batch_invalid/);
});

test("scheduled automation requires ordered future UTC invocations and explicit controls", () => {
  const now = Date.parse("2026-11-26T00:00:00.000Z");
  const scheduled = {
    ...request,
    items: [{ ...request.items[0], run_at: "2026-11-26T01:00:00.000Z" }],
  };
  const automation = (body) =>
    parseDeveloperBatchRequest("POST", new URLSearchParams(), body, "automation", now);
  assert.equal(automation(scheduled).input.items[0].run_at, scheduled.items[0].run_at);
  assert.equal(automation({ operation: "pause", id }).operation, "pause");
  assert.equal(automation({ operation: "resume", id }).operation, "resume");
  assert.throws(() => parse("POST", "", scheduled), /batch_invalid/);
  assert.throws(() => automation(request), /batch_invalid/);
  for (const run_at of [
    "2026-11-26T00:00:00.000Z",
    "2026-11-27T00:00:00.000Z",
    "2026-11-26T01:00:00+00:00",
    "invalid",
  ])
    assert.throws(
      () => automation({ ...scheduled, items: [{ ...scheduled.items[0], run_at }] }),
      /batch_invalid/,
    );
  assert.throws(
    () =>
      automation({
        ...scheduled,
        items: [
          scheduled.items[0],
          { ...scheduled.items[0], id, run_at: "2026-11-26T00:30:00.000Z" },
        ],
      }),
    /batch_invalid/,
  );
  assert.throws(() => parse("POST", "", { operation: "pause", id }), /batch_invalid/);
});

test("mixed agent batches preserve explicit operation, definition and skill versions", () => {
  const second = "33333333-3333-4333-8333-333333333333";
  const invocation = {
    id: second,
    operation: "agent-turns",
    input: {
      agent_id: id,
      version: 2,
      input: "Review evidence.",
      skills: [{ id: item, version: 1 }],
    },
    quote_token: request.items[0].quote_token,
  };
  const result = parse("POST", "", { ...request, items: [request.items[0], invocation] });
  assert.equal(result.input.items[0].operation, "chat/completions");
  assert.deepEqual(result.input.items[1], invocation);
  assert.throws(
    () => parse("POST", "", { ...request, items: [{ ...invocation, operation: "images" }] }),
    /batch_invalid/,
  );
  assert.throws(
    () =>
      parse("POST", "", {
        ...request,
        items: [{ ...invocation, input: { ...invocation.input, version: 0 } }],
      }),
    /agent_invalid/,
  );
});

test("batch items accept bounded Responses, moderation, embeddings and decisions", () => {
  const direct = [
    ["responses", { model: "kova-fast", input: "Hello", max_output_tokens: 20 }, "chat"],
    ["moderations", { model: "kova-moderation", input: "Hello" }, "moderation"],
    ["embeddings", { model: "kova-embedding", input: ["A", "B"], dimensions: 128 }, "embeddings"],
    [
      "decisions",
      {
        model: "kova-decisions",
        input: "The result is positive.",
        questions: [{ type: "predicate", name: "positive", instructions: "Is it positive?" }],
      },
      "decisions",
    ],
  ];
  for (const [operation, input, capability] of direct) {
    const invocation = { ...request.items[0], operation, input };
    const result = parse("POST", "", { ...request, items: [invocation] });
    assert.equal(developerBatchCapability(operation), capability);
    assert.deepEqual(result.input.items[0], invocation);
  }
  for (const operation of ["browser", "images", "constructor", "__proto__"])
    assert.throws(() => developerBatchCapability(operation), /batch_invalid/);
});

test("batch direct operations reject streaming, hosted tools and unbounded vector outputs", () => {
  const response = { model: "kova-fast", input: "Hello", max_output_tokens: 20 };
  const vector = { model: "kova-embedding", input: "A", dimensions: 128 };
  const submit = (operation, input) =>
    parse("POST", "", {
      ...request,
      items: [{ ...request.items[0], operation, input }],
    });
  for (const patch of [
    { stream: true },
    { max_output_tokens: 2049 },
    { file_ids: [id] },
    { tools: [] },
    { input: [{ role: "user", content: "Hello" }] },
  ])
    assert.throws(() => submit("responses", { ...response, ...patch }), /batch_invalid/);
  for (const patch of [{ dimensions: 1025 }, { dimensions: undefined }, { input: ["A", "B", "C"] }])
    assert.throws(() => submit("embeddings", { ...vector, ...patch }), /batch_invalid/);
  assert.throws(
    () => submit("moderations", { model: "kova-moderation", input: "A", project_id: id }),
    /batch_invalid/,
  );
});

test("background Responses accept one explicitly authorized text invocation", () => {
  const input = { model: "kova-fast", input: "Hello", max_output_tokens: 20 };
  const body = {
    operation: "create",
    id,
    currency: "USD",
    maximum_charge: 1,
    input,
    quote_token: request.items[0].quote_token,
  };
  const job = (method, query, value) =>
    parseDeveloperBatchRequest(method, new URLSearchParams(query), value, "response");
  const parsed = job("POST", "", body);
  assert.deepEqual(parsed.input.items, [
    { id, operation: "responses", input, quote_token: body.quote_token },
  ]);
  assert.equal(job("GET", "id=" + id).operation, "get");
  assert.equal(job("POST", "", { operation: "cancel", id }).operation, "cancel");
  assert.throws(() => job("GET", "id=" + id + "&item_id=" + item), /batch_invalid/);
  assert.throws(() => job("POST", "", request), /batch_invalid/);
  assert.throws(
    () => job("POST", "", { ...body, input: { ...input, stream: true } }),
    /batch_invalid/,
  );
  assert.throws(() => job("POST", "", { operation: "resume", id }), /batch_invalid/);
});

test("response job results never return unverified output, inputs or execution credentials", () => {
  const value = {
    id,
    batch_id: id,
    operation_kind: "responses",
    state: "completed",
    settlement_state: "settled",
    output: { text: "hello" },
    input: { secret: "private" },
    authorization: "hidden",
    lease_token: "hidden",
  };
  const result = developerResponseJobView(value, id);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, value.output);
  assert.equal(Object.hasOwn(result, "input"), false);
  assert.equal(Object.hasOwn(result, "authorization"), false);
  assert.equal(developerResponseJobView({ ...value, state: "uncertain" }, id).output, null);
  assert.throws(() => developerResponseJobView({ ...value, settlement_state: "uncertain" }, id));
  assert.throws(() => developerResponseJobView({ ...value, batch_id: item }, id));
});

test("replay lookup accepts an elapsed schedule but new submissions still reject it", () => {
  const now = Date.parse("2026-11-26T00:00:00.000Z");
  const body = {
    ...request,
    items: [{ ...request.items[0], run_at: "2026-11-26T01:00:00.000Z" }],
  };
  const params = new URLSearchParams();
  const original = parseDeveloperBatchRequest("POST", params, body, "automation", now);
  const later = now + 7200000;
  assert.throws(
    () => parseDeveloperBatchRequest("POST", params, body, "automation", later),
    /batch_invalid/,
  );
  assert.deepEqual(
    parseDeveloperBatchRequest("POST", params, body, "automation", later, true),
    original,
  );
  assert.throws(
    () =>
      parseDeveloperBatchRequest(
        "POST",
        params,
        { ...body, items: [{ ...body.items[0], run_at: "invalid" }] },
        "automation",
        later,
        true,
      ),
    /batch_invalid/,
  );
});
