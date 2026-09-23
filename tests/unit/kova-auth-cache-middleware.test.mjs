import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as contract from "../../src/lib/kova-auth-contract.mjs";
import * as security from "../../src/lib/auth-security.mjs";
import { digestKovaToken } from "../../src/lib/kova-auth-crypto.server.mjs";

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const principal = (sessionId) => ({
  accountId: "owner",
  sessionId,
  email: "fixture@example.invalid",
  emailVerified: true,
  assuranceLevel: "aal2",
  displayName: null,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
});
const browserSource = transpile(
  readFileSync("src/lib/kova-auth-browser.ts", "utf8").replaceAll("import.meta.env", "TEST_ENV"),
);

function browserFixture() {
  const calls = [];
  const exports = {};
  let version = 1;
  let hold;
  vm.runInNewContext(browserSource, {
    exports,
    Response,
    URL,
    Error,
    TEST_ENV: { VITE_KOVA_AUTH_MODE: "kova" },
    fetch: async (path) => {
      const captured = version;
      calls.push(path);
      if (hold) await hold;
      return Response.json(
        path.endsWith("token")
          ? { accessToken: `token-${captured}`, expiresIn: 300 }
          : { session: principal(`session-${captured}`) },
      );
    },
  });
  return {
    api: exports,
    calls,
    next: () => {
      version++;
    },
    delay: () => {
      let release;
      hold = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        hold = null;
        release();
      };
    },
  };
}

test("MFA cache invalidation discards prior compatibility tokens and cached principals", async () => {
  const f = browserFixture();
  assert.equal(await f.api.getKovaCompatibilityToken(), "token-1");
  assert.equal((await f.api.getCachedKovaSession()).sessionId, "session-1");
  f.next();
  assert.equal(await f.api.getKovaCompatibilityToken(), "token-1");
  assert.equal(f.calls.length, 2);
  f.api.clearKovaAuthCache();
  assert.equal(await f.api.getKovaCompatibilityToken(), "token-2");
  assert.equal((await f.api.getCachedKovaSession()).sessionId, "session-2");
  f.api.setKovaSessionActive(false);
  assert.equal(await f.api.getKovaCompatibilityToken(), null);
});

test("requests started before an MFA change cannot restore stale tokens or principals after cache invalidation", async () => {
  const f = browserFixture();
  const release = f.delay();
  const oldToken = f.api.getKovaCompatibilityToken();
  const oldPrincipal = f.api.getCachedKovaSession();
  // Attach the rejection handler before the deferred response is released.
  const principalRejected = assert.rejects(oldPrincipal, /kova_session_changed/u);
  f.next();
  f.api.clearKovaAuthCache();
  release();
  assert.equal(await oldToken, null);
  await principalRejected;
  assert.equal(await f.api.getKovaCompatibilityToken(), "token-2");
  assert.equal((await f.api.getCachedKovaSession()).sessionId, "session-2");
});

for (const mode of ["kova", "dual"]) {
  test(`${mode}: rejected cookies invalidate cached and in-flight data tokens while retaining owned authority`, async () => {
    const exports = {};
    let held = false;
    let release;
    let tokenCalls = 0;
    vm.runInNewContext(browserSource, {
      exports,
      Response,
      URL,
      Error,
      TEST_ENV: { VITE_KOVA_AUTH_MODE: mode },
      fetch: async (path) => {
        assert.ok(path === "/api/auth/session" || path === "/api/auth/token");
        if (path.endsWith("session")) return new Response(null, { status: 401 });
        tokenCalls++;
        if (held)
          await new Promise((resolve) => {
            release = resolve;
          });
        return Response.json({ accessToken: `token-${tokenCalls}`, expiresIn: 300 });
      },
    });
    assert.equal(await exports.getKovaCompatibilityToken(), "token-1");
    await assert.rejects(exports.fetchKovaSession(), exports.isKovaSessionRejectedError);
    assert.equal(exports.isKovaSessionActive(), true);
    assert.equal(await exports.getCachedKovaSession(), null);
    assert.equal(await exports.getKovaCompatibilityToken(), "token-2");
    exports.clearKovaAuthCache();
    held = true;
    const delayed = exports.getKovaCompatibilityToken();
    await assert.rejects(exports.fetchKovaSession(), exports.isKovaSessionRejectedError);
    release();
    assert.equal(await delayed, null);
    assert.equal(exports.isKovaSessionActive(), true);
  });
}

test("a session response body delayed across credential invalidation cannot restore the old principal", async () => {
  const exports = {};
  let release;
  const body = new Promise((resolve) => {
    release = resolve;
  });
  vm.runInNewContext(browserSource, {
    exports,
    Response,
    URL,
    Error,
    TEST_ENV: { VITE_KOVA_AUTH_MODE: "kova" },
    fetch: async () => ({ ok: true, status: 200, json: () => body }),
  });
  const delayed = exports.fetchKovaSession();
  const rejected = assert.rejects(delayed, /kova_session_changed/u);
  await Promise.resolve();
  exports.clearKovaAuthCache();
  release({ session: principal("old-body") });
  await rejected;
});

test("provider-neutral function middleware forwards only an authoritative principal and propagates denial without a legacy fallback", async () => {
  const source = transpile(readFileSync("src/integrations/supabase/auth-middleware.ts", "utf8"));
  for (const result of [
    null,
    new Response(null, { status: 401 }),
    new Response(null, { status: 403 }),
    new Response(null, { status: 503 }),
    { userId: "kova-owner", supabaseUser: { identity: "owned" }, claims: { aal: "aal2" } },
  ]) {
    const calls = [];
    const exports = {};
    const modules = {
      "@tanstack/react-start": { createMiddleware: () => ({ server: (run) => run }) },
      "@tanstack/react-start/server": {
        getRequest: () => new Request("https://kova.test/api/work"),
      },
      "@/lib/api-auth.server": {
        optionalUser: async () => {
          calls.push("authority");
          return result;
        },
      },
    };
    vm.runInNewContext(source, {
      exports,
      Response,
      require: (name) => {
        assert.ok(Object.hasOwn(modules, name));
        return modules[name];
      },
    });
    const run = exports.requireSupabaseAuth({
      next: async (value) => {
        calls.push("next");
        return value;
      },
    });
    if (!result || result instanceof Response) {
      await assert.rejects(
        run,
        (error) =>
          error instanceof Response &&
          error.status === (result?.status ?? 401) &&
          error.headers.get("Cache-Control") === "no-store",
      );
      assert.deepEqual(calls, ["authority"]);
    } else {
      const value = await run;
      assert.equal(value.context.userId, "kova-owner");
      assert.equal(value.context.supabase.identity, "owned");
      assert.deepEqual(calls, ["authority", "next"]);
    }
  }
});

test("a preferred owned credential never reaches Supabase Auth or creates an admin client on denial", async () => {
  const source = transpile(readFileSync("src/lib/api-auth.server.ts", "utf8"));
  for (const behavior of ["denied", "outage", "valid"]) {
    const calls = [];
    const exports = {};
    const modules = {
      "@supabase/supabase-js": {
        createClient: (_url, key) => {
          calls.push(key);
          return {
            auth: {
              getUser: () => {
                throw Error("Unexpected legacy fallback");
              },
            },
          };
        },
      },
      "@/lib/billing-entitlement.server": {},
      "@/lib/auth-security.mjs": security,
      "@/lib/kova-auth-contract.mjs": { ...contract, resolveKovaAuthMode: () => "dual" },
      "@/lib/kova-auth-crypto.server.mjs": {
        digestKovaToken,
        signKovaCompatibilityJwt: () => "local-test-jwt",
      },
      "@/lib/kova-auth-store.server": {
        resolveSession: async () => {
          calls.push("owned-authority");
          if (behavior === "outage") throw Error("database unavailable");
          return behavior === "valid" ? principal("verified-session") : null;
        },
      },
    };
    vm.runInNewContext(source, {
      exports,
      Response,
      Error,
      process: {
        env: {
          SUPABASE_URL: "https://local.invalid",
          SUPABASE_PUBLISHABLE_KEY: "publishable",
          SUPABASE_SERVICE_ROLE_KEY: "admin",
        },
      },
      console: { error() {} },
      require: (name) => {
        assert.ok(Object.hasOwn(modules, name));
        return modules[name];
      },
    });
    const request = new Request("https://kova.test/api/private", {
      headers: {
        Cookie: `__Host-kova_session=${"K".repeat(43)}`,
        Authorization: "Bearer valid-looking-legacy-token",
      },
    });
    const result = await exports.optionalUser(request);
    if (behavior === "valid") {
      assert.equal(result.authProvider, "kova");
      assert.equal(result.userId, "owner");
      assert.deepEqual(calls, ["owned-authority", "publishable", "admin"]);
    } else {
      assert.equal(result.status, behavior === "denied" ? 401 : 503);
      assert.deepEqual(calls, ["owned-authority"]);
    }
  }
});

test("dual-mode bearer admission rechecks owned retirement after hosted verification and fails closed on every unavailable result", async () => {
  const source = transpile(readFileSync("src/lib/api-auth.server.ts", "utf8"));
  const owner = "10000000-0000-4000-8000-000000000001";
  for (const scenario of [
    "allowed",
    "retired",
    "malformed",
    "error",
    "thrown",
    "invalid-hosted",
    "kova-marked",
    "kova-zero",
    "kova-null",
    "kova-string",
  ]) {
    const calls = [];
    const exports = {};
    const modules = {
      "@supabase/supabase-js": {
        createClient: (_url, key) => {
          calls.push(key);
          if (key === "admin")
            return {
              rpc: async (name, args) => {
                calls.push("retirement");
                assert.equal(name, "kova_auth_legacy_session_allowed");
                assert.equal(args.p_account_id, owner);
                if (scenario === "thrown") throw Error("private upstream diagnostic");
                if (scenario === "error")
                  return { error: { message: "private upstream diagnostic" } };
                return {
                  data: scenario === "allowed" ? true : scenario === "malformed" ? "true" : false,
                };
              },
            };
          return {
            auth: {
              getUser: async () => {
                calls.push("verified-user");
                return scenario === "invalid-hosted"
                  ? { error: {} }
                  : {
                      data: { user: { id: owner, email_confirmed_at: "2026-01-01T00:00:00Z" } },
                    };
              },
              getClaims: async () => {
                calls.push("verified-claims");
                const claims = { sub: owner, aal: "aal1" };
                if (scenario.startsWith("kova-"))
                  claims.kova_auth = {
                    "kova-marked": 1,
                    "kova-zero": 0,
                    "kova-null": null,
                    "kova-string": "1",
                  }[scenario];
                return { data: { claims } };
              },
            },
          };
        },
      },
      "@/lib/billing-entitlement.server": {},
      "@/lib/auth-security.mjs": security,
      "@/lib/kova-auth-contract.mjs": { ...contract, resolveKovaAuthMode: () => "dual" },
      "@/lib/kova-auth-crypto.server.mjs": {},
      "@/lib/kova-auth-store.server": { resolveSession: () => assert.fail("not an owned cookie") },
    };
    vm.runInNewContext(source, {
      exports,
      Response,
      Error,
      process: {
        env: {
          SUPABASE_URL: "https://fixture.invalid",
          SUPABASE_PUBLISHABLE_KEY: "publishable",
          SUPABASE_SERVICE_ROLE_KEY: "admin",
        },
      },
      console: { error: () => assert.fail("no private errors in logs") },
      require: (name) => {
        assert.ok(Object.hasOwn(modules, name));
        return modules[name];
      },
    });
    const result = await exports.optionalUser(
      new Request("https://kova.test/api/private", {
        headers: { Authorization: "Bearer verified-hosted-fixture" },
      }),
    );
    if (scenario === "allowed") {
      assert.equal(result.userId, owner);
      assert.equal(result.authProvider, "supabase");
    } else {
      assert.equal(result.status, ["error", "thrown"].includes(scenario) ? 503 : 401, scenario);
      assert.equal(result.headers.get("Cache-Control"), "no-store");
      assert.ok(!(await result.text()).includes("private upstream"));
    }
    assert.deepEqual(
      calls,
      scenario === "invalid-hosted" || scenario.startsWith("kova-")
        ? ["publishable", "verified-user", "verified-claims"]
        : ["publishable", "verified-user", "verified-claims", "admin", "retirement"],
    );
  }
});

test("all cookie-authenticated mutations reject cross-origin or unproven browser origin before creating any client", async (t) => {
  const source = transpile(readFileSync("src/lib/api-auth.server.ts", "utf8"));
  for (const mode of ["dual", "kova"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const [label, headers] of [
        ["sibling", { Origin: "https://untrusted.kova.test", "Sec-Fetch-Site": "same-site" }],
        ["foreign", { Origin: "https://attacker.invalid" }],
        ["opaque", { Origin: "null" }],
        ["missing", {}],
        ["contradictory", { Origin: "https://attacker.invalid", "Sec-Fetch-Site": "same-origin" }],
      ]) {
        await t.test(`${mode} ${method} ${label}`, async () => {
          const exports = {};
          const modules = {
            "@supabase/supabase-js": {
              createClient: () => assert.fail("no clients before origin proof"),
            },
            "@/lib/billing-entitlement.server": {},
            "@/lib/auth-security.mjs": security,
            "@/lib/kova-auth-contract.mjs": { ...contract, resolveKovaAuthMode: () => mode },
            "@/lib/kova-auth-crypto.server.mjs": {
              digestKovaToken: () => assert.fail("no credential use"),
            },
            "@/lib/kova-auth-store.server": {
              resolveSession: () => assert.fail("no database use"),
            },
          };
          vm.runInNewContext(source, {
            exports,
            Response,
            Error,
            process: { env: {} },
            require: (name) => {
              assert.ok(Object.hasOwn(modules, name));
              return modules[name];
            },
          });
          const response = await exports.requireUser(
            new Request("https://kova.test/api/security/lockdown", {
              method,
              headers: {
                ...headers,
                Cookie: `__Host-kova_session=${"K".repeat(43)}`,
                "Content-Type": "text/plain",
              },
              body: JSON.stringify({ enabled: false }),
            }),
          );
          assert.equal(response.status, 403);
          assert.equal(response.headers.get("Cache-Control"), "no-store");
        });
      }
    }
  }
});
