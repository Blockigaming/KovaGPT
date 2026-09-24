import assert from "node:assert/strict";
import * as nodeCrypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import * as contract from "../../src/lib/kova-auth-contract.mjs";
import * as crypto from "../../src/lib/kova-auth-crypto.server.mjs";
import * as security from "../../src/lib/auth-security.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";

const compile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const storeSource = compile("src/lib/kova-auth-store.server.ts");
const httpSource = compile("src/lib/kova-auth-http.server.ts");
const owner = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000002";
const cookieToken = "S".repeat(43);
const row = (changes = {}) => ({
  account_id: owner,
  session_id: sessionId,
  email: "fixture@example.invalid",
  email_verified: true,
  assurance_level: "aal2",
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  ...changes,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

// Execute the actual TypeScript handler and store; the only default substitutes
// are the external RPC transport and rate-limit backend. Crypto/cookies/body
// parsing/CSRF checks remain real. One test below replaces the RPC transport
// with actual PostgreSQL functions in PGlite, rather than expected-result mocks.
function fixture(options = {}) {
  const calls = [];
  const logs = [];
  const limits = [];
  const modules = {
    "node:crypto": nodeCrypto,
    "@/lib/kova-auth-crypto.server.mjs": crypto,
    "@/integrations/supabase/client.server": {
      supabaseAdmin: {
        async rpc(name, args) {
          calls.push([name, plain(args)]);
          if (options.rpc) return options.rpc(name, args);
          if (name === "kova_auth_resolve_session") {
            return { data: options.current === null ? [] : [row(options.current)] };
          }
          if (options.error) return { error: options.error };
          if (name === "kova_auth_revoke_other_sessions") return { data: options.count ?? 2 };
          return { data: options.result === undefined ? [row()] : options.result };
        },
      },
    },
    "@/lib/kova-auth-contract.mjs": {
      ...contract,
      resolveKovaAuthMode: () => options.mode ?? "kova",
    },
    "@/lib/auth-security.mjs": security,
    "@/lib/chat-ingress.server.mjs": { resolveAnonymousClientKey: () => "fixture-ip" },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/distributed-rate-limit.server": {
      async consumeApplicationRateLimit(input) {
        limits.push(plain(input));
        if (options.limitAction === input.action) {
          if (options.limitThrows) throw Error("sensitive-backend-error");
          return { allowed: false, status: options.limitStatus ?? "limited", retryAfter: 45 };
        }
        return { allowed: true };
      },
    },
  };
  const evaluate = (source) => {
    const exports = {};
    vm.runInNewContext(source, {
      exports,
      require: (name) => {
        assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`);
        return modules[name];
      },
      Request,
      Response,
      Headers,
      URL,
      Buffer,
      Error,
      TypeError,
      Date,
      process: { env: {} },
      console: { error: (...args) => logs.push(args) },
    });
    return exports;
  };
  const store = evaluate(storeSource);
  modules["@/lib/kova-auth-store.server"] = store;
  return { ...evaluate(httpSource), store, calls, logs, limits };
}

function request(body = { confirm: true }, options = {}) {
  const method = options.method ?? "POST";
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: "https://kova.test",
    Cookie: `__Host-kova_session=${cookieToken}`,
    "X-Kova-Owner": owner,
    "X-Kova-Session": sessionId,
    ...options.headers,
  });
  return new Request("https://kova.test/api/auth/mfa/recovery/regenerate", {
    method,
    headers,
    ...(method === "POST" ? { body: options.raw ?? JSON.stringify(body) } : {}),
  });
}

test("recovery regeneration returns eight random codes once, rotates the secure cookie, and sends only digests to the store", async () => {
  const f = fixture();
  const response = await f.handleKovaMfaRecoveryRegenerate(request());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.recoveryCodes.length, 8);
  assert.equal(new Set(payload.recoveryCodes).size, 8);
  for (const code of payload.recoveryCodes) assert.match(code, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(payload.session.accountId, owner);
  assert.equal(payload.session.assuranceLevel, "aal2");
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /^__Host-kova_session=[A-Za-z0-9_-]{43};/u);
  for (const attribute of ["HttpOnly", "Secure", "Path=/", "SameSite=Lax"]) {
    assert.ok(setCookie.includes(attribute));
  }
  const nextToken = setCookie.split(";", 1)[0].split("=", 2)[1];
  assert.notEqual(nextToken, cookieToken);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  const args = f.calls.find(([name]) => name === "kova_auth_regenerate_mfa_recovery_codes")[1];
  assert.deepEqual(args.p_recovery_digest_hexes, payload.recoveryCodes.map(crypto.digestKovaToken));
  assert.equal(args.p_session_digest_hex, crypto.digestKovaToken(cookieToken));
  assert.equal(args.p_next_session_digest_hex, crypto.digestKovaToken(nextToken));
  assert.equal(Object.hasOwn(args, "accountId"), false);
  const serialized = JSON.stringify({ calls: f.calls, logs: f.logs, limits: f.limits });
  for (const secret of [...payload.recoveryCodes, nextToken, cookieToken]) {
    assert.ok(!serialized.includes(secret));
  }
  assert.deepEqual(f.limits, [
    { identity: "fixture-ip", action: "kova_auth_mfa_regenerate", limit: 5, windowSeconds: 900 },
    {
      identity: `account:${owner}`,
      action: "kova_auth_mfa_regenerate_account",
      limit: 3,
      windowSeconds: 900,
    },
  ]);
});

test("recovery regeneration rejects a stale tab after an account or session switch", async () => {
  for (const headers of [
    { "X-Kova-Owner": "30000000-0000-4000-8000-000000000003" },
    { "X-Kova-Session": "30000000-0000-4000-8000-000000000003" },
    { "X-Kova-Owner": "" },
    { "X-Kova-Session": "" },
  ]) {
    const f = fixture();
    const response = await f.handleKovaMfaRecoveryRegenerate(request(undefined, { headers }));
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(!f.calls.some(([name]) => name === "kova_auth_regenerate_mfa_recovery_codes"));
  }
});

test("regeneration rejects CSRF, malformed requests, unconfirmed changes, and client-chosen identities before any auth RPC", async (t) => {
  const cases = [
    ["cross-origin", request(undefined, { headers: { Origin: "https://attacker.invalid" } }), 403],
    ["cross-site", request(undefined, { headers: { "Sec-Fetch-Site": "cross-site" } }), 403],
    ["null-origin", request(undefined, { headers: { Origin: "null" } }), 403],
    ["GET", request(undefined, { method: "GET" }), 405],
    ["missing-cookie", request(undefined, { headers: { Cookie: "" } }), 401],
    [
      "malformed-cookie",
      request(undefined, { headers: { Cookie: "__Host-kova_session=short" } }),
      401,
    ],
    ["wrong-media-type", request(undefined, { headers: { "Content-Type": "text/plain" } }), 415],
    ["unconfirmed", request({}), 400],
    ["false-confirmation", request({ confirm: false }), 400],
    ["string-confirmation", request({ confirm: "true" }), 400],
    ["client-account", request({ confirm: true, accountId: "another-account" }), 400],
    ["client-codes", request({ confirm: true, recoveryDigests: [] }), 400],
    ["array", request([]), 400],
    ["null", request(null), 400],
    ["invalid-json", request(undefined, { raw: "{" }), 400],
    ["oversized", request({ confirm: true, padding: "x".repeat(9000) }), 413],
  ];
  for (const [label, input, status] of cases)
    await t.test(label, async () => {
      const f = fixture();
      const response = await f.handleKovaMfaRecoveryRegenerate(input);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(f.calls.length, 0);
      assert.equal(f.logs.length, 0);
    });
  const disabled = fixture({ mode: "supabase" });
  assert.equal((await disabled.handleKovaMfaRecoveryRegenerate(request())).status, 404);
  assert.equal(disabled.calls.length, 0);
});

test("regeneration fails closed for AAL1, unavailable sessions, throttling, outages, and malformed principal results", async (t) => {
  for (const current of [null, { assurance_level: "aal1" }, { email_verified: false }]) {
    const f = fixture({ current });
    assert.equal((await f.handleKovaMfaRecoveryRegenerate(request())).status, 403);
    assert.deepEqual(
      f.calls.map(([name]) => name),
      ["kova_auth_resolve_session"],
    );
  }
  for (const limitAction of ["kova_auth_mfa_regenerate", "kova_auth_mfa_regenerate_account"]) {
    for (const limitThrows of [false, true]) {
      const f = fixture({ limitAction, limitThrows });
      const response = await f.handleKovaMfaRecoveryRegenerate(request());
      assert.equal(response.status, limitThrows ? 503 : 429);
      assert.ok(!f.calls.some(([name]) => name === "kova_auth_regenerate_mfa_recovery_codes"));
    }
  }
  const errors = [
    ["invalid-session", { error: { code: "P0001", message: "sensitive secret value" } }, 403],
    ["db-down", { error: { code: "08006", message: "sensitive secret value" } }, 503],
    ["not-a-row", { result: false }, 503],
    ["missing-row", { result: [] }, 503],
    ["ambiguous-rows", { result: [row(), row()] }, 503],
    ["downgraded", { result: [row({ assurance_level: "aal1" })] }, 503],
    ["unverified", { result: [row({ email_verified: false })] }, 503],
    ["account-mismatch", { result: [row({ account_id: "another-account" })] }, 503],
  ];
  for (const [label, options, status] of errors)
    await t.test(label, async () => {
      const f = fixture(options);
      const response = await f.handleKovaMfaRecoveryRegenerate(request());
      assert.equal(response.status, status);
      assert.equal(response.headers.get("set-cookie"), null);
      const text = await response.text();
      assert.ok(!text.includes("sensitive"));
      assert.ok(!text.includes("recoveryCodes"));
      assert.equal(f.logs.length, 0);
    });
});

test("owned other-device revocation uses only the cookie principal and never reports malformed RPC results as success", async () => {
  for (const count of [0, 2]) {
    const f = fixture({ count });
    const response = await f.handleKovaRevokeOtherSessions(request({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revokedCount: count });
    assert.deepEqual(f.calls, [
      [
        "kova_auth_revoke_other_sessions",
        { p_session_digest_hex: crypto.digestKovaToken(cookieToken) },
      ],
    ]);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const count of [false, "2", -1, 1.5, {}, []]) {
    const f = fixture({ count });
    assert.equal((await f.handleKovaRevokeOtherSessions(request({}))).status, 503);
  }
  for (const input of [
    request({ accountId: owner }),
    request({}, { headers: { Origin: "https://attacker.invalid" } }),
  ]) {
    const f = fixture();
    assert.ok((await f.handleKovaRevokeOtherSessions(input)).status >= 400);
    assert.equal(f.calls.length, 0);
  }
  const rejected = fixture({ error: { code: "P0001", message: "not-for-client" } });
  assert.equal((await rejected.handleKovaRevokeOtherSessions(request({}))).status, 401);
});

test("real handler/store/PostgreSQL path regenerates codes, rotates the browser session, and rejects a replay", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, created_at timestamptz default now());
      create table auth.mfa_factors(id uuid primary key, user_id uuid, status text);
      create function public.enqueue_email(queue_name text, payload jsonb) returns bigint language sql as $$ select 1::bigint $$;
    `);
    const directory = "supabase/migrations";
    for (const name of readdirSync(directory)
      .filter((name) =>
        /_kova_(identity_session_store|auth_foreign_key_indexes|owned_(totp_login|mfa_))/u.test(
          name,
        ),
      )
      .sort()) {
      await db.exec(readFileSync(`${directory}/${name}`, "utf8"));
    }
    await db.query(
      `insert into kova_private.auth_accounts(id, primary_email, email_verified_at, mfa_required) values ($1, 'fixture@example.invalid', now(), true)`,
      [owner],
    );
    await db.query(
      `insert into kova_private.auth_mfa_factors(account_id, factor_type, state, secret_ciphertext, verified_at) values ($1, 'totp', 'active', convert_to('local-only-unused-envelope','utf8'), now())`,
      [owner],
    );
    await db.query(
      `insert into kova_private.auth_sessions(id, account_id, token_digest, assurance_level, session_epoch, expires_at) values ($1, $2, decode($3,'hex'), 'aal2', 0, now()+interval '1 day')`,
      [sessionId, owner, crypto.digestKovaToken(cookieToken)],
    );
    const allowed = new Set([
      "kova_auth_resolve_session",
      "kova_auth_regenerate_mfa_recovery_codes",
      "kova_auth_revoke_other_sessions",
    ]);
    const f = fixture({
      rpc: async (name, args) => {
        assert.ok(allowed.has(name));
        assert.ok(Object.keys(args).every((key) => /^p_[a-z_]+$/u.test(key)));
        const parameters = Object.keys(args)
          .map((key, i) => `${key} => $${i + 1}`)
          .join(", ");
        try {
          const result = await db.query(
            `select * from public.${name}(${parameters})`,
            Object.values(args),
          );
          return {
            data:
              name === "kova_auth_revoke_other_sessions"
                ? Object.values(result.rows[0])[0]
                : result.rows,
          };
        } catch (error) {
          return { error: { code: error.code, message: error.message } };
        }
      },
    });
    const response = await f.handleKovaMfaRecoveryRegenerate(request());
    assert.equal(response.status, 200);
    const payload = await response.json();
    const stored = await db.query(
      `select encode(code_digest,'hex') as digest from kova_private.auth_mfa_recovery_codes order by digest`,
    );
    assert.deepEqual(
      stored.rows.map(({ digest }) => digest),
      payload.recoveryCodes.map(crypto.digestKovaToken).sort(),
    );
    assert.equal((await f.handleKovaMfaRecoveryRegenerate(request())).status, 403);
    const nextCookie = response.headers.get("set-cookie").split(";", 1)[0];
    const signedOut = await f.handleKovaRevokeOtherSessions(
      request({}, { headers: { Cookie: nextCookie } }),
    );
    assert.equal(signedOut.status, 200);
    const audit = await db.query(
      `select event_type from kova_private.auth_audit_events order by id`,
    );
    assert.deepEqual(
      audit.rows.map(({ event_type }) => event_type),
      ["mfa_recovery_codes_regenerated", "other_sessions_revoked"],
    );
    const session = (
      await db.query(`select * from public.kova_auth_resolve_session($1)`, [
        crypto.digestKovaToken(nextCookie.split("=", 2)[1]),
      ])
    ).rows[0];
    assert.equal(session.assurance_level, "aal2");
    assert.equal(session.account_id, owner);
  } finally {
    await db.close();
  }
});
