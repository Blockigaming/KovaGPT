import assert from "node:assert/strict";
import test from "node:test";
import {
  accountNotificationConfiguration,
  accountNotificationBody,
  dispatchAccountNotifications,
  main,
} from "../../scripts/auth-email/notification-dispatch.mjs";

const id = "10000000-0000-4000-8000-000000000001";
const lease = "20000000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-20T12:00:00.000Z");
const env = {
  AZURE_ENVIRONMENT: "staging",
  CONTAINER_APP_NAME: "ca-kovagpt-staging",
  KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED: "true",
  KOVA_AUTH_PUBLIC_ORIGIN: "https://ca-kovagpt-staging.fixture.eastus.azurecontainerapps.io",
  KOVA_ACCOUNT_EMAIL_EXPECTED_ORIGIN:
    "https://ca-kovagpt-staging.fixture.eastus.azurecontainerapps.io",
  SUPABASE_URL: "https://ssssssssssssssssssss.supabase.co",
  KOVA_EXPECTED_SUPABASE_PROJECT_REF: "ssssssssssssssssssss",
  KOVA_ACCOUNT_EMAIL_DATABASE_ORIGIN: "https://ssssssssssssssssssss.supabase.co",
  KOVA_ACCOUNT_EMAIL_EVENT_IDS: id,
  KOVA_ACCOUNT_EMAIL_ISSUED_NOT_BEFORE: new Date(now - 5000).toISOString(),
  KOVA_ACCOUNT_EMAIL_MAX_SENDS: "1",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  RESEND_API_KEY: "synthetic-resend-key",
};
const row = () => ({
  id,
  event_type: "password_changed",
  recipient: "owner@example.test",
  occurred_at: new Date(now).toISOString(),
  metadata: {},
  lease_token: lease,
  lease_expires_at: new Date(now + 60_000).toISOString(),
});

test("notification delivery is disabled without explicit execution and exact existing staging scope", async () => {
  assert.deepEqual(await main([], {}), {
    execution_enabled: false,
    reason: "explicit_execute_required",
  });
  for (const patch of [
    { KOVA_ACCOUNT_EMAIL_DISPATCH_ENABLED: "false" },
    { AZURE_ENVIRONMENT: "production" },
    { KOVA_ACCOUNT_EMAIL_EXPECTED_ORIGIN: "https://attacker.example" },
    { KOVA_EXPECTED_SUPABASE_PROJECT_REF: "another" },
    { KOVA_ACCOUNT_EMAIL_EVENT_IDS: `${id},${id}` },
    { KOVA_ACCOUNT_EMAIL_MAX_SENDS: "2" },
    { KOVA_ACCOUNT_EMAIL_ISSUED_NOT_BEFORE: new Date(now - 900001).toISOString() },
  ])
    assert.throws(
      () => accountNotificationConfiguration({ ...env, ...patch }, now),
      /^Error: kova_account_email_/u,
    );
});

test("only scoped, safe persisted event data reaches the pure renderer", () => {
  const config = accountNotificationConfiguration(env, now);
  assert.equal(accountNotificationBody(row(), config, now).to[0], "owner@example.test");
  // PostgreSQL timestamptz commonly serializes with +00:00 rather than Z.
  assert.ok(
    accountNotificationBody(
      { ...row(), occurred_at: "2026-10-20T12:00:00+00:00" },
      config,
      now,
    ).text.includes("password"),
  );
  for (const patch of [
    { id: lease },
    { event_type: "email_verification" },
    { recipient: "bad\r\n@example.test" },
    { metadata: { token: "private-action-proof" } },
    { occurred_at: "2026-02-30T12:00:00Z" },
  ])
    assert.throws(() => accountNotificationBody({ ...row(), ...patch }, config, now));
});

test("delivery rechecks current preference after claim before sending and preserves stable idempotency", async () => {
  const config = accountNotificationConfiguration(env, now);
  const calls = [];
  let sendCount = 0;
  const summary = await dispatchAccountNotifications(config, {
    now: () => now,
    rpc: async (name, body) => {
      calls.push([name, body]);
      return name === "account_email_claim_dispatch" ? [row()] : true;
    },
    send: async (payload, body) => {
      sendCount++;
      assert.equal(payload.idempotency_key, `kova-account-email:${id}`);
      assert.deepEqual(body.to, ["owner@example.test"]);
      assert.equal(calls.at(-1)[0], "account_email_prepare_dispatch");
      return { outcome: "sent" };
    },
  });
  assert.deepEqual(summary, { attempted: 1, sent: 1, uncertain: 0, failed: 0, skipped: 0 });
  assert.equal(sendCount, 1);
  assert.equal(calls.at(-1)[1].p_outcome, "sent");
});

test("an opt-out at the final delivery boundary prevents any provider request", async () => {
  let sends = 0;
  const summary = await dispatchAccountNotifications(accountNotificationConfiguration(env, now), {
    now: () => now,
    rpc: async (name) => (name === "account_email_claim_dispatch" ? [row()] : false),
    send: async () => {
      sends++;
      throw new Error("must not send");
    },
  });
  assert.equal(sends, 0);
  assert.equal(summary.skipped, 1);
});

test("uncertain provider outcomes are recorded once without hidden retries", async () => {
  let sends = 0;
  const finishes = [];
  const summary = await dispatchAccountNotifications(accountNotificationConfiguration(env, now), {
    now: () => now,
    rpc: async (name, body) => {
      if (name === "account_email_finish_dispatch") finishes.push(body);
      return name === "account_email_claim_dispatch" ? [row()] : true;
    },
    send: async () => {
      sends++;
      return { outcome: "retry", errorCode: "provider_transport" };
    },
  });
  assert.equal(sends, 1);
  assert.equal(finishes[0].p_outcome, "uncertain");
  assert.equal(summary.uncertain, 1);
  assert.equal(JSON.stringify(summary).includes("owner@example.test"), false);
});
