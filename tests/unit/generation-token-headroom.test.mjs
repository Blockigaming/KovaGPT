import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { planAllowance } from "../../src/lib/plan-usage-policy.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const clock = Date.parse("2026-11-15T12:00:00Z");
class TestDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [clock]));
  }
}
const compiled = ts.transpileModule(readFileSync("src/lib/ai/accounting.server.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const event = (tokens, created = "2026-11-15T10:00:00Z") => ({
  created_at: created,
  actual_billable_tokens: tokens,
  reserved_tokens: tokens + 100,
});

function fixture(rows, options = {}) {
  const requests = [];
  const signal = new AbortController().signal;
  const exports = {};
  const modules = {
    "../plan-usage-policy.mjs": { planAllowance },
    "@supabase/supabase-js": {
      createClient: (url, key, init) =>
        createClient(url, key, {
          ...init,
          global: {
            fetch: async (input, request) => {
              const url = new URL(input);
              assert.equal(url.pathname, "/rest/v1/ai_usage_events");
              assert.equal(
                url.searchParams.get("select"),
                "created_at,actual_billable_tokens,reserved_tokens",
              );
              assert.equal(url.searchParams.get("user_id"), `eq.${owner}`);
              assert.equal(url.searchParams.get("created_at"), "gte.2026-11-01T00:00:00.000Z");
              assert.equal(
                url.searchParams.get("status"),
                "not.in.(quota_rejected,provider_rejected,provider_failed,accounting_failed)",
              );
              assert.equal(url.searchParams.get("order"), "id.asc");
              assert.equal(request.method, "GET");
              assert.ok(request.signal, "query must retain its cancellation signal");
              const offset = Number(url.searchParams.get("offset"));
              const limit = Number(url.searchParams.get("limit"));
              requests.push({ offset, limit });
              if (options.fail)
                return Response.json({ message: "offline failure" }, { status: 503 });
              const page = rows.slice(offset, offset + limit);
              const total =
                options.count ?? (options.changingCount && offset ? rows.length + 1 : rows.length);
              return Response.json(page, {
                headers: options.missingCount
                  ? {}
                  : {
                      "content-range": `${offset}-${offset + Math.max(0, page.length - 1)}/${total}`,
                    },
              });
            },
          },
        }),
    },
    "@/lib/ai/config.server": {
      getAiRuntimeConfig: () => ({ maxTokensPerUserDay: 50_000, maxTokensPerUserMonth: 500_000 }),
    },
    "@/lib/ai/model-catalog.server": {},
    "@/lib/ai/billing-period.mjs": {},
    "@/lib/billing-plans": { BILLING_ENV: "test" },
    "@/lib/runtime-env.server": {
      runtimeEnv: (name) =>
        ({
          SUPABASE_URL: "https://accounting.example",
          SUPABASE_SERVICE_ROLE_KEY: "offline-fixture-key",
        })[name],
    },
  };
  vm.runInNewContext(compiled, {
    exports,
    Date: TestDate,
    require: (name) => {
      if (!(name in modules)) throw Error(`Unexpected module: ${name}`);
      return modules[name];
    },
  });
  return {
    requests,
    read: () => exports.getGenerationTokenHeadroom({ userId: owner, plan: "free", signal }),
  };
}

test("headroom includes actual spend, active and stale reservations, and zero-token receipts", async () => {
  const rows = [event(1_953), event(null), event(0), event(400, "2026-11-14T12:00:00Z")];
  rows[1].reserved_tokens = 300;
  const f = fixture(rows);
  const result = await f.read();
  assert.equal(result.tokenLimit, 7_747);
  assert.equal(result.limitingQuota, "daily_tokens");
  assert.deepEqual(f.requests, [{ offset: 0, limit: 500 }]);
});

test("monthly headroom can be tighter than the fresh daily allowance", async () => {
  const result = await fixture([event(99_000, "2026-11-14T12:00:00Z")]).read();
  assert.equal(result.tokenLimit, 1_000);
  assert.equal(result.limitingQuota, "monthly_tokens");
  assert.equal((await fixture([event(100_000)]).read()).tokenLimit, 0);
});

test("all ledger pages are counted before returning remaining tokens", async () => {
  const f = fixture(Array.from({ length: 501 }, () => event(1)));
  assert.equal((await f.read()).tokenLimit, 9_499);
  assert.deepEqual(f.requests, [
    { offset: 0, limit: 500 },
    { offset: 500, limit: 500 },
  ]);
});

test("an empty ledger retains the configured Free allowance", async () => {
  assert.equal((await fixture([]).read()).tokenLimit, 10_000);
});

test("failed, unbounded, inconsistent or malformed ledger reads fail closed", async () => {
  for (const [rows, options] of [
    [[], { fail: true }],
    [[], { missingCount: true }],
    [[], { count: 10_001 }],
    [[], { count: 1 }],
    [[event(-1)], {}],
    [[event("1953")], {}],
    [[event(1, "not-a-timestamp")], {}],
    [Array.from({ length: 501 }, () => event(1)), { changingCount: true }],
  ])
    await assert.rejects(fixture(rows, options).read(), /usage_headroom_unavailable/);
});
