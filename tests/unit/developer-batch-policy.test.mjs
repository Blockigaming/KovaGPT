import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBatchBudget,
  batchBudgetTicks,
  batchChargeTicks,
  developerBatchCapability,
  developerBatchRequestKey,
  developerResponseJobView,
  developerResearchRunView,
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
    { input: Array(17).fill({ role: "user", content: "Hello" }) },
    {
      input: [
        {
          role: "user",
          content: [{ type: "input_image", image_url: "https://invalid.example/image.png" }],
        },
      ],
    },
    { tools: [{ type: "web_search", search_context_size: "low" }] },
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

test("scheduled and batch jobs accept bounded search and isolated analysis, not arbitrary tools", () => {
  const cases = [
    ["search", { model: "kova-fast", query: "Example", max_output_tokens: 128, max_tool_calls: 2 }],
    ["analysis", { model: "kova-fast", input: "Calculate 2+2", max_output_tokens: 128 }],
  ];
  for (const [operation, input] of cases) {
    const body = { ...request, items: [{ ...request.items[0], operation, input }] };
    assert.equal(parse("POST", "", body).input.items[0].operation, operation);
    assert.throws(() =>
      parse("POST", "", {
        ...body,
        items: [{ ...body.items[0], input: { ...input, max_output_tokens: 2049 } }],
      }),
    );
    assert.throws(() =>
      parse("POST", "", { ...body, items: [{ ...body.items[0], input: { ...input, tools: [] } }] }),
    );
  }
});

test("background Responses preserve strict schemas and client-owned function rounds", () => {
  const schema = {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  };
  const input = {
    model: "kova-fast",
    input: [
      { role: "user", content: "Summarize" },
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "Example" },
    ],
    max_output_tokens: 100,
    tools: [{ type: "function", name: "lookup", parameters: schema, strict: true }],
    text: { format: { type: "json_schema", name: "answer", strict: true, schema } },
  };
  const body = {
    operation: "create",
    id,
    currency: "USD",
    maximum_charge: 1,
    input,
    quote_token: request.items[0].quote_token,
  };
  const parseJob = (input) =>
    parseDeveloperBatchRequest("POST", new URLSearchParams(), { ...body, input }, "response");
  assert.deepEqual(parseJob(input).input.items[0].input, input);
  for (const patch of [
    { tools: [{ ...input.tools[0], strict: false }] },
    { input: [input.input[2]] },
    { tools: Array(5).fill(input.tools[0]) },
    { conversation: { id, revision: 1 } },
  ])
    assert.throws(() => parseJob({ ...input, ...patch }));
});

test("research requires two to four exact separately authorized search inputs", () => {
  const search = {
    id: item,
    operation: "search",
    quote_token: request.items[0].quote_token,
    input: { model: "kova-fast", query: "Evidence", max_output_tokens: 256, max_tool_calls: 1 },
  };
  const items = [search, { ...search, id }];
  const parse = (body) =>
    parseDeveloperBatchRequest("POST", new URLSearchParams(), body, "research");
  assert.equal(parse({ ...request, items }).input.items.length, 2);
  for (const bad of [
    [search],
    [...items, ...items, search],
    [search, request.items[0]],
    [search, search],
  ])
    assert.throws(() => parse({ ...request, items: bad }), /batch_invalid/);
  assert.throws(
    () =>
      parseDeveloperBatchRequest(
        "GET",
        new URLSearchParams({ id, item_id: item }),
        undefined,
        "research",
      ),
    /batch_invalid/,
  );
});

test("research exposes only settled findings, real URL annotations and accurate partial states", () => {
  const output = {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Finding",
            annotations: [
              { type: "url_citation", url: "https://example.com/report", title: "Report" },
              { type: "url_citation", url: "https://example.com/report", title: "Duplicate" },
              { type: "url_citation", url: "javascript:alert(1)" },
              { type: "url_citation", url: "https://secret@example.com/" },
              { type: "other", url: "https://not-evidence.example/" },
            ],
          },
        ],
      },
    ],
  };
  const completed = {
    id: item,
    query: "Evidence",
    operation_kind: "search",
    state: "completed",
    settlement_state: "settled",
    output,
    authorization: "secret",
  };
  const queued = { ...completed, id, state: "queued", settlement_state: null };
  const view = (items) => developerResearchRunView({ id, resource_kind: "research", items }, id);
  const running = view([completed, queued]);
  assert.equal(running.status, "running");
  assert.equal(running.items[0].text, "Finding");
  assert.deepEqual(running.items[0].citations, [
    { url: "https://example.com/report", title: "Report" },
  ]);
  assert.equal(running.items[0].authorization, undefined);
  assert.equal(running.items[1].text, null);
  assert.deepEqual(running.items[1].citations, []);
  assert.equal(view([completed, { ...queued, state: "canceled" }]).status, "partial");
  assert.equal(view([completed, { ...completed, id }]).status, "completed");
  assert.equal(
    view([
      { ...completed, settlement_state: "uncertain" },
      { ...queued, state: "canceled" },
    ]).status,
    "uncertain",
  );
  assert.equal(
    view([
      { ...queued, state: "canceled" },
      { ...queued, id: item, state: "canceled" },
    ]).status,
    "canceled",
  );
});
