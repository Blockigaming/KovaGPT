import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function serverWithRoute(fetch) {
  const module = { exports: {} };
  const modules = {
    "./lib/error-page": { renderErrorPage: () => "Fixture error" },
    "./lib/http-security.server": { rejectCrossSiteRequest: () => null },
    "./lib/azure-runtime-env.server": { validateAzureRuntimeEnv: () => {} },
    "./lib/origin-boundary.server": { enforceAzureProductionOriginBoundary: () => null },
    "./lib/runtime-env.server": { withRuntimeBindings: (_env, operation) => operation() },
    "@tanstack/react-start/server-entry": { default: { fetch } },
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Headers,
    Response,
    console: { error: () => assert.fail("Unexpected outer-server failure") },
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected server dependency: ${name}`);
      return modules[name];
    },
  });
  return module.exports.default;
}

test("outer fetch preserves strict email-action guards and intersects every endpoint CSP with its baseline", async () => {
  const actionPolicy =
    "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'";
  for (const status of [200, 503]) {
    const app = serverWithRoute(
      () =>
        new Response("<main>Explicit email confirmation</main>", {
          status,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": actionPolicy,
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
            "Cache-Control": "no-store",
          },
        }),
    );
    const response = await app.fetch(
      new Request(`https://app.example.test/api/auth/verify?token=${"T".repeat(43)}`),
      {},
      {},
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const policies = response.headers.get("content-security-policy");
    assert.ok(policies.includes(actionPolicy));
    assert.match(policies, /default-src 'self'/u);
    assert.match(policies, /frame-ancestors 'self'/u);
    assert.equal(await response.text(), "<main>Explicit email confirmation</main>");
  }

  const weakPolicy = "default-src *; frame-ancestors *";
  const app = serverWithRoute(
    () =>
      new Response("Fixture", {
        headers: {
          "Content-Security-Policy": weakPolicy,
          "Referrer-Policy": "unsafe-url",
          "X-Frame-Options": "ALLOWALL",
        },
      }),
  );
  const response = await app.fetch(new Request("https://app.example.test/"), {}, {});
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  const policies = response.headers.get("content-security-policy");
  assert.ok(policies.includes(weakPolicy));
  assert.match(policies, /default-src 'self'/u);
  assert.match(policies, /frame-ancestors 'self'/u);
});
