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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
      : { KOVA_AUTH_PASSWORD_HASH_WRITE: options.writeAlgorithm ?? "argon2id" }),
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
      return { data: [{ email, primary_ready: false, legacy_mfa: true }], error: null };
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
    "@/lib/kova-auth-proxy-origin.mjs": { kovaAuthRequestUrl: (request) => new URL(request.url) },
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
    "@/lib/chat-ingress.server.mjs": { resolveAnonymousClientKey: () => "fixture-client" },
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
            data: { user: { id: account, email, email_confirmed_at: "2026-10-19T00:00:00Z" } },
            error: null,
          }),
          getClaims: async () => ({
            data: { claims: { sub: account, role: "authenticated", aal: "aal2" } },
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

test("a completed legacy short-password login creates one session then performs bound Argon2id CAS", async () => {
  const app = harness();
  const result = await app.handleKovaLogin(loginRequest());
  assert.equal(result.status, 200);
  assert.deepEqual(names(app), [
    "kova_auth_password_lookup",
    "kova_auth_create_session",
    "kova_auth_upgrade_password_hash",
  ]);
  const created = app.calls[1][1],
    upgraded = app.calls[2][1];
  assert.equal(upgraded.p_account_id, account);
  assert.equal(upgraded.p_credential_id, credentialId);
  assert.equal(upgraded.p_credential_revision, 7);
  assert.equal(upgraded.p_old_password_hash, legacyHash);
  assert.equal(upgraded.p_session_digest_hex, created.p_token_digest_hex);
  assert.match(upgraded.p_new_password_hash, /^\$argon2id\$/);
  assert.equal(
    await passwordCrypto.verifyKovaPassword(password, upgraded.p_new_password_hash),
    true,
  );
  assert.equal(app.logs.length, 0);
});

test("bad credentials and unknown email never create a session or upgrade; absent account uses expensive dummy", async () => {
  const wrong = harness();
  const response = await wrong.handleKovaLogin(request({ email, password: "wrong" }));
  assert.equal(response.status, 401);
  assert.deepEqual(names(wrong), ["kova_auth_password_lookup"]);
  let dummy;
  const absent = harness({
    rpc: (name) => (name === "kova_auth_password_lookup" ? { data: [], error: null } : undefined),
    crypto: {
      verifyKovaPassword: async (value, encoded) => {
        dummy = encoded;
        return passwordCrypto.verifyKovaPassword(value, encoded);
      },
    },
  });
  assert.equal((await absent.handleKovaLogin(loginRequest())).status, 401);
  assert.match(dummy, /^scrypt-v1\$32768\$8\$1\$/);
  assert.deepEqual(names(absent), ["kova_auth_password_lookup"]);
});

test("MFA-pending login neither rehashes nor persists a hash nor mints a session", async () => {
  const app = harness({
    credential: { mfa_required: true },
    crypto: {
      rehashKovaPassword: () => {
        throw new Error("must not retain password");
      },
    },
  });
  assert.equal((await app.handleKovaLogin(loginRequest())).status, 202);
  assert.deepEqual(names(app), ["kova_auth_password_lookup", "kova_auth_begin_mfa_login"]);
  assert.equal(JSON.stringify(app.calls).includes(password), false);
});

test("current Argon2id login does not rehash and CAS false does not mint a replacement session", async () => {
  const argon = await passwordCrypto.rehashKovaPassword(password);
  const current = harness({ credential: { password_hash: argon } });
  assert.equal((await current.handleKovaLogin(loginRequest())).status, 200);
  assert.deepEqual(names(current), ["kova_auth_password_lookup", "kova_auth_create_session"]);
  const raced = harness({
    rpc: (name) =>
      name === "kova_auth_upgrade_password_hash" ? { data: false, error: null } : undefined,
  });
  assert.equal((await raced.handleKovaLogin(loginRequest())).status, 200);
  assert.equal(names(raced).filter((name) => name === "kova_auth_create_session").length, 1);
  assert.equal(raced.logs.length, 0);
});

test("optional upgrade failure preserves valid login and logs only a fixed event without secrets", async () => {
  const secret = "fixture-internal-secret-never-log";
  for (const failure of ["rpc", "capacity", "infrastructure"]) {
    const app = harness({
      rpc: (name) =>
        name === "kova_auth_upgrade_password_hash" && failure === "rpc"
          ? { data: null, error: { code: "P0001", message: secret } }
          : undefined,
      crypto:
        failure === "rpc"
          ? {}
          : {
              rehashKovaPassword: async () => {
                throw failure === "capacity"
                  ? new passwordCrypto.KovaPasswordCapacityError()
                  : new passwordCrypto.KovaPasswordInfrastructureError();
              },
            },
    });
    const response = await app.handleKovaLogin(loginRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(app.logs, [
      ["[KovaAuth] Password hash upgrade deferred", { code: "kova_password_upgrade_deferred" }],
    ]);
    assert.equal(JSON.stringify(app.logs).includes(secret), false);
    assert.equal(JSON.stringify(app.logs).includes(legacyHash), false);
    if (failure !== "rpc")
      assert.equal(names(app).includes("kova_auth_upgrade_password_hash"), false);
  }
});

test("capacity and infrastructure before credential verification return 503 without a session or CAS", async () => {
  for (const ErrorType of [
    passwordCrypto.KovaPasswordCapacityError,
    passwordCrypto.KovaPasswordInfrastructureError,
  ]) {
    const app = harness({
      crypto: {
        verifyKovaPassword: async () => {
          throw new ErrorType();
        },
      },
    });
    const response = await app.handleKovaLogin(loginRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(names(app), ["kova_auth_password_lookup"]);
  }
});

test("signup and reset classify hash capacity/infrastructure as 503 before mutating; invalid password remains 400", async () => {
  for (const error of [
    new passwordCrypto.KovaPasswordCapacityError(),
    new passwordCrypto.KovaPasswordInfrastructureError(),
    new RangeError("fixture-invalid"),
  ]) {
    for (const [handler, body] of [
      ["handleKovaSignup", { email, password: "long-password-fixture" }],
      ["handleKovaRecoveryReset", { token: "T".repeat(43), password: "long-password-fixture" }],
    ]) {
      const app = harness({
        crypto: {
          hashKovaPassword: async () => {
            throw error;
          },
        },
      });
      const response = await app[handler](request(body));
      assert.equal(response.status, error instanceof RangeError ? 400 : 503);
      assert.equal(app.calls.length, 0);
    }
  }
});

test("signup writes Argon2id through existing transaction and preserves email expiry binding", async () => {
  const app = harness({
    rpc: (name, args) =>
      name === "kova_auth_create_compatibility_principal"
        ? { data: account, error: null }
        : name === "kova_auth_create_password_account"
          ? {
              data: [{ account_id: account, candidate_used: true, verification_created: true }],
              error: null,
            }
          : undefined,
  });
  const response = await app.handleKovaSignup(
    request({ email, password: "long-password-fixture" }),
  );
  assert.equal(response.status, 202);
  const args = app.calls.find(([name]) => name === "kova_auth_create_password_account")[1];
  assert.match(args.p_password_hash, /^\$argon2id\$/);
  assert.equal(
    await passwordCrypto.verifyKovaPassword("long-password-fixture", args.p_password_hash),
    true,
  );
  assert.ok(
    args.p_email_payload.text.includes(
      args.p_verification_expires_at.replace("T", " ").replace(/\.\d{3}Z$/, " UTC"),
    ),
  );
});

test("password change and legacy MFA adoption map hash failures to 503 without mutation", async () => {
  for (const ErrorType of [
    passwordCrypto.KovaPasswordCapacityError,
    passwordCrypto.KovaPasswordInfrastructureError,
  ]) {
    const change = harness({
      crypto: {
        hashKovaPassword: async () => {
          throw new ErrorType();
        },
      },
    });
    assert.equal(
      (
        await change.handleKovaPasswordChange(
          request({ currentPassword: password, newPassword: "long-password-fixture" }),
        )
      ).status,
      503,
    );
    assert.equal(names(change).includes("kova_auth_change_password"), false);
    const adopt = harness({
      mode: "dual",
      crypto: {
        hashKovaPassword: async () => {
          throw new ErrorType();
        },
      },
    });
    const response = await adopt.handleKovaMfaEnroll(
      request(
        { legacyMigration: true, newPassword: "long-password-fixture" },
        { Authorization: `Bearer ${"A".repeat(16)}.${"B".repeat(16)}.${"C".repeat(16)}` },
      ),
    );
    assert.equal(response.status, 503);
    assert.equal(names(adopt).includes("kova_auth_begin_legacy_mfa_migration"), false);
  }
});

test("store upgrade requires boolean reply, and a failed revision-bound session prevents rehash", async () => {
  const malformed = harness({
    rpc: (name) =>
      name === "kova_auth_upgrade_password_hash" ? { data: "false", error: null } : undefined,
  });
  await assert.rejects(
    malformed.store.upgradePasswordHash({
      accountId: account,
      credentialId,
      credentialRevision: 7,
      oldPasswordHash: legacyHash,
      newPasswordHash: "fixture",
      sessionDigest: "a".repeat(64),
    }),
    /kova_auth_upgrade_password_hash/,
  );
  const app = harness({
    rpc: (name) =>
      name === "kova_auth_create_session"
        ? { data: null, error: { code: "P0001", message: "fixture credential race" } }
        : undefined,
    crypto: {
      rehashKovaPassword: () => {
        throw new Error("must not run");
      },
    },
  });
  assert.equal((await app.handleKovaLogin(loginRequest())).status, 503);
  assert.deepEqual(names(app), ["kova_auth_password_lookup", "kova_auth_create_session"]);
});

test("default and explicit legacy writer disable CAS while dual-reader accepts an Argon credential", async () => {
  for (const writeAlgorithm of [null, "scrypt-v1"]) {
    const legacy = harness({ writeAlgorithm });
    assert.equal((await legacy.handleKovaLogin(loginRequest())).status, 200);
    assert.deepEqual(names(legacy), ["kova_auth_password_lookup", "kova_auth_create_session"]);
    const argon = await passwordCrypto.rehashKovaPassword(password);
    const current = harness({ writeAlgorithm, credential: { password_hash: argon } });
    assert.equal((await current.handleKovaLogin(loginRequest())).status, 200);
    assert.deepEqual(names(current), ["kova_auth_password_lookup", "kova_auth_create_session"]);
  }
});

test("invalid optional-upgrade writer config preserves login and records only fixed deferred event", async () => {
  const app = harness({ writeAlgorithm: "unsupported-fixture-mode" });
  assert.equal((await app.handleKovaLogin(loginRequest())).status, 200);
  assert.deepEqual(names(app), ["kova_auth_password_lookup", "kova_auth_create_session"]);
  assert.deepEqual(app.logs, [
    ["[KovaAuth] Password hash upgrade deferred", { code: "kova_password_upgrade_deferred" }],
  ]);
});

test("default signup writes legacy until explicit Argon rollout; invalid writer returns 503 before mutation", async () => {
  const signupRpc = (name) =>
    name === "kova_auth_create_compatibility_principal"
      ? { data: account, error: null }
      : name === "kova_auth_create_password_account"
        ? {
            data: [{ account_id: account, candidate_used: true, verification_created: true }],
            error: null,
          }
        : undefined;
  const legacy = harness({ writeAlgorithm: null, rpc: signupRpc });
  assert.equal(
    (await legacy.handleKovaSignup(request({ email, password: "long-password-fixture" }))).status,
    202,
  );
  const args = legacy.calls.find(([name]) => name === "kova_auth_create_password_account")[1];
  assert.match(args.p_password_hash, /^scrypt-v1\$/);
  assert.equal(
    await passwordCrypto.verifyKovaPassword("long-password-fixture", args.p_password_hash),
    true,
  );
  const invalid = harness({ writeAlgorithm: "unsupported-fixture-mode", rpc: signupRpc });
  assert.equal(
    (await invalid.handleKovaSignup(request({ email, password: "long-password-fixture" }))).status,
    503,
  );
  assert.equal(invalid.calls.length, 0);
});
