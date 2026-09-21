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
      assert.equal(result.userId, "owner");
      assert.deepEqual(calls, ["owned-authority", "publishable", "admin"]);
    } else {
      assert.equal(result.status, behavior === "denied" ? 401 : 503);
      assert.deepEqual(calls, ["owned-authority"]);
    }
  }
});
