import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { authHttp, authRequest, postgresTransport } from "../helpers/kova-auth-http.mjs";
import { authDatabase, passwordAccount, owner, other } from "../helpers/kova-auth-database.mjs";
import * as crypto from "../../src/lib/kova-auth-crypto.server.mjs";

const currentPassword = "test-only original password";
const newPassword = "test-only replacement password";
const passwordHash = await crypto.hashKovaPassword(currentPassword);
const credentialId = "30000000-0000-4000-8000-000000000003";
const factorId = "40000000-0000-4000-8000-000000000004";
const currentRow = {
  account_id: owner,
  session_id: "50000000-0000-4000-8000-000000000005",
  email: "fixture@example.invalid",
  email_verified: true,
  assurance_level: "aal2",
  expires_at: new Date(Date.now() + 86400000).toISOString(),
};
const credentialRow = {
  account_id: owner,
  credential_id: credentialId,
  credential_revision: 1,
  password_hash: passwordHash,
  email: currentRow.email,
  mfa_required: true,
};
const resultRow = { ...currentRow, session_id: "60000000-0000-4000-8000-000000000006" };

function fixture(options = {}) {
  return authHttp({
    ...options,
    rpc: async (name, args) => {
      if (name === "kova_auth_resolve_session")
        return { data: options.current === null ? [] : [{ ...currentRow, ...options.current }] };
      if (name === "kova_auth_password_lookup")
        return {
          data: options.credential === null ? [] : [{ ...credentialRow, ...options.credential }],
        };
      if (name === "kova_auth_read_totp_enrollment")
        return { data: [{ secret_envelope: options.envelope }] };
      if (options.rpc) return options.rpc(name, args);
      if (options.error) return { error: options.error };
      return { data: options.result === undefined ? [resultRow] : options.result };
    },
  });
}

test("owned password change reauthenticates, hashes on the server and returns only a rotated secure session", async () => {
  const f = fixture();
  const response = await f.handleKovaPasswordChange(authRequest({ currentPassword, newPassword }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.changed, true);
  assert.equal(payload.session.accountId, owner);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^__Host-kova_session=[A-Za-z0-9_-]{43};/u);
  for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
    assert.ok(cookie.includes(part));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const args = f.calls.find(([name]) => name === "kova_auth_change_password")[1];
  assert.equal(args.p_credential_id, credentialId);
  assert.equal(args.p_credential_revision, 1);
  assert.equal(await crypto.verifyKovaPassword(newPassword, args.p_password_hash), true);
  assert.equal(await crypto.verifyKovaPassword(currentPassword, args.p_password_hash), false);
  assert.equal(
    args.p_next_session_digest_hex,
    crypto.digestKovaToken(cookie.split(";")[0].split("=")[1]),
  );
  const serialized = JSON.stringify({ payload, calls: f.calls, logs: f.logs, limits: f.limits });
  for (const secret of [currentPassword, newPassword, "s".repeat(43)])
    assert.ok(!serialized.includes(secret));
  assert.equal(f.limits.length, 2);
  assert.equal(f.limits[1].identity, `account:${owner}`);
});

test("password mutations reject CSRF, unknown fields, malformed bodies and wrong methods before database access", async () => {
  const cases = [
    [
      authRequest(
        { currentPassword, newPassword },
        { headers: { Origin: "https://attacker.invalid" } },
      ),
      403,
    ],
    [
      authRequest(
        { currentPassword, newPassword },
        { headers: { "Sec-Fetch-Site": "cross-site" } },
      ),
      403,
    ],
    [authRequest({ currentPassword, newPassword }, { method: "GET" }), 405],
    [authRequest({ currentPassword, newPassword }, { headers: { Cookie: "" } }), 401],
    [authRequest({ currentPassword, newPassword, accountId: other }), 400],
    [authRequest({ currentPassword, newPassword }, { raw: "{" }), 400],
    [authRequest({ currentPassword: [], newPassword }), 400],
  ];
  for (const [request, status] of cases) {
    const f = fixture();
    assert.equal((await f.handleKovaPasswordChange(request)).status, status);
    assert.equal(f.calls.length, 0);
  }
});

test("wrong credentials, AAL1 on MFA accounts, cross-account lookups and stale revisions cannot change a password", async () => {
  const cases = [
    [{}, "incorrect-password"],
    [{ current: null }, currentPassword],
    [{ credential: null }, currentPassword],
    [{ credential: { account_id: other } }, currentPassword],
    [{ current: { assurance_level: "aal1" } }, currentPassword],
    [{ current: { email_verified: false } }, currentPassword],
  ];
  for (const [options, password] of cases) {
    const f = fixture(options);
    const response = await f.handleKovaPasswordChange(
      authRequest({ currentPassword: password, newPassword }),
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(!f.calls.some(([name]) => name === "kova_auth_change_password"));
  }
  const f = fixture({ error: { code: "P0001", message: "private stale credential detail" } });
  const response = await f.handleKovaPasswordChange(authRequest({ currentPassword, newPassword }));
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes("private stale"));
});

test("password policy, rate limits and unexpected store results fail closed", async () => {
  for (const candidate of [
    currentPassword,
    "short",
    "x".repeat(1025),
    "valid length bad utf8\ud800",
  ]) {
    const f = fixture();
    assert.equal(
      (await f.handleKovaPasswordChange(authRequest({ currentPassword, newPassword: candidate })))
        .status,
      400,
    );
    assert.ok(!f.calls.some(([name]) => name === "kova_auth_change_password"));
  }
  const f = fixture({ limit: async () => ({ allowed: false, status: "limited", retryAfter: 60 }) });
  const limited = await f.handleKovaPasswordChange(authRequest({ currentPassword, newPassword }));
  assert.equal(limited.status, 429);
  assert.equal(f.calls.length, 0);
  for (const result of [
    true,
    [],
    [currentRow],
    [{ ...resultRow, account_id: other }],
    [{ ...resultRow, assurance_level: "aal1" }],
  ]) {
    const bad = fixture({ result });
    const response = await bad.handleKovaPasswordChange(
      authRequest({ currentPassword, newPassword }),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("password status returns only an account-bound boolean, never a hash or credential identifier", async () => {
  for (const [options, hasPassword] of [
    [{}, true],
    [{ credential: null }, false],
  ]) {
    const f = fixture(options);
    const response = await f.handleKovaPasswordStatus(authRequest(undefined, { method: "GET" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { hasPassword });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(
    (
      await fixture({ credential: { account_id: other } }).handleKovaPasswordStatus(
        authRequest(undefined, { method: "GET" }),
      )
    ).status,
    503,
  );
});

test("MFA enable/remove handlers enforce CSRF and rotate cookies through the new, not legacy, RPCs", async () => {
  const key = Buffer.alloc(32, 7);
  const env = {
    KOVA_AUTH_ENCRYPTION_KEY: key.toString("base64url"),
    KOVA_AUTH_ENCRYPTION_KEY_SHA256: createHash("sha256").update(key).digest("hex"),
  };
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const f = fixture({
    envelope: crypto.encryptKovaSecret(secret, env),
    crypto: {
      decryptKovaSecret: (envelope) => crypto.decryptKovaSecret(envelope, env),
      verifyKovaTotp: (code, value) => crypto.verifyKovaTotp(code, value, 59000),
    },
  });
  const enabled = await f.handleKovaMfaVerify(authRequest({ factorId, code: "287082" }));
  assert.equal(enabled.status, 200);
  assert.match(enabled.headers.get("set-cookie"), /__Host-kova_session=/u);
  const payload = await enabled.json();
  assert.equal(payload.recoveryCodes.length, 8);
  assert.equal(payload.session.assuranceLevel, "aal2");
  assert.ok(f.calls.some(([name]) => name === "kova_auth_activate_totp_with_session"));
  assert.ok(!f.calls.some(([name]) => name === "kova_auth_activate_totp"));
  const removed = await f.handleKovaMfaRemove(authRequest({ factorId }));
  assert.equal(removed.status, 200);
  assert.match(removed.headers.get("set-cookie"), /__Host-kova_session=/u);
  assert.ok(f.calls.some(([name]) => name === "kova_auth_remove_totp_with_session"));
  for (const handler of ["handleKovaMfaEnroll", "handleKovaMfaVerify", "handleKovaMfaRemove"]) {
    const denied = fixture();
    assert.equal(
      (
        await denied[handler](
          authRequest(
            { factorId, code: "287082" },
            { headers: { Origin: "https://other.invalid" } },
          ),
        )
      ).status,
      403,
    );
    assert.equal(denied.calls.length, 0);
  }
  assert.equal(
    (
      await fixture({ current: { assurance_level: "aal1" } }).handleKovaMfaRemove(
        authRequest({ factorId }),
      )
    ).status,
    403,
  );
});

test("real HTTP/store/PostgreSQL password change rejects the old password and both old-session/revision replay", async () => {
  const db = await authDatabase();
  try {
    const token = crypto.generateKovaToken();
    const at = new Date().toISOString(),
      expiresAt = new Date(Date.now() + 86400000).toISOString();
    await passwordAccount(db, { token, passwordHash, at, expiresAt });
    const f = authHttp({
      rpc: postgresTransport(db, [
        "kova_auth_resolve_session",
        "kova_auth_password_lookup",
        "kova_auth_change_password",
      ]),
    });
    const response = await f.handleKovaPasswordChange(
      authRequest({ currentPassword, newPassword }, { token }),
    );
    assert.equal(response.status, 200);
    const nextToken = response.headers.get("set-cookie").split(";")[0].split("=")[1];
    const stored = (
      await db.query(`select secret_hash from kova_private.auth_credentials where account_id=$1`, [
        owner,
      ])
    ).rows[0].secret_hash;
    assert.equal(await crypto.verifyKovaPassword(newPassword, stored), true);
    assert.equal(await crypto.verifyKovaPassword(currentPassword, stored), false);
    assert.equal(
      (await f.handleKovaPasswordChange(authRequest({ currentPassword, newPassword }, { token })))
        .status,
      401,
    );
    assert.equal(
      (
        await f.handleKovaPasswordChange(
          authRequest(
            { currentPassword, newPassword: "another safe password" },
            { token: nextToken },
          ),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int as n from kova_private.auth_audit_events where event_type='password_changed'`,
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
