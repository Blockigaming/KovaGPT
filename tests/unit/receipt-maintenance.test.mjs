import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      AbortController,
      Response,
      URL,
      setTimeout,
      clearTimeout,
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    },
  );
  return exports;
}

const { runReceiptMaintenanceBatch } = load("src/lib/receipt-maintenance.server.ts", {
  "@/integrations/supabase/client.server": { supabaseAdmin: {} },
});

function handler(secret, run) {
  return load("src/routes/api/internal/receipt-maintenance.ts", {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/http-security.server": { timingSafeEqualText: (left, right) => left === right },
    "@/lib/runtime-env.server": { runtimeEnv: () => secret },
    "@/lib/receipt-maintenance.server": { runReceiptMaintenanceBatch: run },
  }).Route.server.handlers.POST;
}

test("receipt maintenance is bounded and retains eight days of replay protection", async () => {
  const calls = [];
  const now = Date.parse("2026-09-04T12:00:00Z");
  const result = await runReceiptMaintenanceBatch(
    {
      rpc(name, args) {
        calls.push({ name, args });
        return {
          abortSignal: async (signal) => {
            assert.equal(signal.aborted, false);
            return { data: 7, error: null };
          },
        };
      },
    },
    now,
  );
  assert.deepEqual(
    calls.map((c) => c.name),
    [
      "purge_work_sync_receipts",
      "purge_project_template_mutation_receipts",
      "purge_organization_mutation_receipts",
    ],
  );
  for (const { args } of calls) {
    assert.equal(args.p_before, "2026-08-27T12:00:00.000Z");
    assert.equal(args.p_limit, 500);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result.removed)), {
    work: 7,
    projectTemplates: 7,
    organizations: 7,
  });
});

test("receipt maintenance never reports partial or malformed results as success", async () => {
  for (const data of [null, -1, 501, "1", 1.5]) {
    await assert.rejects(
      runReceiptMaintenanceBatch({
        rpc: () => ({ abortSignal: async () => ({ data, error: null }) }),
      }),
      /receipt_maintenance_failed/,
    );
  }
  let calls = 0;
  await assert.rejects(
    runReceiptMaintenanceBatch({
      rpc: () => ({
        abortSignal: async () =>
          ++calls === 1
            ? { data: 2, error: null }
            : { data: null, error: { message: "private SQL" } },
      }),
    }),
    /receipt_maintenance_failed/,
  );
  assert.equal(calls, 2);
});

test("a hung maintenance RPC times out and receives cancellation", async () => {
  let signal;
  let calls = 0;
  await assert.rejects(
    runReceiptMaintenanceBatch(
      {
        rpc: () => {
          calls++;
          return {
            abortSignal: (value) => {
              signal = value;
              return new Promise(() => {});
            },
          };
        },
      },
      Date.now(),
      5,
    ),
    /receipt_maintenance_timeout/,
  );
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test("maintenance requires dedicated configuration and authorization before database access", async () => {
  for (const [secret, token, expected] of [
    [undefined, "", 503],
    ["expected", "", 401],
    ["expected", "wrong", 401],
  ]) {
    let calls = 0;
    const response = await handler(secret, () => {
      calls++;
    })({
      request: new Request("https://kova.test/api/internal/receipt-maintenance", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    });
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls, 0);
  }
});

test("maintenance disallows caller-selected arguments and redacts runtime failures", async () => {
  let calls = 0;
  const run = handler("expected", async () => {
    calls++;
    throw new Error("private SQL secret");
  });
  for (const suffix of ["?limit=99999", ""]) {
    const request = new Request(`https://kova.test/api/internal/receipt-maintenance${suffix}`, {
      method: "POST",
      headers: { authorization: "Bearer expected" },
      ...(suffix ? {} : { body: "{}" }),
    });
    assert.equal((await run({ request })).status, 400);
  }
  assert.equal(calls, 0);
  const response = await run({
    request: new Request("https://kova.test/api/internal/receipt-maintenance", {
      method: "POST",
      headers: { authorization: "Bearer expected" },
    }),
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private SQL|secret/);
});
