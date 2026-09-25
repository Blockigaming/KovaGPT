import assert from "node:assert/strict";
import test from "node:test";
import {
  digestKovaSessionToken,
  evaluateKovaSession,
  generateKovaSessionToken,
  sessionDigestMatches,
} from "../../src/lib/kova-session.server.mjs";

test("Kova session tokens are random base64url secrets stored as digests", () => {
  const first = generateKovaSessionToken();
  const second = generateKovaSessionToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first, second);

  const digest = digestKovaSessionToken(first);
  assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.notEqual(digest, first);
  assert.equal(sessionDigestMatches(first, digest), true);
  assert.equal(sessionDigestMatches(second, digest), false);
  assert.equal(sessionDigestMatches("malformed", digest), false);
  assert.equal(sessionDigestMatches(first, "malformed"), false);
});

test("session validation binds the exact account and fails closed", () => {
  const now = Date.parse("2026-09-20T16:00:00Z");
  const session = {
    id: "session-1",
    account_id: "account-1",
    expires_at: "2026-10-20T16:00:00Z",
    revoked_at: null,
    assurance_level: "aal1",
  };
  const account = {
    id: "account-1",
    email_verified_at: "2026-09-01T00:00:00Z",
    deleted_at: null,
    suspended_until: null,
    mfa_required: false,
  };
  assert.deepEqual(evaluateKovaSession(session, account, now), {
    ok: true,
    accountId: "account-1",
    sessionId: "session-1",
    emailVerified: true,
    assuranceLevel: "aal1",
    expiresAt: "2026-10-20T16:00:00.000Z",
  });
  assert.equal(evaluateKovaSession({ ...session, account_id: "other" }, account, now).ok, false);
  assert.equal(evaluateKovaSession({ ...session, expires_at: "invalid" }, account, now).ok, false);
  assert.equal(
    evaluateKovaSession({ ...session, expires_at: "2026-09-20T16:00:00Z" }, account, now).ok,
    false,
  );
  assert.equal(
    evaluateKovaSession({ ...session, revoked_at: "2026-09-20" }, account, now).ok,
    false,
  );
  assert.equal(
    evaluateKovaSession(session, { ...account, deleted_at: "2026-09-20" }, now).ok,
    false,
  );
});

test("suspension and MFA policy are enforced by the authoritative account", () => {
  const now = Date.parse("2026-09-20T16:00:00Z");
  const session = {
    id: "session-1",
    account_id: "account-1",
    expires_at: "2026-10-20T16:00:00Z",
    revoked_at: null,
    assurance_level: "aal1",
  };
  const account = {
    id: "account-1",
    email_verified_at: null,
    deleted_at: null,
    suspended_until: "2026-09-21T00:00:00Z",
    mfa_required: false,
  };
  assert.deepEqual(evaluateKovaSession(session, account, now), {
    ok: false,
    status: 403,
    code: "account_suspended",
  });
  assert.deepEqual(
    evaluateKovaSession(session, { ...account, suspended_until: null, mfa_required: true }, now),
    { ok: false, status: 403, code: "mfa_required" },
  );
  assert.equal(
    evaluateKovaSession(
      { ...session, assurance_level: "aal2" },
      { ...account, suspended_until: null, mfa_required: true },
      now,
    ).ok,
    true,
  );
});
