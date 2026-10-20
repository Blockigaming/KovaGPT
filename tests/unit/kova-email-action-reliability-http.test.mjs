import assert from "node:assert/strict";
import test from "node:test";
import * as nodeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as passwordCrypto from "../../src/lib/kova-auth-crypto.server.mjs";
import { renderKovaAuthEmail } from "../../src/lib/kova-auth-email.server.mjs";

const root = new URL("../../", import.meta.url);
const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const httpSource = compile("src/lib/kova-auth-http.server.ts");
const storeSource = compile("src/lib/kova-auth-store.server.ts");
const account = "12345678-1234-1234-1234-123456789abc";
const credentialId = "23456789-1234-1234-1234-123456789abc";
const session = "34567890-1234-1234-1234-123456789abc";
const email = "fixture-owner@example.test";
const password = "tiny";
const salt = Buffer.alloc(16, 7);
const legacyHash = `scrypt-v1$32768$8$1$${salt.toString("base64url")}$${nodeCrypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url")}`;
const principal = (overrides = {}) => ({
  account_id: account,
  session_id: session,
  email,
  email_verified: true,
  assurance_level: "aal1",
  ...overrides,
});
const credential = (overrides = {}) => ({
  account_id: account,
  credential_id: credentialId,
  credential_revision: 7,
  password_hash: legacyHash,
  email,
  mfa_required: false,
  ...overrides,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

// Actual transpiled HTTP/store and actual Argon2id/scrypt password implementation.
// External RPC, rate-limit transport and local HTTP utility seams are fixtures;
// this harness does not claim cookie, CSRF or full-stack acceptance.
function harness(options = {}) {
  const calls = [],
    logs = [];
  // A fixture config object selects the writer. No live process/service config changes.
  const env = {
    KOVA_AUTH_PUBLIC_ORIGIN: "https://app.example.test",
    KOVA_EMAIL_QUEUE_ENABLED: "true",
    ...(options.writeAlgorithm === null
      ? {}
      : {
          KOVA_AUTH_PASSWORD_HASH_WRITE: options.writeAlgorithm ?? "argon2id",
        }),
  };

  const rpc = async (name, args) => {
    calls.push([name, plain(args)]);
    if (options.rpc) {
      const result = await options.rpc(name, args);
      if (result !== undefined) return result;
    }
    if (name === "kova_auth_password_lookup")
      return { data: [credential(options.credential)], error: null };
    if (name === "kova_auth_create_session" || name === "kova_auth_resolve_session")
      return { data: [principal()], error: null };
    if (name === "kova_auth_upgrade_password_hash") return { data: true, error: null };
    if (name === "kova_auth_begin_mfa_login")
      return {
        data: [{ factor_id: "factor-fixture", secret_envelope: "encrypted-fixture" }],
        error: null,
      };
    if (name === "kova_auth_has_verified_legacy_mfa") return { data: true, error: null };
    if (name === "kova_auth_legacy_mfa_migration_status")
      return {
        data: [{ email, primary_ready: false, legacy_mfa: true }],
        error: null,
      };
    throw new Error(`Unexpected fixture RPC: ${name}`);
  };
  const modules = {
    "node:crypto": nodeCrypto,
    "@/lib/kova-auth-crypto.server.mjs": {
      ...passwordCrypto,
      hashKovaPassword: (password) => passwordCrypto.hashKovaPassword(password, env),
      ...options.crypto,
    },
    "@/lib/kova-auth-email.server.mjs": { renderKovaAuthEmail },
    "@/lib/kova-auth-proxy-origin.mjs": {
      kovaAuthRequestUrl: (request) => new URL(request.url),
    },
    "@/lib/s6-owner-relay.mjs": { s6GoogleIdentityAllowed: () => false },
    "@/lib/kova-auth-contract.mjs": {
      resolveKovaAuthMode: () => options.mode ?? "kova",
      kovaAuthEnabled: () => true,
      parseCookieHeader: () => new Map(),
      readKovaSessionToken: () => ({ ok: true, token: "S".repeat(43) }),
      serializeKovaSessionCookie: (token) => `__Host-kova_session=${token}; Secure; HttpOnly`,
      clearKovaSessionCookie: () => "__Host-kova_session=; Max-Age=0",
    },
    "@/lib/auth-security.mjs": {
      isCrossSiteMutation: (request, origin) => request.headers.get("origin") !== origin,
      parseBearerToken: (value) => (value.startsWith("Bearer ") ? value.slice(7) : null),
      safeRelativeRedirect: () => "/",
    },
    "@/lib/chat-ingress.server.mjs": {
      resolveAnonymousClientKey: () => "fixture-client",
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/endpoint-reliability.mjs": {
      BodyReadError: class extends Error {},
      readUtf8BodyBounded: (request) => request.text(),
    },
    "@/integrations/supabase/client.server": {
      supabaseAdmin: {
        rpc,
        auth: {
          getUser: async () => ({
            data: {
              user: {
                id: account,
                email,
                email_confirmed_at: "2026-10-19T00:00:00Z",
              },
            },
            error: null,
          }),
          getClaims: async () => ({
            data: {
              claims: { sub: account, role: "authenticated", aal: "aal2" },
            },
            error: null,
          }),
        },
      },
    },
  };
  const load = (source) => {
    const exports = {};
    vm.runInNewContext(source, {
      exports,
      Request,
      Response,
      Headers,
      URL,
      URLSearchParams,
      Buffer,
      Date,
      TextDecoder,
      Error,
      TypeError,
      AbortSignal,
      process: { env },
      console: { error: (...args) => logs.push(plain(args)) },
      fetch: () => {
        throw new Error("External network forbidden in fixture");
      },
      require: (name) => {
        assert.ok(Object.hasOwn(modules, name), name);
        return modules[name];
      },
    });
    return exports;
  };
  const store = load(storeSource);
  modules["@/lib/kova-auth-store.server"] = store;
  return { ...load(httpSource), store, calls, logs };
}
const request = (body, headers = {}) =>
  new Request("https://app.example.test/api/auth/password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://app.example.test",
      "X-Kova-Owner": account,
      "X-Kova-Session": session,
      ...headers,
    },
    body: JSON.stringify(body),
  });
const loginRequest = () => request({ email, password });
const names = (app) => app.calls.map(([name]) => name);

const actionToken = "T".repeat(43);
const verificationGet = (query = `token=${actionToken}`) =>
  new Request(`https://app.example.test/api/auth/verify?${query}`);
const verificationPost = (form = `token=${actionToken}`) =>
  new Request("https://app.example.test/api/auth/verify", {
    method: "POST",
    headers: {
      Origin: "https://app.example.test",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
const resetRequest = () => request({ token: actionToken, password: "long-password-fixture" });
const recoveryRpc = (override) => (name, args) => {
  const custom = override?.(name, args);
  if (custom !== undefined) return custom;
  if (name === "kova_auth_recovery_target") return { data: account, error: null };
  if (name === "kova_auth_has_verified_legacy_mfa") return { data: false, error: null };
  if (name === "kova_auth_consume_recovery") return { data: [principal()], error: null };
};
const assertPrivate = (response) => {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
};

test("scanner GET renders explicit verification form without consuming proof and keeps privacy controls", async () => {
  const app = harness();
  const response = await app.handleKovaVerification(verificationGet());
  assert.equal(response.status, 200);
  assert.equal(app.calls.length, 0);
  assertPrivate(response);
  assert.match(response.headers.get("content-security-policy"), /form-action 'self'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const body = await response.text();
  assert.match(body, /<form method="post" action="\/api\/auth\/verify">/);
  assert.doesNotMatch(body, /<script|http-equiv="refresh"/);
  assert.equal(response.headers.has("set-cookie"), false);
});

test("malformed or duplicate verification proofs are rejected without database consumption", async () => {
  for (const req of [
    verificationGet("token=bad"),
    verificationGet(`token=${actionToken}&token=${actionToken}`),
    verificationPost("token=bad"),
    verificationPost(`token=${actionToken}&token=${actionToken}`),
    verificationPost(`token=${actionToken}&next=/chat`),
  ]) {
    const app = harness();
    const response = await app.handleKovaVerification(req);
    assert.equal(response.status, 303);
    assert.equal(app.calls.length, 0);
    assertPrivate(response);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.origin, "https://app.example.test");
    assert.equal(location.searchParams.get("auth_error"), "invalid_verification");
    assert.equal(location.searchParams.has("token"), false);
  }
});

test("confirmed verification stays successful when cleanup fails and never publishes its transient session", async () => {
  for (const cleanupFails of [false, true]) {
    const app = harness({
      rpc: (name) =>
        name === "kova_auth_consume_verification"
          ? { data: [principal()], error: null }
          : name === "kova_auth_revoke_session"
            ? cleanupFails
              ? {
                  data: null,
                  error: { code: "08006", message: "fixture secret" },
                }
              : { data: true, error: null }
            : undefined,
    });
    const response = await app.handleKovaVerification(verificationPost());
    assert.equal(response.status, 303);
    assert.deepEqual(names(app), ["kova_auth_consume_verification", "kova_auth_revoke_session"]);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.searchParams.get("verified"), "1");
    assert.equal(location.searchParams.get("sign-in"), "1");
    assert.equal(response.headers.has("set-cookie"), false);
    assertPrivate(response);
    assert.equal(JSON.stringify(app.logs).includes("fixture secret"), false);
  }
});

test("invalid verification POST redirects; ambiguous transport or reply failure offers explicit retry with503", async () => {
  for (const [kind, status] of [
    ["invalid", 303],
    ["transport", 503],
    ["malformed", 503],
    ["audit", 503],
    ["parameter", 503],
  ]) {
    const app = harness({
      rpc: (name) => {
        if (name !== "kova_auth_consume_verification") return undefined;
        if (kind === "transport") throw new Error("fixture secret bearer must not render");
        return kind === "invalid"
          ? {
              data: null,
              error: { code: "KVA01", message: "fixture invalid proof" },
            }
          : kind === "parameter"
            ? {
                data: null,
                error: {
                  code: "22023",
                  message: "fixture secret parameter failure",
                },
              }
            : kind === "audit"
              ? {
                  data: null,
                  error: {
                    code: "P0001",
                    message: "fixture secret audit failure",
                  },
                }
              : { data: null, error: null };
      },
    });
    const response = await app.handleKovaVerification(verificationPost());
    assert.equal(response.status, status);
    assertPrivate(response);
    assert.deepEqual(names(app), ["kova_auth_consume_verification"]);
    assert.equal(response.headers.has("set-cookie"), false);
    if (status === 503) {
      const body = await response.text();
      assert.match(body, /may already be verified/);
      assert.match(body, /Try signing in/);
      assert.match(body, /Retry verification/);
      assert.match(body, /<form method="post" action="\/api\/auth\/verify">/);
      assert.doesNotMatch(body, /fixture secret|<script|http-equiv="refresh"/);
      assert.equal(response.headers.has("location"), false);
      assert.match(response.headers.get("content-security-policy"), /form-action 'self'/);
    }
  }
});

test("recovery rejects malformed input and missing or consumed proof without a session", async () => {
  const bad = harness();
  assert.equal(
    (
      await bad.handleKovaRecoveryReset(
        request({ token: "bad", password: "long-password-fixture" }),
      )
    ).status,
    400,
  );
  assert.equal(bad.calls.length, 0);
  const missing = harness({
    rpc: recoveryRpc((name) =>
      name === "kova_auth_recovery_target" ? { data: null, error: null } : undefined,
    ),
  });
  const response = await missing.handleKovaRecoveryReset(resetRequest());
  assert.equal(response.status, 400);
  assertPrivate(response);
  assert.deepEqual(names(missing), ["kova_auth_recovery_target"]);
  assert.equal(response.headers.has("set-cookie"), false);
});

test("known recovery rejection remains400 while transport, infrastructure and malformed post-commit reply are503", async () => {
  for (const kind of ["invalid", "transport", "database", "malformed", "audit", "parameter"]) {
    const app = harness({
      rpc: recoveryRpc((name) => {
        if (name !== "kova_auth_consume_recovery") return undefined;
        if (kind === "transport") throw new Error("fixture secret from lost reply");
        return kind === "invalid"
          ? {
              data: null,
              error: { code: "KVA01", message: "fixture invalid proof" },
            }
          : kind === "database"
            ? {
                data: null,
                error: { code: "08006", message: "fixture secret from DB" },
              }
            : kind === "parameter"
              ? {
                  data: null,
                  error: {
                    code: "22023",
                    message: "fixture secret parameter failure",
                  },
                }
              : kind === "audit"
                ? {
                    data: null,
                    error: {
                      code: "P0001",
                      message: "fixture secret audit failure",
                    },
                  }
                : { data: [], error: null };
      }),
    });
    const response = await app.handleKovaRecoveryReset(resetRequest());
    assert.equal(response.status, kind === "invalid" ? 400 : 503);
    assertPrivate(response);
    assert.equal(names(app).filter((name) => name === "kova_auth_consume_recovery").length, 1);
    assert.equal(response.headers.has("set-cookie"), false);
    const body = await response.text();
    assert.doesNotMatch(body, /fixture secret/);
    if (kind !== "invalid") {
      assert.match(body, /may have completed/);
      assert.match(body, /signing in with your new password/);
      assert.deepEqual(app.logs, [
        ["[KovaAuth] Recovery reset unconfirmed", { code: "kova_recovery_reset_unconfirmed" }],
      ]);
    }
  }
});

test("successful recovery returns one session; explicit same-token replay is atomically rejected by source authority", async () => {
  let consumed = false;
  const app = harness({
    rpc: recoveryRpc((name) => {
      if (name === "kova_auth_recovery_target")
        return { data: consumed ? null : account, error: null };
      if (name === "kova_auth_consume_recovery") {
        consumed = true;
        return { data: [principal()], error: null };
      }
    }),
  });
  const first = await app.handleKovaRecoveryReset(resetRequest());
  assert.equal(first.status, 200);
  assertPrivate(first);
  assert.equal(first.headers.has("set-cookie"), true);
  const second = await app.handleKovaRecoveryReset(resetRequest());
  assert.equal(second.status, 400);
  assert.equal(second.headers.has("set-cookie"), false);
  assert.equal(names(app).filter((name) => name === "kova_auth_consume_recovery").length, 1);
});

test("recovery lookup failures are503 and invalid-address request stays enumeration-conscious", async () => {
  const unavailable = harness({
    rpc: recoveryRpc((name) =>
      name === "kova_auth_recovery_target"
        ? {
            data: null,
            error: { code: "08006", message: "fixture private DB failure" },
          }
        : undefined,
    ),
  });
  assert.equal((await unavailable.handleKovaRecoveryReset(resetRequest())).status, 503);
  assert.equal(names(unavailable).includes("kova_auth_consume_recovery"), false);
  const invalid = harness();
  const response = await invalid.handleKovaRecoveryRequest(request({ email: "invalid" }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(invalid.calls.length, 0);
});
