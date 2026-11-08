import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { adSenseCsp, createCspNonce } from "../../src/lib/adsense-csp.mjs";

const compiled = ts.transpileModule(
  readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function serverWithRoute(fetch, enabled = false) {
  const module = { exports: {} };
  const modules = {
    "./lib/error-page": { renderErrorPage: () => "Fixture error" },
    "./lib/http-security.server": { rejectCrossSiteRequest: () => null },
    "./lib/azure-runtime-env.server": { validateAzureRuntimeEnv: () => {} },
    "./lib/origin-boundary.server": {
      enforceAzureProductionOriginBoundary: () => null,
      normalizeAzureProductionRequest: (request) => request,
    },
    "./lib/runtime-env.server": {
      withRuntimeBindings: (_env, operation) => operation(),
      runtimeEnv: () => (enabled ? "true" : undefined),
    },
    "./lib/adsense-csp.mjs": { adSenseCsp, createCspNonce },
    "@tanstack/react-start/server-entry": { default: { fetch } },
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    URL,
    Headers,
    Request,
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

test("outer fetch permits only same-origin microphone while retaining other device and payment restrictions", async () => {
  const app = serverWithRoute(
    () => new Response("Fixture", { headers: { "Permissions-Policy": "microphone=()" } }),
  );
  const response = await app.fetch(new Request("https://app.example.test/"), {}, {});
  const policy = response.headers.get("permissions-policy");
  assert.equal(
    policy,
    'camera=(), geolocation=(self), microphone=(self), payment=(self "https://checkout.stripe.com" "https://js.stripe.com" "https://*.js.stripe.com" "https://link.com" "https://*.link.com"), usb=()',
  );
  assert.equal(
    policy.split(", ").find((directive) => directive.startsWith("microphone=")),
    "microphone=(self)",
  );
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/u);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("Start middleware permits same-origin microphone and preserves a route's stricter policy", async () => {
  const start = ts.transpileModule(readFileSync("src/start.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const modules = {
    "@tanstack/react-start": {
      createMiddleware: () => ({ server: (handler) => handler }),
      createStart: (factory) => factory(),
    },
    "./lib/adsense-csp.mjs": { adSenseCsp },
    "@/integrations/supabase/auth-attacher": { attachSupabaseAuth: "fixture_auth_attacher" },
    "./lib/error-page": { renderErrorPage: () => "Fixture error" },
    "./lib/http-security.server": { rejectCrossSiteRequest: () => null },
  };
  vm.runInNewContext(start, {
    module,
    exports: module.exports,
    URL,
    Headers,
    Request,
    Response,
    console: { error: () => assert.fail("Unexpected Start middleware failure") },
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected Start dependency: ${name}`);
      return modules[name];
    },
  });
  const middleware = module.exports.startInstance.requestMiddleware[0];
  const invoke = async (headers = {}) =>
    (
      await middleware({
        request: new Request("https://app.example.test/"),
        next: async () => ({ response: new Response("Fixture", { headers }) }),
      })
    ).response;
  const response = await invoke();
  assert.equal(
    response.headers.get("permissions-policy"),
    'camera=(self), geolocation=(self), microphone=(self), payment=(self "https://checkout.stripe.com" "https://js.stripe.com" "https://*.js.stripe.com" "https://link.com" "https://*.link.com")',
  );
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /media-src 'self' blob:/u);
  const restricted = await invoke({ "Permissions-Policy": "microphone=()" });
  assert.equal(restricted.headers.get("permissions-policy"), "microphone=()");
});

test("ad documents use fresh server-owned nonces and cannot enter shared caches", async () => {
  const seen = [];
  const app = serverWithRoute((request) => {
    seen.push(request.headers.get("x-kova-csp-nonce"));
    return new Response("<main>Answer remains unchanged</main>", {
      headers: { "content-type": "text/html", "cache-control": "public, max-age=3600" },
    });
  }, true);
  for (let i = 0; i < 2; i++) {
    const response = await app.fetch(
      new Request("https://app.example.test/", {
        headers: { "x-kova-csp-nonce": "AAAAAAAAAAAAAAAAAAAAAA==" },
      }),
      {},
      {},
    );
    assert.match(seen[i], /^[A-Za-z0-9+/]{22}==$/);
    assert.notEqual(seen[i], "AAAAAAAAAAAAAAAAAAAAAA==");
    assert.ok(response.headers.get("content-security-policy").includes(`'nonce-${seen[i]}'`));
    assert.match(response.headers.get("content-security-policy"), /'strict-dynamic'/);
    assert.doesNotMatch(
      response.headers.get("content-security-policy"),
      /unsafe-eval|script-src 'self'/,
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(await response.text(), "<main>Answer remains unchanged</main>");
  }
  assert.notEqual(seen[0], seen[1]);
});

test("an incoming nonce cannot activate advertising CSP when the feature is disabled", async () => {
  const app = serverWithRoute((request) => {
    assert.equal(request.headers.has("x-kova-csp-nonce"), false);
    return new Response("Fixture");
  });
  const response = await app.fetch(
    new Request("https://app.example.test/", {
      headers: { "x-kova-csp-nonce": "AAAAAAAAAAAAAAAAAAAAAA==" },
    }),
    {},
    {},
  );
  assert.doesNotMatch(
    response.headers.get("content-security-policy"),
    /strict-dynamic|googlesyndication/,
  );
});

test("nonce wrapping preserves streamed prompt bodies and authentication headers", async () => {
  const prompt = JSON.stringify({ message: "Keep this exact prompt", model: "argon" });
  const app = serverWithRoute(async (request) => {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("authorization"), "Bearer synthetic-fixture");
    assert.equal(await request.text(), prompt);
    return new Response("Answer");
  }, true);
  const response = await app.fetch(
    new Request("https://app.example.test/api/chat", {
      method: "POST",
      headers: { authorization: "Bearer synthetic-fixture", "content-type": "application/json" },
      body: prompt,
    }),
    {},
    {},
  );
  assert.equal(await response.text(), "Answer");
});
