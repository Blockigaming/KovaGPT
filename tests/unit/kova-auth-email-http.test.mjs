import assert from "node:assert/strict";
import test from "node:test";
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";
import { digestKovaToken } from "../../src/lib/kova-auth-crypto.server.mjs";

const accountId = "10000000-0000-4000-8000-000000000001";
const email = "fixture-owner@example.test";
const cases = [
  {
    handler: "handleKovaSignup",
    path: "/api/auth/signup",
    body: { email, password: "a synthetic strong password" },
    rpc: "kova_auth_create_password_account",
    label: "kova-auth-verification",
    action: "Verify email",
    digestKey: "p_verification_digest_hex",
    expiryKey: "p_verification_expires_at",
  },
  {
    handler: "handleKovaVerificationResend",
    path: "/api/auth/verify/resend",
    body: { email },
    rpc: "kova_auth_resend_verification",
    label: "kova-auth-verification",
    action: "Verify email",
    digestKey: "p_verification_digest_hex",
    expiryKey: "p_expires_at",
  },
  {
    handler: "handleKovaRecoveryRequest",
    path: "/api/auth/recovery/request",
    body: { email },
    rpc: "kova_auth_create_recovery",
    label: "kova-auth-recovery",
    action: "Reset password",
    digestKey: "p_recovery_digest_hex",
    expiryKey: "p_recovery_expires_at",
  },
];

function fixture(input, env = {}) {
  const queued = [];
  const h = authHttp({
    env: {
      KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test",
      KOVA_EMAIL_QUEUE_ENABLED: "true",
      ...env,
    },
    rpc: async (name, args) => {
      if (name === "kova_auth_create_compatibility_principal") return { data: accountId };
      assert.equal(name, input.rpc);
      queued.push(args);
      return {
        data:
          input.handler === "handleKovaSignup"
            ? [{ account_id: accountId, candidate_used: true, verification_created: true }]
            : true,
      };
    },
  });
  return { h, queued };
}

for (const input of cases) {
  test(`${input.handler} queues the branded action with its exact database expiry and digest identity`, async () => {
    const { h, queued } = fixture(input);
    const before = Date.now();
    const response = await h[input.handler](authRequest(input.body, { path: input.path }));
    const after = Date.now();
    assert.equal(response.status, 202);
    assert.equal(queued.length, 1);
    const args = queued[0];
    const payload = args.p_email_payload;
    assert.deepEqual(Object.keys(payload), [
      "message_id",
      "to",
      "from",
      "sender_domain",
      "subject",
      "html",
      "text",
      "purpose",
      "label",
      "idempotency_key",
      "queued_at",
    ]);
    assert.match(payload.message_id, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(payload.to, email);
    assert.equal(payload.from, "KovaGPT <noreply@kovagpt.com>");
    assert.equal(payload.sender_domain, "notify.kovagpt.com");
    assert.equal(payload.purpose, "auth");
    assert.equal(payload.label, input.label);
    assert.equal(payload.idempotency_key, `${input.label}:${args[input.digestKey]}`);
    const queuedAt = Date.parse(payload.queued_at);
    assert.ok(queuedAt >= before && queuedAt <= after);
    assert.equal(Date.parse(args[input.expiryKey]) - queuedAt, 3600_000);
    const printedExpiry = args[input.expiryKey].replace("T", " ").replace(/\.\d{3}Z$/u, " UTC");
    assert.ok(payload.text.includes(printedExpiry));
    assert.ok(payload.html.includes(printedExpiry));
    const link = new URL(
      payload.text
        .split("\n\n")
        .find((part) => part.startsWith(`${input.action}: `))
        .slice(input.action.length + 2),
    );
    assert.equal(link.origin, "https://kova.test");
    const recovery = input.label === "kova-auth-recovery";
    assert.equal(link.pathname, recovery ? "/reset-password" : "/api/auth/verify");
    assert.equal(recovery ? link.search : link.hash, "");
    const token = (recovery ? new URLSearchParams(link.hash.slice(1)) : link.searchParams).get(
      "token",
    );
    assert.equal(digestKovaToken(token), args[input.digestKey]);
    assert.ok(!JSON.stringify([...h.logs, await response.json()]).includes(token));
  });

  test(`${input.handler} fails before any account or challenge RPC when email queue is disabled`, async () => {
    const { h, queued } = fixture(input, { KOVA_EMAIL_QUEUE_ENABLED: "false" });
    const response = await h[input.handler](authRequest(input.body, { path: input.path }));
    assert.equal(response.status, 503);
    assert.equal(queued.length, 0);
    assert.equal(h.calls.length, 0);
    assert.doesNotMatch(await response.text(), /fixture-owner|password|https:\/\//u);
  });
}

test("separate recovery requests use separate message and action identities", async () => {
  const input = cases[2];
  const { h, queued } = fixture(input);
  for (let i = 0; i < 2; i += 1) {
    assert.equal(
      (await h[input.handler](authRequest(input.body, { path: input.path }))).status,
      202,
    );
  }
  assert.notEqual(queued[0].p_email_payload.message_id, queued[1].p_email_payload.message_id);
  assert.notEqual(
    queued[0].p_email_payload.idempotency_key,
    queued[1].p_email_payload.idempotency_key,
  );
  assert.notEqual(queued[0].p_recovery_digest_hex, queued[1].p_recovery_digest_hex);
});
