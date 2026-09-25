import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { authHttp, authRequest, postgresTransport } from "../helpers/kova-auth-http.mjs";
import { authDatabase, passwordAccount, owner, other } from "../helpers/kova-auth-database.mjs";
import * as crypto from "../../src/lib/kova-auth-crypto.server.mjs";

const currentPassword = "test-only current primary password";
const passwordHash = await crypto.hashKovaPassword(currentPassword);
const key = randomBytes(32);
const fixtureEnv = {
  KOVA_AUTH_ENCRYPTION_KEY: key.toString("base64url"),
  KOVA_AUTH_ENCRYPTION_KEY_SHA256: createHash("sha256").update(key).digest("hex"),
};
const testCrypto = { encryptKovaSecret: (value) => crypto.encryptKovaSecret(value, fixtureEnv) };
const credentialId = "30000000-0000-4000-8000-000000000003";
const factorId = "40000000-0000-4000-8000-000000000004";
const current = {
  account_id: owner,
  session_id: "50000000-0000-4000-8000-000000000005",
  email: "owner@example.invalid",
  email_verified: true,
  assurance_level: "aal1",
  expires_at: new Date(Date.now() + 86400000).toISOString(),
};
const password = {
  account_id: owner,
  credential_id: credentialId,
  credential_revision: 1,
  password_hash: passwordHash,
  email: current.email,
  mfa_required: false,
};
function enrollmentRequest(body, options = {}) {
  return authRequest(body, {
    ...options,
    headers: {
      "X-Kova-Owner": current.account_id,
      "X-Kova-Session": current.session_id,
      ...options.headers,
    },
  });
}
function fixture(options = {}) {
  return authHttp({
    ...options,
    crypto: testCrypto,
    rpc: async (name, args) => {
      if (name === "kova_auth_resolve_session")
        return { data: options.current === null ? [] : [{ ...current, ...options.current }] };
      if (name === "kova_auth_password_lookup")
        return {
          data: options.credential === null ? [] : [{ ...password, ...options.credential }],
        };
      assert.equal(name, "kova_auth_begin_totp_enrollment_reauthenticated");
      if (options.rpc) return options.rpc(name, args);
      return options.error
        ? { error: options.error }
        : { data: [{ factor_id: factorId, email: options.email ?? current.email }] };
    },
  });
}

test("first MFA checks the actual password, sends only its verified credential binding, and never returns a session upgrade", async () => {
  const f = fixture();
  const response = await f.handleKovaMfaEnroll(enrollmentRequest({ currentPassword }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.factorId, factorId);
  assert.match(body.secret, /^[A-Z2-7]{32}$/u);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.calls.at(-1)[1].p_credential_id, credentialId);
  assert.equal(f.calls.at(-1)[1].p_credential_revision, 1);
  assert.equal(
    crypto.decryptKovaSecret(f.calls.at(-1)[1].p_secret_envelope, fixtureEnv),
    body.secret,
  );
  const serialized = JSON.stringify({ body, calls: f.calls, logs: f.logs, limits: f.limits });
  assert.ok(!serialized.includes(currentPassword));
  assert.ok(!serialized.includes(passwordHash));
  assert.ok(!serialized.includes("s".repeat(43)));
  assert.equal(f.limits[1].identity, `account:${owner}`);
});

test("TOTP enrollment rejects missing or changed captured authority before issuing a secret", async () => {
  for (const headers of [
    { "X-Kova-Owner": "" },
    { "X-Kova-Session": "" },
    { "X-Kova-Owner": other },
    { "X-Kova-Session": "60000000-0000-4000-8000-000000000006" },
  ]) {
    const f = fixture();
    const response = await f.handleKovaMfaEnroll(
      enrollmentRequest({ currentPassword }, { headers }),
    );
    assert.equal(response.status, 409);
    assert.ok(
      !f.calls.some(([name]) => name === "kova_auth_begin_totp_enrollment_reauthenticated"),
    );
    assert.doesNotMatch(await response.text(), /otpauth|secret/iu);
  }
  const changed = fixture({
    current: {
      account_id: other,
      session_id: "60000000-0000-4000-8000-000000000006",
      email: "other@example.invalid",
    },
  });
  assert.equal(
    (await changed.handleKovaMfaEnroll(enrollmentRequest({ currentPassword }))).status,
    409,
  );
  assert.ok(
    !changed.calls.some(([name]) => name === "kova_auth_begin_totp_enrollment_reauthenticated"),
  );
});

test("wrong, missing, cross-account or unverified password proof cannot request enrollment", async (t) => {
  for (const [label, body, options] of [
    ["wrong password", { currentPassword: "wrong password" }, {}],
    ["missing credential", { currentPassword }, { credential: null }],
    ["other account", { currentPassword }, { credential: { account_id: other } }],
    ["unverified email", { currentPassword }, { current: { email_verified: false } }],
    ["revoked session", { currentPassword }, { current: null }],
  ])
    await t.test(label, async () => {
      const f = fixture(options);
      const response = await f.handleKovaMfaEnroll(enrollmentRequest(body));
      assert.equal(response.status, 401);
      assert.ok(
        !f.calls.some(([name]) => name === "kova_auth_begin_totp_enrollment_reauthenticated"),
      );
      assert.equal(response.headers.get("set-cookie"), null);
      assert.ok(!(await response.text()).includes(currentPassword));
    });
});

test("MFA enrollment rejects forged authority fields, malformed input and cross-origin requests before database access", async (t) => {
  for (const [label, request, status] of [
    ["caller credential binding", enrollmentRequest({ currentPassword, credentialId }), 400],
    ["caller authority", enrollmentRequest({ currentPassword, accountId: other }), 400],
    [
      "caller reauthentication timestamp",
      enrollmentRequest({ reauthenticatedAt: Date.now() }),
      400,
    ],
    ["password wrong type", enrollmentRequest({ currentPassword: [] }), 400],
    ["name wrong type", enrollmentRequest({ friendlyName: {} }), 400],
    ["malformed JSON", enrollmentRequest({}, { raw: "{" }), 400],
    [
      "cross-site",
      enrollmentRequest({ currentPassword }, { headers: { Origin: "https://evil.invalid" } }),
      403,
    ],
    [
      "sibling origin",
      enrollmentRequest({ currentPassword }, { headers: { Origin: "https://evil.kova.test" } }),
      403,
    ],
    ["GET", enrollmentRequest({}, { method: "GET" }), 405],
  ])
    await t.test(label, async () => {
      const f = fixture();
      assert.equal((await f.handleKovaMfaEnroll(request)).status, status);
      assert.equal(f.calls.length, 0);
    });
});

test("Google/passkey primary proof is decided by the database, not a client boolean or AAL1 cookie", async () => {
  const f = fixture({ error: { code: "42501", message: "private database detail" } });
  const response = await f.handleKovaMfaEnroll(enrollmentRequest({}));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "reauthentication_required");
  assert.equal(f.calls.at(-1)[1].p_credential_id, null);
  assert.equal(f.calls.at(-1)[1].p_credential_revision, null);
  assert.ok(!JSON.stringify(f.logs).includes("private database detail"));
});

test("account throttling, changed credential revision, unavailable storage and wrong-account returns fail closed", async (t) => {
  for (const [label, options, status] of [
    [
      "account throttling",
      {
        limit: (input) =>
          input.action.endsWith("_account")
            ? { allowed: false, status: "limited", retryAfter: 60 }
            : { allowed: true },
      },
      429,
    ],
    [
      "stale revision at commit",
      { error: { code: "42501", message: "kova_auth_reauthentication_required" } },
      403,
    ],
    ["unavailable store", { error: { code: "08006", message: "sensitive database details" } }, 503],
    ["mismatched account response", { email: "other@example.invalid" }, 503],
  ])
    await t.test(label, async () => {
      const f = fixture(options);
      const response = await f.handleKovaMfaEnroll(enrollmentRequest({ currentPassword }));
      assert.equal(response.status, status);
      const text = await response.text();
      assert.ok(!text.includes("secret"));
      assert.ok(!text.includes(currentPassword));
      assert.equal(response.headers.get("set-cookie"), null);
    });
});

test("actual handler, password crypto, store and PostgreSQL reject stale cookies and bind a verified first enrollment", async () => {
  const db = await authDatabase();
  try {
    const token = crypto.generateKovaToken();
    const row = await passwordAccount(db, {
      token,
      passwordHash,
      email: current.email,
      at: new Date().toISOString(),
    });
    const f = authHttp({
      crypto: testCrypto,
      rpc: postgresTransport(db, [
        "kova_auth_resolve_session",
        "kova_auth_password_lookup",
        "kova_auth_begin_totp_enrollment_reauthenticated",
      ]),
    });
    const bound = (body) =>
      enrollmentRequest(body, { token, headers: { "X-Kova-Session": row.session_id } });
    const noProof = await f.handleKovaMfaEnroll(bound({}));
    assert.equal(noProof.status, 403);
    assert.equal(
      (await db.query("select count(*)::int as n from kova_private.auth_mfa_factors")).rows[0].n,
      0,
    );
    const wrong = await f.handleKovaMfaEnroll(bound({ currentPassword: "not correct" }));
    assert.equal(wrong.status, 401);
    assert.equal(
      (await db.query("select count(*)::int as n from kova_private.auth_mfa_factors")).rows[0].n,
      0,
    );
    const response = await f.handleKovaMfaEnroll(bound({ currentPassword }));
    assert.equal(response.status, 200);
    const body = await response.json();
    const factor = (
      await db.query(
        `select account_id,enrollment_session_id,enrollment_epoch,enrollment_method,
      enrollment_credential_id,enrollment_credential_revision,convert_from(secret_ciphertext,'utf8') as envelope
      from kova_private.auth_mfa_factors where id=$1`,
        [body.factorId],
      )
    ).rows[0];
    assert.equal(factor.account_id, owner);
    assert.equal(factor.enrollment_session_id, row.session_id);
    assert.equal(factor.enrollment_method, "password");
    assert.equal(factor.enrollment_credential_id, row.credential.id);
    assert.equal(crypto.decryptKovaSecret(factor.envelope, fixtureEnv), body.secret);
    const audit = JSON.stringify(
      (await db.query("select * from kova_private.auth_audit_events")).rows,
    );
    assert.ok(!audit.includes(currentPassword));
    assert.ok(!audit.includes(body.secret));
    assert.ok(!audit.includes(token));
  } finally {
    await db.close();
  }
});
