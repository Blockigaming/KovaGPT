import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareDeveloperQuote,
  settleDeveloperQuote,
  createUsageCollector,
  authoritativeUsage,
  runMeteredProvider,
} from "../../src/lib/pricing/developer-metering.mjs";

const versionId = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const version = {
    id: versionId,
    status: "approved",
    approved_by: "owner",
    approved_at: "2026-01-01",
    effective_at: "2026-01-01",
    expires_at: "2027-01-01",
    currency: "USD",
    public_price_configuration: {
      contracts: [
        {
          provider: "azure_openai",
          upstreamModel: "gpt-5.6-luna",
          capability: "chat",
          publicModel: "luna",
          meter: "responses_tokens",
          expectedResponseModels: ["gpt-5.6-luna"],
          maximumRequestBytes: 10000,
          maximumUsage: { input_tokens: 1000, cached_input_tokens: 1000, output_tokens: 100 },
        },
      ],
    },
    allowance_configuration: {
      fixed: { compute: 0.01 },
      percentages: { fraud: 0.01 },
      collectionPercentage: 0.03,
      collectionFixed: 0.01,
    },
    margin_floor: 0.5,
    risk_buffer_percentage: 0.15,
    minimum_request_charge: 0.01,
    rounding_increment: 0.0001,
  };
  const registry = ["input_tokens", "cached_input_tokens", "output_tokens"].map((dimension) => ({
    provider: "azure_openai",
    upstream_model: "gpt-5.6-luna",
    billing_dimension: dimension,
    unit_quantity: 1000,
    unit_price: 1,
    currency: "USD",
    verification_status: "approved",
    effective_at: "2026-01-01",
    expires_at: "2027-01-01",
    active: true,
  }));
  const request = {
    provider: "azure_openai",
    capability: "chat",
    body: {
      model: "gpt-5.6-luna",
      max_output_tokens: 100,
      input: [{ role: "user", content: "hello" }],
    },
  };
  return { config: { version, registry }, request };
}
function prepared() {
  const { config, request } = fixture();
  return prepareDeveloperQuote(config, request, new Date("2026-09-05"));
}
const responseValue = {
  id: "resp_test",
  model: "gpt-5.6-luna",
  status: "completed",
  usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 30 },
};
function harness(overrides = {}) {
  const calls = [],
    options = {
      prepared: prepared(),
      admit: async () => ({ decision: "admitted", request_id: "r", lease_token: "l" }),
      dispatch: async () => true,
      finish: async (_a, outcome, result) => {
        calls.push({ outcome, result });
      },
      send: async () => Response.json(responseValue),
      ...overrides,
    };
  return { calls, options };
}

test("verified contracts are mandatory and no request field supplies pricing or usage", () => {
  for (const mutate of [
    (f) => (f.config.version.status = "draft"),
    (f) => (f.config.version.expires_at = "2020-01-01"),
    (f) => (f.config.registry = []),
    (f) => (f.config.version.allowance_configuration.collectionFixed = -1),
    (f) => (f.request.body.max_output_tokens = 101),
    (f) => (f.request.body.tools = [{ type: "web_search" }]),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => prepareDeveloperQuote(f.config, f.request, new Date("2026-09-05")));
  }
  const f = fixture();
  f.request.body.price = 0;
  f.request.body.usage = { input_tokens: 0 };
  assert.equal(
    prepareDeveloperQuote(f.config, f.request, new Date("2026-09-05")).quote.customerCharge,
    prepared().quote.customerCharge,
  );
});
test("usage collector ignores arbitrary large output and handles fragmented escaped strings", () => {
  const collector = createUsageCollector();
  const body = JSON.stringify({
    data: [{ b64_json: "A".repeat(2000000) + '\\"' }],
    ...responseValue,
  });
  for (let i = 0; i < body.length; i += 17) collector.push(body.slice(i, i + 17));
  assert.deepEqual(collector.value(), responseValue);
  assert.deepEqual(authoritativeUsage(collector.value(), "responses_tokens").dimensions, {
    input_tokens: 80,
    cached_input_tokens: 20,
    output_tokens: 30,
  });
  const incomplete = createUsageCollector();
  incomplete.push('{"usage":');
  assert.equal(incomplete.value(), null);
});
test("settlement uses accepted rates, actual usage, and never increases accepted charge", () => {
  const p = prepared();
  const low = settleDeveloperQuote(p, {
    dimensions: { input_tokens: 80, cached_input_tokens: 20, output_tokens: 30 },
    providerResponseId: "resp_test",
  });
  assert.ok(low.finalCustomerCharge < p.quote.customerCharge);
  assert.equal(low.belowFloor, false);
  const high = settleDeveloperQuote(p, {
    dimensions: { input_tokens: 100000, cached_input_tokens: 0, output_tokens: 100 },
    providerResponseId: "resp_test",
  });
  assert.equal(high.finalCustomerCharge, p.quote.customerCharge);
  assert.equal(high.belowFloor, true);
});
test("JSON completion settles once only after authoritative usage, including image and embedding meters", async () => {
  const { options, calls } = harness();
  const response = await runMeteredProvider(options);
  assert.equal(calls.length, 0);
  await response.json();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, "settled");
  assert.deepEqual(
    authoritativeUsage({ usage: { prompt_tokens: 12 } }, "embedding_tokens", "req_embed")
      .dimensions,
    { input_tokens: 12 },
  );
  assert.deepEqual(
    authoritativeUsage(
      {
        usage: {
          input_tokens: 9,
          input_tokens_details: { text_tokens: 4, image_tokens: 5 },
          output_tokens: 6,
        },
      },
      "image_tokens",
      "req_img",
    ).dimensions,
    { input_tokens: 4, image_input_tokens: 5, output_tokens: 6 },
  );
  assert.equal(authoritativeUsage({ usage: { prompt_tokens: 12 } }, "embedding_tokens"), null);
});
test("admission refusal prevents dispatch, and pre-dispatch cancellation releases", async () => {
  let dispatched = 0;
  const denied = harness({
    admit: async () => ({ decision: "duplicate" }),
    dispatch: async () => {
      dispatched++;
      return true;
    },
  });
  await assert.rejects(runMeteredProvider(denied.options), /already_admitted/);
  assert.equal(dispatched, 0);
  assert.equal(denied.calls.length, 0);
  const controller = new AbortController();
  const canceled = harness({
    signal: controller.signal,
    admit: async () => {
      controller.abort();
      return { decision: "admitted" };
    },
  });
  await assert.rejects(runMeteredProvider(canceled.options));
  assert.deepEqual(
    canceled.calls.map((x) => x.outcome),
    ["released"],
  );
});
test("refused dispatch releases; unknown dispatch acknowledgement and network errors retain holds", async () => {
  for (const [dispatch, outcome] of [
    [async () => false, "released"],
    [
      async () => {
        throw new Error("lost database response");
      },
      "uncertain",
    ],
  ]) {
    const h = harness({ dispatch });
    await assert.rejects(runMeteredProvider(h.options));
    assert.equal(h.calls[0].outcome, outcome);
  }
  const h = harness({
    send: async () => {
      throw new Error("network timeout after dispatch");
    },
  });
  await assert.rejects(runMeteredProvider(h.options));
  assert.equal(h.calls[0].outcome, "uncertain");
  const rejected = harness({ send: async () => new Response("rejected", { status: 429 }) });
  await runMeteredProvider(rejected.options);
  assert.equal(rejected.calls[0].outcome, "uncertain");
});
test("SSE completion survives cancellation, and early cancellation is uncertain", async () => {
  for (const completed of [false, true]) {
    const payload = completed
      ? `event: response.completed\r\ndata: ${JSON.stringify({ type: "response.completed", response: responseValue })}\r\n\r\n`
      : 'data: {"type":"response.output_text.delta","delta":"hello"}\n\n';
    let sent = false;
    const h = harness({
      send: async () =>
        new Response(
          new ReadableStream({
            pull(c) {
              if (!sent) {
                sent = true;
                c.enqueue(new TextEncoder().encode(payload));
              }
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    });
    const response = await runMeteredProvider(h.options);
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].outcome, completed ? "settled" : "uncertain");
  }
});
test("missing or forged incomplete usage cannot settle; ledger failure does not silently complete", async () => {
  const h = harness({
    send: async () => Response.json({ ...responseValue, usage: { input_tokens: 1 } }),
  });
  await (await runMeteredProvider(h.options)).text();
  assert.equal(h.calls[0].outcome, "uncertain");
  const failed = harness({
    finish: async () => {
      throw new Error("ledger offline");
    },
  });
  await assert.rejects((await runMeteredProvider(failed.options)).text(), /ledger offline/);
});

test("operator-approved higher margin floor and immutable price evidence are retained", () => {
  const f = fixture();
  f.config.version.margin_floor = 0.7;
  const p = prepareDeveloperQuote(f.config, f.request, new Date("2026-09-05"));
  assert.equal(p.quote.marginFloor, 0.7);
  assert.ok(p.quote.projectedGrossMarginPercentage >= 0.7);
  assert.equal(p.quote.acceptedPricing.registry.length, 3);
});

test("unexpected response model, mixed image-output prices and impossible request bounds fail closed", async () => {
  const wrong = harness({
    send: async () => Response.json({ ...responseValue, model: "other-model" }),
  });
  await (await runMeteredProvider(wrong.options)).text();
  assert.equal(wrong.calls[0].outcome, "uncertain");
  const f = fixture();
  f.config.version.public_price_configuration.contracts[0].maximumUsage.input_tokens = 1;
  assert.throws(
    () => prepareDeveloperQuote(f.config, f.request, new Date("2026-09-05")),
    /input_bound/,
  );
  assert.equal(
    authoritativeUsage(
      {
        usage: {
          input_tokens: 1,
          input_tokens_details: { text_tokens: 1, image_tokens: 0 },
          output_tokens: 3,
          output_tokens_details: { text_tokens: 1, image_tokens: 2 },
        },
      },
      "image_tokens",
      "req_image",
    ),
    null,
  );
});

test("reasoning settings require an explicitly approved model contract and the same token bound", () => {
  const f = fixture();
  const at = new Date("2026-09-05");
  const contract = f.config.version.public_price_configuration.contracts[0];
  f.request.body.reasoning = { effort: "high" };
  assert.throws(
    () => prepareDeveloperQuote(f.config, f.request, at),
    /billing_reasoning_effort_unapproved/,
  );
  contract.allowedReasoningEfforts = ["low", "high"];
  const quote = prepareDeveloperQuote(f.config, f.request, at);
  assert.equal(quote.quote.maximumReservedCharge, prepared().quote.maximumReservedCharge);
  f.request.body.reasoning = { effort: "xhigh" };
  assert.throws(
    () => prepareDeveloperQuote(f.config, f.request, at),
    /billing_reasoning_effort_unapproved/,
  );
  delete f.request.body.reasoning;
  contract.allowedReasoningEfforts = ["high", "high"];
  assert.throws(
    () => prepareDeveloperQuote(f.config, f.request, at),
    /billing_reasoning_contract_invalid/,
  );
});

test("inline vision requires a reviewed token upper bound and cannot bypass reservation", () => {
  const f = fixture();
  const contract = f.config.version.public_price_configuration.contracts[0];
  const at = new Date("2026-09-05");
  const image = {
    type: "input_image",
    detail: "low",
    image_url:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9h8AAAAASUVORK5CYII=",
  };
  f.request.body.input = [{ role: "user", content: [image] }];
  assert.throws(
    () => prepareDeveloperQuote(f.config, f.request, at),
    /billing_dimensions_unsupported/,
  );
  contract.maximumInlineImageTokens = 100;
  const quote = prepareDeveloperQuote(f.config, f.request, at);
  assert.equal(quote.quote.maximumReservedCharge, prepared().quote.maximumReservedCharge);
  contract.maximumInlineImageTokens = contract.maximumUsage.input_tokens;
  assert.throws(
    () => prepareDeveloperQuote(f.config, f.request, at),
    /billing_input_bound_exceeded/,
  );
  contract.maximumInlineImageTokens = 100;
  f.request.body.input[0].content.push(image);
  assert.throws(
    () => prepareDeveloperQuote(f.config, f.request, at),
    /billing_dimensions_unsupported/,
  );
});

function searchFixture() {
  const f = fixture();
  const contract = f.config.version.public_price_configuration.contracts[0];
  contract.provider = "openai";
  contract.meter = "responses_search";
  contract.searchContentAccounting = "included_in_input_tokens";
  contract.maximumWebSearchInputTokens = 100;
  contract.maximumUsage.web_search_calls = 3;
  f.request.provider = "openai";
  Object.assign(f.request.body, {
    tools: [{ type: "web_search", search_context_size: "low" }],
    max_tool_calls: 2,
    tool_choice: "required",
    stream: false,
  });
  for (const row of f.config.registry) row.provider = "openai";
  f.config.registry.push({
    ...f.config.registry[0],
    billing_dimension: "web_search_calls",
    unit_quantity: 1,
    unit_price: 2,
  });
  return f;
}

test("hosted search reserves its separate per-call price and requires reviewed token bounds", () => {
  const at = new Date("2026-09-05");
  const f = searchFixture();
  const p = prepareDeveloperQuote(f.config, f.request, at);
  assert.equal(p.options.usage.dimensions.web_search_calls, 2);
  assert.equal(p.quote.upstreamBreakdown.web_search_calls, 4);
  for (const mutate of [
    (v) => v.config.registry.pop(),
    (v) => (v.request.body.max_tool_calls = 4),
    (v) => (v.request.body.stream = true),
    (v) => {
      v.config.version.public_price_configuration.contracts[0].maximumWebSearchInputTokens = 1000;
    },
    (v) => {
      delete v.config.version.public_price_configuration.contracts[0].searchContentAccounting;
    },
  ]) {
    const bad = searchFixture();
    mutate(bad);
    assert.throws(() => prepareDeveloperQuote(bad.config, bad.request, at));
  }
  delete f.request.body.tools;
  delete f.request.body.tool_choice;
  delete f.request.body.max_tool_calls;
  const plain = prepareDeveloperQuote(f.config, f.request, at);
  assert.equal(plain.options.usage.dimensions.web_search_calls, 0);
  assert.equal(plain.quote.upstreamBreakdown.web_search_calls, undefined);
});

test("hosted search settles authoritative completed tool calls, not client estimates", async () => {
  const f = searchFixture();
  const p = prepareDeveloperQuote(f.config, f.request, new Date("2026-09-05"));
  const call = { id: "ws_fixture", type: "web_search_call", status: "completed" };
  const value = { ...responseValue, output: [call, { type: "message" }] };
  const collector = createUsageCollector(true);
  const serialized = JSON.stringify(value);
  for (let i = 0; i < serialized.length; i += 7) collector.push(serialized.slice(i, i + 7));
  const actual = authoritativeUsage(collector.value(), "responses_search");
  assert.equal(actual.dimensions.web_search_calls, 1);
  const { calls, options } = harness({ prepared: p, send: async () => Response.json(value) });
  await (await runMeteredProvider(options)).json();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, "settled");
  assert.equal(calls[0].result.usage.web_search_calls, 1);
  for (const output of [
    undefined,
    [call, call],
    [{ ...call, status: "failed" }],
    [{ type: "code_interpreter_call" }],
  ]) {
    assert.equal(authoritativeUsage({ ...value, output }, "responses_search"), null);
  }
  const uncertain = harness({
    prepared: p,
    send: async () => Response.json({ ...value, output: [{ type: "message" }] }),
  });
  await (await runMeteredProvider(uncertain.options)).json();
  assert.equal(uncertain.calls[0].outcome, "uncertain");
});
