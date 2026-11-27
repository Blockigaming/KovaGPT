import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createHash } from "node:crypto";
const slot = Symbol.for("kova.developer-ingress-test");
async function fixture(options = {}) {
  const version = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "approved",
    approved_by: "owner",
    approved_at: "2026-01-01",
    effective_at: "2026-01-01",
    expires_at: "2027-01-01",
    currency: "USD",
    public_price_configuration: {
      registryIds: [
        "33333333-3333-4333-8333-333333333331",
        "33333333-3333-4333-8333-333333333332",
        "33333333-3333-4333-8333-333333333333",
      ],
      contracts: [
        {
          provider: "azure_openai",
          upstreamModel: "gpt-5.6-luna",
          publicModel: "kova-fast",
          capability: "chat",
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
  const registry = ["input_tokens", "cached_input_tokens", "output_tokens"].map(
    (billing_dimension, index) => ({
      id: version.public_price_configuration.registryIds[index],
      provider: "azure_openai",
      upstream_model: "gpt-5.6-luna",
      billing_dimension,
      unit_quantity: 1000,
      unit_price: 1,
      currency: "USD",
      verification_status: "approved",
      effective_at: "2026-01-01",
      expires_at: "2027-01-01",
      active: true,
    }),
  );
  const state = { version, registry, calls: [], contexts: [], rows: {}, queries: [] };
  const db = {
    from(table) {
      let range, registryIds;
      const orders = [];
      const filters = [];
      state.queries.push({ table, orders, filters });
      const raw = () =>
        state.rows[table] ??
        (table === "developer_credit_accounts"
          ? { currency: "USD" }
          : table === "api_pricing_versions"
            ? state.version
            : state.registry);
      const result = () => {
        let rows = raw();
        if (registryIds && table === "upstream_price_registry") {
          rows = rows.filter((row) => registryIds.includes(row.id));
        }
        if (table === "developer_api_requests") {
          rows = rows.filter((row) =>
            filters.every(([operator, column, value]) =>
              operator === "in"
                ? value.includes(row[column])
                : operator === "eq"
                  ? row[column] === value
                  : operator === "gte"
                    ? row[column] >= value
                    : operator === "lt"
                      ? row[column] < value
                      : operator === "lte"
                        ? row[column] <= value
                        : true,
            ),
          );
        }
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null };
      };
      const q = {
        maybeSingle: async () => result(),
        then(resolve) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      for (const method of ["select", "eq", "is", "lte", "gt", "order", "limit", "abortSignal"])
        q[method] = () => q;
      q.in = (column, ids) => {
        if (column === "id") registryIds = ids;
        filters.push(["in", column, ids]);
        return q;
      };
      for (const method of ["eq", "gte", "lt", "lte"]) {
        q[method] = (column, value) => {
          filters.push([method, column, value]);
          return q;
        };
      }
      q.order = (name) => {
        orders.push(name);
        return q;
      };
      q.range = (from, to) => {
        range = [from, to];
        return q;
      };
      return q;
    },
  };
  globalThis[slot] = {
    ...state,
    loadFiles: async (body, ids) => ({ body, bindings: [], expiresAt: null }),
    db,
    async provider(body) {
      state.calls.push(body);
      return Response.json({ ok: true }, { headers: { "x-provider-private": "hidden" } });
    },
    billing(context, callback) {
      state.contexts.push(context);
      return callback();
    },
  };
  let source = await readFile(
    new URL("../../src/lib/pricing/developer-platform.server.ts", import.meta.url),
    "utf8",
  );
  source = source.replace(/import\s*\{[^}]+\}\s*from\s*"([^"]+)";/g, (full, path) => {
    if (path === "node:crypto") return full;
    if (
      path === "./developer-metering.mjs" ||
      path === "./developer-platform-policy.mjs" ||
      path === "./pricing-administration.mjs" ||
      path === "./developer-funding-allowance.mjs" ||
      path === "./developer-file-policy.mjs" ||
      path === "./developer-usage-summary.mjs" ||
      path === "./developer-image-edit-policy.mjs" ||
      path === "./developer-api-aliases.mjs" ||
      path === "./developer-chat-compat.mjs" ||
      path === "./developer-file-search-policy.mjs" ||
      path === "./developer-decisions-policy.mjs" ||
      path === "./developer-agent-policy.mjs" ||
      path === "./developer-skill-policy.mjs" ||
      path === "./developer-batch-policy.mjs" ||
      path === "./developer-analysis-policy.mjs"
    )
      return full.replace(
        JSON.stringify(path),
        JSON.stringify(new URL(`../../src/lib/pricing/${path.slice(2)}`, import.meta.url).href),
      );
    if (path === "./developer-file-content.server")
      return 'const loadDeveloperFileContent=async(identity,body,ids)=>globalThis[Symbol.for("kova.developer-ingress-test")].loadFiles(body,ids),readDeveloperFileRecords=async(identity,ids)=>globalThis[Symbol.for("kova.developer-ingress-test")].readFiles(identity,ids);';
    if (path === "@supabase/supabase-js")
      return 'const createClient=()=>globalThis[Symbol.for("kova.developer-ingress-test")].db;';
    if (path === "@/lib/api-auth.server")
      return 'const requireVerifiedUser=async()=>({userId:globalThis[Symbol.for("kova.developer-ingress-test")].owner});';
    if (path === "@/lib/distributed-rate-limit.server")
      return "const consumeApplicationRateLimit=async()=>({allowed:true});";
    if (path === "@/lib/auth-security.mjs") return "const isCrossSiteMutation=()=>false;";
    if (path === "@/lib/runtime-env.server") return 'const runtimeEnv=()=>"p".repeat(64);';
    if (path === "@/lib/ai/provider.server" && options.providerUrl)
      return full.replace(JSON.stringify(path), JSON.stringify(options.providerUrl));
    if (path === "@/lib/ai/provider.server")
      return 'const developerResponses=(body)=>globalThis[Symbol.for("kova.developer-ingress-test")].provider(body),developerDecisions=developerResponses,developerAnalysis=developerResponses,deleteDeveloperAnalysisContainer=async()=>{},developerModerations=developerResponses,embeddings=developerResponses,imageGenerations=developerResponses,imageEdits=developerResponses,getAiProviderConfig=()=>({provider:"azure_openai"}),providerModelId=(model)=>model;';
    if (path === "./developer-billing.server")
      return 'const withDeveloperBilling=(identity,callback)=>globalThis[Symbol.for("kova.developer-ingress-test")].billing(identity,callback);';
    return "";
  });
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(compiled + `\n// ${crypto.randomUUID()}`).toString("base64")}`
  );
  const identity = {
    id: "22222222-2222-4222-8222-222222222222",
    account_id: "account",
    capabilities: ["chat"],
    db,
  };
  return {
    state,
    module,
    identity,
    input: { model: "kova-fast", input: "hello", max_output_tokens: 100 },
  };
}
test("a signed quote binds exact input and scopes before any billable provider call", async () => {
  const f = await fixture();
  const quote = await f.module.developerQuote(f.identity, "responses", f.input);
  assert.equal(f.state.calls.length, 0);
  await assert.rejects(
    f.module.executeDeveloper(
      f.identity,
      "responses",
      { ...f.input, input: "changed" },
      "retry",
      quote.quoteToken,
    ),
    /quote_changed/,
  );
  await assert.rejects(
    f.module.executeDeveloper(
      { ...f.identity, id: "33333333-3333-4333-8333-333333333333" },
      "responses",
      f.input,
      "retry",
      quote.quoteToken,
    ),
    /quote_expired/,
  );
  await assert.rejects(
    f.module.executeDeveloper(
      { ...f.identity, capabilities: [] },
      "responses",
      f.input,
      "retry",
      quote.quoteToken,
    ),
    /scope_required/,
  );
  await assert.rejects(
    f.module.executeDeveloper(
      f.identity,
      "responses",
      f.input,
      "retry",
      quote.quoteToken.slice(0, -1) + "z",
    ),
    /quote_invalid/,
  );
  assert.equal(f.state.calls.length, 0);
  const response = await f.module.executeDeveloper(
    f.identity,
    "responses",
    f.input,
    "retry",
    quote.quoteToken,
  );
  assert.equal(response.headers.has("x-provider-private"), false);
  assert.equal((await response.json()).ok, true);
  assert.equal(f.state.calls[0].model, "gpt-5.6-luna");
  assert.equal(f.state.calls[0].store, false);
  assert.equal(f.state.contexts[0].maximumCharge, quote.maximumCharge);
  assert.equal(f.state.contexts[0].pricingVersion, quote.pricingVersion);
});

test("quotes bind reviewed registry rows and incorporate only the server funding collection floor", async () => {
  const f = await fixture();
  const baseline = await f.module.developerQuote(f.identity, "responses", f.input);
  f.state.registry.push({
    ...f.state.registry[0],
    id: "44444444-4444-4444-8444-444444444444",
    unit_price: 999999,
    effective_at: "2026-08-01",
  });
  const unchanged = await f.module.developerQuote(f.identity, "responses", f.input);
  assert.equal(unchanged.maximumCharge, baseline.maximumCharge);
  f.state.rows.developer_credit_accounts = { currency: "USD", funding_collection_rate: 0.2 };
  await assert.rejects(
    f.module.executeDeveloper(
      f.identity,
      "responses",
      f.input,
      "funding-floor-change",
      baseline.quoteToken,
    ),
    /quote_changed/,
  );
  const adjusted = await f.module.developerQuote(f.identity, "responses", f.input);
  assert.ok(Number(adjusted.maximumCharge) > Number(baseline.maximumCharge));
  f.state.version.public_price_configuration.registryIds = [];
  await assert.rejects(
    f.module.developerQuote(f.identity, "responses", f.input),
    /registry_binding_required/,
  );
  assert.equal(f.state.calls.length, 0);
});
test("expired quotes, increased prices and retired versions require a new acceptance", async () => {
  const f = await fixture();
  const quote = await f.module.developerQuote(f.identity, "responses", f.input);
  const now = Date.now;
  Date.now = () => now() + 120001;
  try {
    await assert.rejects(
      f.module.executeDeveloper(f.identity, "responses", f.input, "retry", quote.quoteToken),
      /quote_expired/,
    );
  } finally {
    Date.now = now;
  }
  f.state.registry[0].unit_price = 10;
  await assert.rejects(
    f.module.executeDeveloper(f.identity, "responses", f.input, "retry", quote.quoteToken),
    /quote_changed/,
  );
  f.state.registry[0].unit_price = 1;
  f.state.version.id = "33333333-3333-4333-8333-333333333333";
  await assert.rejects(
    f.module.executeDeveloper(f.identity, "responses", f.input, "retry", quote.quoteToken),
    /quote_changed/,
  );
  assert.equal(f.state.calls.length, 0);
});

test("console rejects a changed login before any database read or mutation", async () => {
  const f = await fixture();
  globalThis[slot].owner = "owner-b";
  for (const method of ["GET", "POST"]) {
    const response = await f.module.handleDeveloperConsole(
      new Request("https://kovagpt.com/api/developer/console", {
        method,
        headers: { "x-kova-expected-user": "owner-a" },
        ...(method === "POST"
          ? { body: '{"operation":"create_account","name":"A private name","currency":"USD"}' }
          : {}),
      }),
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "developer_principal_conflict");
  }
  assert.equal(f.state.queries.length, 0);
});

test("console paginates every stored budget deterministically beyond the first hundred", async () => {
  const f = await fixture();
  globalThis[slot].owner = "owner-a";
  f.state.rows = {
    developer_account_owners: [{ account_id: "account", name: "Owner" }],
    developer_projects: [],
    developer_billing_keys: [],
    developer_billing_limits: Array.from({ length: 250 }, (_, index) => ({ scope_id: index })),
    developer_api_requests: [],
    developer_credit_accounts: [],
  };
  const page = async (number) =>
    (
      await f.module.handleDeveloperConsole(
        new Request(`https://kovagpt.com/api/developer/console?limitsPage=${number}`, {
          headers: { "x-kova-expected-user": "owner-a" },
        }),
      )
    ).json();
  const middle = await page(1),
    last = await page(2);
  assert.equal(middle.limits.length, 100);
  assert.equal(middle.limits[0].scope_id, 100);
  assert.equal(middle.limitsHasMore, true);
  assert.equal(last.limits.length, 50);
  assert.equal(last.limits[0].scope_id, 200);
  assert.equal(last.limitsHasMore, false);
  assert.ok(
    f.state.queries
      .filter((query) => query.table === "developer_billing_limits")
      .every((query) => query.orders.join() === "account_id,scope_type,scope_id"),
  );
});

test("console filters owner-scoped API history before pagination and rejects foreign accounts", async () => {
  const f = await fixture();
  globalThis[slot].owner = "owner-a";
  const account = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const project = "33333333-3333-4333-8333-333333333333";
  const key = "44444444-4444-4444-8444-444444444444";
  const row = {
    account_id: account,
    project_id: project,
    api_key_id: key,
    public_model: "kova-argon-4.6",
    capability: "chat",
    settlement_state: "settled",
    created_at: "2026-11-26T12:00:00.000Z",
  };
  f.state.rows = {
    developer_account_owners: [{ account_id: account, name: "Owner" }],
    developer_projects: [],
    developer_billing_keys: [],
    developer_billing_limits: [],
    developer_credit_accounts: [],
    developer_api_requests: [
      { ...row, account_id: other, id: "foreign" },
      { ...row, project_id: other, id: "other-project" },
      { ...row, api_key_id: other, id: "other-key" },
      { ...row, public_model: "other-model", id: "other-model" },
      { ...row, created_at: "2026-11-27T00:00:00.000Z", id: "after" },
      ...Array.from({ length: 105 }, (_, id) => ({ ...row, id })),
    ],
  };
  const page = (params) =>
    f.module.handleDeveloperConsole(
      new Request("https://kovagpt.com/api/developer/console?" + new URLSearchParams(params), {
        headers: { "x-kova-expected-user": "owner-a" },
      }),
    );
  const filters = {
    usageAccount: account,
    usageProject: project,
    usageKey: key,
    usageModel: row.public_model,
    usageService: row.capability,
    usageStatus: row.settlement_state,
    usageFrom: "2026-11-26",
    usageThrough: "2026-11-26",
  };
  const first = await (await page(filters)).json();
  const last = await (await page({ ...filters, usagePage: "1" })).json();
  assert.equal(first.usage.length, 100);
  assert.equal(first.usageHasMore, true);
  assert.equal(last.usage.length, 5);
  assert.equal(last.usageHasMore, false);
  assert.equal(last.usage[0].id, 100);
  assert.ok(first.usage.every((item) => item.account_id === account));
  assert.ok(
    f.state.queries
      .filter((query) => query.table === "developer_api_requests")
      .every((query) => query.orders.join() === "created_at,id"),
  );
  assert.equal((await page({ usageAccount: other })).status, 403);
  assert.equal((await page({ usageFrom: "2026-02-30" })).status, 400);
  assert.equal((await page({ usagePage: "-1" })).status, 400);
});

test("usage summary includes all filtered records beyond one page without exposing another account", async () => {
  const f = await fixture();
  globalThis[slot].owner = "owner-a";
  const account = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const row = {
    account_id: account,
    public_model: "kova-argon-4.6",
    capability: "chat",
    settlement_state: "settled",
    currency: "USD",
    final_customer_charge: "1.25",
    authoritative_usage: { input_tokens: 4, cached_input_tokens: 2, output_tokens: 3 },
    created_at: "2026-11-01T12:00:00.000Z",
  };
  f.state.rows = {
    developer_account_owners: [{ account_id: account, name: "Owner" }],
    developer_api_requests: [
      { ...row, account_id: other, id: "foreign" },
      { ...row, created_at: "2026-10-31T23:59:59.000Z", id: "outside" },
      ...Array.from({ length: 505 }, (_, id) => ({ ...row, id })),
    ],
  };
  const response = await f.module.handleDeveloperConsole(
    new Request(
      "https://kovagpt.com/api/developer/console?usageSummary=1&usageFrom=2026-11-01&usageThrough=2026-11-02",
      {
        headers: { "x-kova-expected-user": "owner-a" },
      },
    ),
  );
  assert.equal(response.status, 200);
  const { summary } = await response.json();
  assert.equal(summary.requests, 505);
  assert.equal(summary.tokens.input_tokens, 2020);
  assert.equal(summary.tokens.cached_input_tokens, 1010);
  assert.deepEqual(summary.charges, [{ currency: "USD", amount: "631.25000000" }]);
  assert.equal(summary.days.length, 1);
  assert.equal(summary.models[0].label, "kova-argon-4.6");
});

test("configured Azure aliases remain identical from accepted quote through meter to outbound provider body", async () => {
  const providerSlot = Symbol.for("kova.provider-alias-test");
  const outbound = [],
    metered = [];
  const env = {
    AZURE_OPENAI_ENDPOINT: "https://fixture.openai.azure.com",
    AZURE_OPENAI_API_KEY: "local-fake-only",
    AZURE_OPENAI_DEPLOYMENT_CHAT: "north-chat-release",
    AZURE_OPENAI_DEPLOYMENT_THINKING: "north-thinking-release",
    AZURE_OPENAI_DEPLOYMENT_DEEP: "north-deep-release",
  };
  globalThis[providerSlot] = {
    env,
    async meter(input) {
      const accepted = globalThis[slot].contexts.at(-1);
      assert.equal(
        createHash("sha256")
          .update(
            JSON.stringify({
              provider: input.provider,
              capability: input.capability,
              body: input.body,
            }),
          )
          .digest("hex"),
        accepted.requestFingerprint,
      );
      metered.push(input.body.model);
      return input.send();
    },
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      outbound.push(body.model);
      return Response.json({ id: "resp_test", output: [], model: body.model });
    },
  };
  let source = await readFile(
    new URL("../../src/lib/ai/provider.server.ts", import.meta.url),
    "utf8",
  );
  source = source.replace(/import\s*\{[^}]+\}\s*from\s*"([^"]+)";/g, (full, path) => {
    if (path === "@/lib/runtime-env.server")
      return 'const runtimeEnv=(name)=>globalThis[Symbol.for("kova.provider-alias-test")].env[name];';
    if (path === "@/lib/pricing/developer-billing.server")
      return 'const meterProviderRequest=(input)=>globalThis[Symbol.for("kova.provider-alias-test")].meter(input);';
    if (path === "@/lib/ai/config.server")
      return "const getAiRuntimeConfig=()=>({generationEnabled:true});";
    if (path === "@/lib/ai/model-catalog.server")
      return 'const modelForPolicy=(mode)=>({id:mode==="deep"?"gpt-5.6-sol":mode==="thinking"?"gpt-5.6-terra":"gpt-5.6-luna"}),maximumServerOutputForModel=()=>32768;';
    return full.replace(
      JSON.stringify(path),
      JSON.stringify(new URL(`../../src/${path.slice(2)}`, import.meta.url).href),
    );
  });
  source =
    'const fetch=(...args)=>globalThis[Symbol.for("kova.provider-alias-test")].fetch(...args);const console={info(){},warn(){},error(){}};\n' +
    source;
  const providerUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
  const provider = await import(providerUrl);
  for (const [canonical, alias] of [
    ["gpt-5.6-luna", env.AZURE_OPENAI_DEPLOYMENT_CHAT],
    ["gpt-5.6-terra", env.AZURE_OPENAI_DEPLOYMENT_THINKING],
    ["gpt-5.6-sol", env.AZURE_OPENAI_DEPLOYMENT_DEEP],
  ]) {
    assert.equal(provider.providerModelId(canonical, "chat"), alias);
    assert.equal(provider.providerModelId(alias, "chat"), alias);
    const f = await fixture({ providerUrl });
    f.state.version.public_price_configuration.contracts[0].upstreamModel = alias;
    for (const rate of f.state.registry) rate.upstream_model = alias;
    const quote = await f.module.developerQuote(f.identity, "responses", f.input);
    await (
      await f.module.executeDeveloper(f.identity, "responses", f.input, "retry", quote.quoteToken)
    ).json();
    assert.equal(outbound.at(-1), alias);
    assert.equal(metered.at(-1), alias);
  }
  assert.deepEqual(outbound, [
    env.AZURE_OPENAI_DEPLOYMENT_CHAT,
    env.AZURE_OPENAI_DEPLOYMENT_THINKING,
    env.AZURE_OPENAI_DEPLOYMENT_DEEP,
  ]);
});

test("accepted quotes bind function schemas, structured format and every tool result byte", async () => {
  const f = await fixture();
  f.state.version.public_price_configuration.contracts[0].maximumUsage.input_tokens = 5000;
  const schema = {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  };
  const request = {
    ...f.input,
    tools: [{ type: "function", name: "weather", parameters: schema, strict: true }],
    text: { format: { type: "json_schema", name: "result", strict: true, schema } },
    input: [
      { role: "user", content: "Weather?" },
      { type: "function_call", call_id: "call_1", name: "weather", arguments: '{"city":"Paris"}' },
      { type: "function_call_output", call_id: "call_1", output: "18C" },
    ],
  };
  const quote = await f.module.developerQuote(f.identity, "responses", request);
  for (const mutate of [
    (value) => {
      value.tools[0].description = "Changed tool behavior";
    },
    (value) => {
      value.text.format.name = "changed";
    },
    (value) => {
      value.input[2].output = "25C";
    },
  ]) {
    const changed = structuredClone(request);
    mutate(changed);
    await assert.rejects(
      f.module.executeDeveloper(f.identity, "responses", changed, "round-2", quote.quoteToken),
      /quote_changed/,
    );
  }
  assert.equal(f.state.calls.length, 0);
  await f.module.executeDeveloper(f.identity, "responses", request, "round-2", quote.quoteToken);
  assert.equal(f.state.calls[0].input[2].output, "18C");
  assert.equal(f.state.calls[0].text.format.name, "result");
  assert.deepEqual(f.state.calls[0].include, ["reasoning.encrypted_content"]);
});

test("file quotes cap expiry and bind expanded immutable bytes through the last-mile billing context", async () => {
  const f = await fixture();
  const id = "55555555-5555-4555-8555-555555555555";
  const expiresAt = Date.now() + 30000;
  let content = "A,1";
  globalThis[slot].loadFiles = async (body, ids) => {
    assert.deepEqual(ids, [id]);
    return {
      body: {
        ...body,
        input: [
          { role: "user", content: body.input },
          { role: "user", content },
        ],
      },
      bindings: [{ id, digest: createHash("sha256").update(content).digest("hex") }],
      expiresAt,
    };
  };
  const request = { ...f.input, file_ids: [id] };
  const quote = await f.module.developerQuote(f.identity, "responses", request);
  assert.equal(quote.expiresAt, expiresAt);
  content = "A,2";
  await assert.rejects(
    f.module.executeDeveloper(f.identity, "responses", request, "file-call", quote.quoteToken),
    /quote_changed/,
  );
  assert.equal(f.state.calls.length, 0);
  content = "A,1";
  await f.module.executeDeveloper(f.identity, "responses", request, "file-call", quote.quoteToken);
  assert.equal(f.state.calls[0].input[1].content, "A,1");
  assert.deepEqual(f.state.contexts[0].fileBindings, [
    { id, digest: createHash("sha256").update(content).digest("hex") },
  ]);
});

test("key usage detail is isolated by account, project, key and request id", async () => {
  const f = await fixture();
  const identity = { ...f.identity, project_id: "project-a" };
  const id = (n) => `11111111-1111-4111-8111-00000000000${n}`;
  const row = {
    id: id(1),
    account_id: identity.account_id,
    project_id: identity.project_id,
    api_key_id: identity.id,
    settlement_state: "settled",
    authoritative_usage: { input_tokens: 12, internal: "hidden" },
  };
  f.state.rows.developer_api_requests = [
    row,
    { ...row, id: id(2), account_id: "other" },
    { ...row, id: id(3), project_id: "other" },
    { ...row, id: id(4), api_key_id: "other" },
  ];
  const read = (query) =>
    f.module.developerKeyUsage(identity, new Request(`https://kovagpt.com/api/v1/usage?${query}`));
  const response = await read(`id=${id(1)}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const detail = await response.json();
  assert.equal(detail.object, "usage");
  assert.equal(detail.data.id, id(1));
  assert.equal(detail.data.input_tokens, 12);
  assert.equal(detail.data.authoritative_usage, undefined);
  assert.equal(detail.data.internal, undefined);
  for (const n of [2, 3, 4, 5]) {
    const missing = await read(`id=${id(n)}`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "developer_request_not_found");
  }
  for (const query of ["id=bad", `id=${id(1)}&limit=1`, `id=${id(1)}&id=${id(2)}`]) {
    await assert.rejects(() => read(query), /developer_(id|input)_invalid/);
  }
  const list = await (await read("limit=25&offset=0")).json();
  assert.deepEqual(
    list.data.map((entry) => entry.id),
    [id(1)],
  );
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.contexts.length, 0);
});

test("model catalog detail returns only approved key-scoped aliases and rejects ambiguous selectors", async () => {
  const f = await fixture();
  const contract = f.state.version.public_price_configuration.contracts[0];
  f.state.version.public_price_configuration.contracts.push(
    { ...contract, capability: "streaming" },
    { ...contract, publicModel: "kova-hidden", capability: "embeddings" },
  );
  const read = (query = "") =>
    f.module.developerModels(f.identity, new Request(`https://kovagpt.com/api/v1/models${query}`));
  const listed = await (await read()).json();
  assert.deepEqual(
    listed.data.map((model) => model.id),
    ["kova-fast"],
  );
  const detail = await (await read("?id=kova-fast")).json();
  assert.deepEqual(detail.data, listed.data);
  for (const id of ["kova-hidden", "kova-missing"]) {
    const missing = await read(`?id=${id}`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "developer_model_not_found");
  }
  for (const query of ["?id=", "?id=../models", "?id=kova-fast&id=kova-hidden", "?page=1"])
    await assert.rejects(() => read(query), /developer_(model|input)_invalid/);
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.contexts.length, 0);
});

test("compatibility aliases use the canonical provider meter and cannot reuse a different API quote", async () => {
  const f = await fixture();
  const chat = {
    model: f.input.model,
    messages: [{ role: "user", content: "hello" }],
    max_completion_tokens: 100,
  };
  const quote = await f.module.developerQuote(f.identity, "chat/completions", chat);
  const native = { ...f.input, input: chat.messages };
  await assert.rejects(
    f.module.executeDeveloper(f.identity, "responses", native, "alias", quote.quoteToken),
    /quote_changed/,
  );
  await assert.rejects(
    f.module.executeDeveloper(
      f.identity,
      "chat/completions",
      { ...chat, messages: [{ role: "user", content: "changed" }] },
      "alias",
      quote.quoteToken,
    ),
    /quote_changed/,
  );
  assert.equal(f.state.calls.length, 0);
  globalThis[slot].provider = async (body) => {
    f.state.calls.push(body);
    return Response.json({
      id: "resp_fixture",
      created_at: 1795651200,
      model: "gpt-5.6-luna",
      status: "completed",
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi" }] },
      ],
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    });
  };
  const result = await f.module.executeDeveloper(
    f.identity,
    "chat/completions",
    chat,
    "alias",
    quote.quoteToken,
  );
  assert.equal((await result.json()).model, f.input.model);
  assert.equal(f.state.calls[0].store, false);
  assert.deepEqual(f.state.calls[0].input, chat.messages);
  assert.equal(f.state.contexts.length, 1);
  await assert.rejects(
    f.module.developerQuote(f.identity, "search", {
      model: f.input.model,
      query: "test",
      max_output_tokens: 100,
      max_tool_calls: 1,
    }),
    /web_search_unavailable/,
  );
  assert.equal(f.state.calls.length, 1);
});
