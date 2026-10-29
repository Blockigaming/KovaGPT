import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { consumeOpenAiAdmission } from "../../src/lib/ai/openai-admission.server.mjs";
import { createOpenAiServiceHandler } from "../../src/lib/ai/openai-service-handler.server.mjs";
import { createOpenAiWebhookHandler } from "../../src/lib/ai/openai-webhook.server.mjs";
import { createOpenAiServiceClient } from "../../src/lib/ai/openai-services.server.mjs";

const secret = "synthetic-admission-secret-at-least-32-characters";
const midnight = Date.parse("2026-10-25T00:00:00Z");
const options = (overrides = {}) => ({
  identity: "synthetic-owner",
  action: "openai_services_daily",
  limit: 20,
  windowSeconds: 86400,
  backendUrl: "https://project.supabase.co",
  serviceRoleKey: "synthetic-service-key",
  hashSecret: secret,
  nowMs: midnight + 1000,
  ...overrides,
});

async function databaseFixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated;
    create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to service_role;`);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260803122000_distributed_diagnostics_limit.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec("set role service_role");
  const calls = [];
  // Execute the emitted PostgREST predicates as real SQL against the unchanged
  // migration. Concurrent GET/PATCH calls therefore exercise the database CAS.
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: input, ...init });
    assert.equal(url.origin, "https://project.supabase.co");
    assert.equal(url.pathname, "/rest/v1/diagnostic_rate_limits");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.apikey, "synthetic-service-key");
    assert.equal(init.headers.Authorization, "Bearer synthetic-service-key");
    assert.ok(init.headers.Prefer.includes("return=representation"));
    const params = [];
    const bind = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = [...url.searchParams]
      .filter(([name]) => !["select", "on_conflict"].includes(name))
      .map(([name, value]) => {
        assert.ok(
          ["identity_hash", "action", "window_started_at", "request_count", "expires_at"].includes(
            name,
          ),
        );
        assert.ok(value.startsWith("eq."));
        return `${name}=${bind(value.slice(3))}`;
      })
      .join(" and ");
    let sql;
    if (init.method === "POST") {
      assert.equal(url.searchParams.get("on_conflict"), "identity_hash,action,window_started_at");
      assert.ok(init.headers.Prefer.includes("resolution=ignore-duplicates"));
      const body = JSON.parse(init.body);
      const fields = Object.keys(body);
      sql = `insert into diagnostic_rate_limits(${fields.join(",")}) values(${fields.map((name) => bind(body[name])).join(",")}) on conflict(identity_hash,action,window_started_at) do nothing returning *`;
    } else if (init.method === "GET") {
      sql = `select * from diagnostic_rate_limits where ${where}`;
    } else {
      assert.equal(init.method, "PATCH");
      const body = JSON.parse(init.body);
      const assignments = Object.entries(body).map(([name, value]) => `${name}=${bind(value)}`);
      sql = `update diagnostic_rate_limits set ${assignments.join(",")} where ${where} returning *`;
    }
    return Response.json((await db.query(sql, params)).rows);
  };
  return {
    db,
    calls,
    consume: (input) => consumeOpenAiAdmission(options({ fetchImpl, ...input })),
  };
}

test("daily and heavy budgets remain atomic across concurrent service instances", async (t) => {
  const f = await databaseFixture(t);
  for (let wave = 0; wave < 5; wave++) {
    const batch = await Promise.all(Array.from({ length: 5 }, () => f.consume({})));
    assert.equal(batch.filter((item) => item.allowed).length, wave < 4 ? 5 : 0);
  }
  assert.equal(
    (await f.db.query("select request_count from diagnostic_rate_limits")).rows[0].request_count,
    20,
  );
  const heavy = await Promise.all(
    Array.from({ length: 10 }, () =>
      f.consume({ action: "openai_services_compute_daily", limit: 2 }),
    ),
  );
  assert.equal(heavy.filter((item) => item.allowed).length, 2);
  assert.ok(heavy.every((item) => ["allowed", "limited"].includes(item.status)));
  assert.equal((await f.consume({ nowMs: midnight + 86400000 })).allowed, true);
  assert.doesNotMatch(JSON.stringify(f.calls), /synthetic-owner|synthetic-admission-secret/);
});

test("search daily budget admits exactly its hundredth request and resets next day", async (t) => {
  const f = await databaseFixture(t);
  const search = { action: "openai_search_daily", limit: 100 };
  assert.equal((await f.consume(search)).allowed, true);
  await f.db.query("update diagnostic_rate_limits set request_count=99 where action=$1", [
    "openai_search_daily",
  ]);
  const boundary = await Promise.all([f.consume(search), f.consume(search)]);
  assert.equal(boundary.filter((item) => item.allowed).length, 1);
  assert.equal(boundary.filter((item) => item.status === "limited").length, 1);
  const row = await f.db.query("select request_count from diagnostic_rate_limits where action=$1", [
    "openai_search_daily",
  ]);
  assert.equal(row.rows[0].request_count, 100);
  assert.equal((await f.consume({ ...search, nowMs: midnight + 86400000 })).allowed, true);
});

test("developer authentication and ingress retain atomic 120-request minute limits", async (t) => {
  const f = await databaseFixture(t);
  for (const action of ["developer_authentication", "developer_ingress"]) {
    const input = { identity: `synthetic:${action}`, action, limit: 120, windowSeconds: 60 };
    assert.equal((await f.consume(input)).allowed, true);
    await f.db.query("update diagnostic_rate_limits set request_count=119 where action=$1", [
      action,
    ]);
    const boundary = await Promise.all(Array.from({ length: 8 }, () => f.consume(input)));
    assert.equal(boundary.filter((value) => value.allowed).length, 1);
    assert.ok(boundary.every((value) => ["allowed", "limited"].includes(value.status)));
    assert.equal((await f.consume(input)).status, "limited");
    assert.equal((await f.consume({ ...input, nowMs: midnight + 60000 })).allowed, true);
    assert.equal(
      (
        await f.db.query(
          "select request_count from diagnostic_rate_limits where action=$1 order by window_started_at",
          [action],
        )
      ).rows[0].request_count,
      120,
    );
    for (const invalid of [
      { limit: 119 },
      { limit: 121 },
      { windowSeconds: 30 },
      { windowSeconds: 86400 },
    ])
      await assert.rejects(f.consume({ ...input, ...invalid }), /Invalid OpenAI admission policy/);
  }
});

test("hosted tools and workspace embeddings retain their exact durable daily budgets", async (t) => {
  const f = await databaseFixture(t);
  for (const [action, limit] of [
    ["openai_hosted_chat_global_daily", 20],
    ["openai_hosted_chat_user_daily", 5],
    ["workspace_semantic_daily", 60],
    ["workspace_semantic_global_daily", 1000],
    ["workspace_index_daily", 100],
  ]) {
    const input = { identity: `synthetic:${action}`, action, limit };
    assert.equal((await f.consume(input)).allowed, true);
    await f.db.query("update diagnostic_rate_limits set request_count=$1 where action=$2", [
      limit - 1,
      action,
    ]);
    const last = await Promise.all(Array.from({ length: 4 }, () => f.consume(input)));
    assert.equal(last.filter((item) => item.allowed).length, 1, action);
    assert.equal((await f.consume(input)).status, "limited", action);
    assert.equal((await f.consume({ ...input, nowMs: midnight + 86400000 })).allowed, true);
    await assert.rejects(
      f.consume({ ...input, limit: limit + 1 }),
      /Invalid OpenAI admission policy/,
    );
    await assert.rejects(
      f.consume({ ...input, windowSeconds: 3600 }),
      /Invalid OpenAI admission policy/,
    );
  }
});

test("real hosted chat admits durable global and owner budgets before analysis or file search", async (t) => {
  const f = await databaseFixture(t);
  const calls = [];
  let providerCalls = 0;
  let storageAvailable = true;
  const env = { KOVA_OPENAI_SERVICES_ENABLED: "true" };
  const exports = {};
  const provider = {
    analyze: async (_input, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      providerCalls++;
      return { text: "Computed 6" };
    },
    searchFiles: async (_question, documents) => {
      assert.equal(documents.length, 1);
      providerCalls++;
      return { text: "Found 6" };
    },
  };
  const deps = {
    "@/lib/runtime-env.server": { runtimeEnv: (name) => env[name] },
    "./openai-admission-runtime.server": {
      consumeOpenAiApplicationAdmission: async (input) => {
        calls.push(input);
        return f.consume({ ...input, ...(!storageAvailable ? { serviceRoleKey: undefined } : {}) });
      },
    },
    "./openai-service-runtime.server": { openAiServices: () => provider },
    "./openai-services.server.mjs": {
      OpenAiServiceError: class extends Error {
        constructor(code, status) {
          super(code);
          this.status = status;
        }
      },
    },
    "./hosted-chat-result.mjs": { hostedChatResult: (value) => value },
  };
  vm.runInNewContext(
    ts.transpileModule(await readFile("src/lib/ai/hosted-chat.server.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in deps, `Unexpected import ${name}`);
        return deps[name];
      },
    },
  );
  const invoke = (tool = "data_analysis") =>
    exports.hostedChatCompletion(
      {
        model: "synthetic-model",
        max_completion_tokens: 100,
        messages: [{ role: "user", content: "Sum 1,2,3" }],
      },
      tool,
      "Find the sum",
      "owner",
      new AbortController().signal,
    );
  assert.equal((await invoke()).text, "Computed 6");
  assert.equal((await invoke("file_analysis")).text, "Found 6");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(0, 2))), [
    {
      identity: "openai_hosted_chat_global",
      action: "openai_hosted_chat_global_daily",
      limit: 20,
      windowSeconds: 86400,
    },
    {
      identity: "user:owner",
      action: "openai_hosted_chat_user_daily",
      limit: 5,
      windowSeconds: 86400,
    },
  ]);
  await f.db.query("update diagnostic_rate_limits set request_count=5 where action=$1", [
    "openai_hosted_chat_user_daily",
  ]);
  await assert.rejects(
    invoke(),
    (error) => error.message === "hosted_tool_budget_unavailable" && error.status === 429,
  );
  assert.equal(providerCalls, 2);
  await f.db.query("update diagnostic_rate_limits set request_count=20 where action=$1", [
    "openai_hosted_chat_global_daily",
  ]);
  await assert.rejects(invoke(), (error) => error.status === 429);
  assert.equal(providerCalls, 2);
  storageAvailable = false;
  await assert.rejects(invoke(), (error) => error.status === 503);
  assert.equal(providerCalls, 2);
  const admitted = calls.length;
  env.KOVA_REQUEST_CAPTURE_ENABLED = "true";
  await assert.rejects(invoke(), /hosted_tools_unavailable/);
  assert.equal(calls.length, admitted);
});

test("request and webhook receipts survive calendar boundaries and renew once after rolling expiry", async (t) => {
  const f = await databaseFixture(t);
  for (const [action, seconds] of [
    ["openai_service_request", 86400],
    ["openai_webhook_receipt", 604800],
  ]) {
    const input = { action, windowSeconds: seconds, limit: 1, nowMs: midnight - 1000 };
    const first = await Promise.all(Array.from({ length: 8 }, () => f.consume(input)));
    assert.equal(first.filter((item) => item.allowed).length, 1);
    assert.equal((await f.consume({ ...input, nowMs: midnight + 1000 })).status, "limited");
    const beforeExpiry = midnight - 1001 + seconds * 1000;
    assert.equal((await f.consume({ ...input, nowMs: beforeExpiry })).status, "limited");
    const afterExpiry = { ...input, nowMs: beforeExpiry + 2 };
    const renewals = await Promise.all(Array.from({ length: 8 }, () => f.consume(afterExpiry)));
    assert.equal(renewals.filter((item) => item.allowed).length, 1);
    assert.ok(renewals.every((item) => ["allowed", "limited"].includes(item.status)));
    assert.equal((await f.consume(afterExpiry)).status, "limited");
  }
});

test("actual service and signed-webhook handlers compose with durable long-window admission", async (t) => {
  const f = await databaseFixture(t);
  let now = midnight + 1000,
    executed = 0;
  const handle = createOpenAiServiceHandler({
    requireVerifiedUser: async (request) => ({
      userId: request.headers.get("x-kova-service-owner"),
      revalidateSession: async () => true,
    }),
    assertNotBanned: async () => null,
    getCallerTier: async () => "plus",
    enforceQuota: async () => null,
    consumeRateLimit: (input) => f.consume({ ...input, nowMs: now }),
    env: (name) => ({ KOVA_OPENAI_SERVICES_ENABLED: "true", OPENAI_API_KEY: "synthetic" })[name],
    services: () => ({
      analyze: async () => ({ text: `execution-${++executed}` }),
      moderate: async () => ({ text: `execution-${++executed}` }),
    }),
  });
  const request = (id, operation = "analysis", owner = "owner-one") =>
    new Request("https://kovagpt.com/api/ai/services", {
      method: "POST",
      headers: {
        origin: "https://kovagpt.com",
        "content-type": "application/json",
        "x-kova-service-owner": owner,
        "idempotency-key": id,
      },
      body: JSON.stringify({ operation, input: "Synthetic admission test" }),
    });
  assert.equal((await handle(request("request-0001"))).status, 200);
  assert.equal((await handle(request("request-0001"))).status, 409);
  assert.equal((await handle(request("request-0002"))).status, 200);
  now += 61000;
  assert.equal((await handle(request("request-0003"))).status, 429);
  assert.equal(executed, 2);
  // The global budget includes the fail-closed heavy admission reservation.
  for (let i = 3; i < 20; i++)
    assert.equal(
      (await handle(request(`request-${1000 + i}`, "moderation", `owner-${i}`))).status,
      200,
    );
  assert.equal(
    (await handle(request("request-global-limit", "moderation", "owner-extra"))).status,
    429,
  );
  assert.equal(executed, 19);
  const client = createOpenAiServiceClient("synthetic-api-key");
  const webhookSecret = "whsec_" + Buffer.from("synthetic webhook material").toString("base64");
  const body = JSON.stringify({ id: "evt_synthetic_123", type: "response.completed" });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", Buffer.from(webhookSecret.slice(6), "base64"))
    .update(`evt_synthetic_123.${timestamp}.${body}`)
    .digest("base64");
  const webhook = createOpenAiWebhookHandler({
    env: () => webhookSecret,
    verify: (...args) => client.webhooks.unwrap(...args),
    consumeRateLimit: (input) => f.consume({ ...input, nowMs: now }),
  });
  const delivery = () =>
    new Request("https://kovagpt.com/api/openai/webhook", {
      method: "POST",
      headers: {
        "webhook-id": "evt_synthetic_123",
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      },
      body,
    });
  assert.deepEqual(await (await webhook(delivery())).json(), { accepted: true, duplicate: false });
  assert.deepEqual(await (await webhook(delivery())).json(), { accepted: true, duplicate: true });
});

test("existing table denies browser roles while the service role can admit", async (t) => {
  const f = await databaseFixture(t);
  assert.equal((await f.consume({})).allowed, true);
  for (const role of ["anon", "authenticated"]) {
    await f.db.exec(`reset role; set role ${role}`);
    await assert.rejects(f.db.query("select * from diagnostic_rate_limits"), /permission denied/);
    await assert.rejects(
      f.db.query("update diagnostic_rate_limits set request_count=1"),
      /permission denied/,
    );
    await assert.rejects(f.db.query("delete from diagnostic_rate_limits"), /permission denied/);
  }
});

test("invalid policy or configuration cannot contact storage or change daily budgets", async () => {
  const fetchImpl = async () => assert.fail("must not fetch");
  for (const input of [
    { action: "other" },
    { limit: 21 },
    { windowSeconds: 3600 },
    { identity: "" },
  ])
    await assert.rejects(
      consumeOpenAiAdmission(options({ fetchImpl, ...input })),
      /Invalid OpenAI admission policy/,
    );
  for (const input of [
    { backendUrl: "http://project.supabase.co" },
    { backendUrl: "https://user:pass@project.supabase.co" },
    { backendUrl: "https://project.supabase.co/other" },
    { serviceRoleKey: undefined },
    { hashSecret: "short" },
  ])
    assert.equal(
      (await consumeOpenAiAdmission(options({ fetchImpl, ...input }))).status,
      "unavailable",
    );
});

test("ambiguous writes, invalid rows, oversized bodies, timeouts and contention fail closed", async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error("connection lost after commit");
    },
    async () => new Response("unavailable", { status: 503 }),
    async () => Response.json([{ identity_hash: "wrong", request_count: 1 }]),
    async () => new Response("x".repeat(2049)),
    async () => Response.json({ allowed: true }),
    async () => Response.json([]),
    async (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
      ),
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("["));
          },
        }),
      ),
  ]) {
    let count = 0;
    const start = Date.now();
    const result = await consumeOpenAiAdmission(
      options({
        timeoutMs: 30,
        fetchImpl: (...args) => {
          count++;
          return fetchImpl(...args);
        },
      }),
    );
    assert.equal(result.status, "unavailable");
    assert.ok(Date.now() - start < 1000);
    assert.ok(count <= 16);
  }
});
