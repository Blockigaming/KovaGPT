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
      state.queries.push({ table, orders });
      const raw = () =>
        state.rows[table] ??
        (table === "developer_credit_accounts"
          ? { currency: "USD" }
          : table === "api_pricing_versions"
            ? state.version
            : state.registry);
      const result = () => ({
        data:
          registryIds && table === "upstream_price_registry"
            ? raw().filter((row) => registryIds.includes(row.id))
            : range
              ? raw().slice(range[0], range[1] + 1)
              : raw(),
        error: null,
      });
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
        return q;
      };
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
      path === "./developer-file-policy.mjs"
    )
      return full.replace(
        JSON.stringify(path),
        JSON.stringify(new URL(`../../src/lib/pricing/${path.slice(2)}`, import.meta.url).href),
      );
    if (path === "./developer-file-content.server")
      return 'const loadDeveloperFileContent=async(identity,body,ids)=>globalThis[Symbol.for("kova.developer-ingress-test")].loadFiles(body,ids);';
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
      return 'const developerResponses=(body)=>globalThis[Symbol.for("kova.developer-ingress-test")].provider(body),embeddings=developerResponses,imageGenerations=developerResponses,getAiProviderConfig=()=>({provider:"azure_openai"}),providerModelId=(model)=>model;';
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
