import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmailDispatcher,
  EmailWorkerError,
  loadEmailWorkerConfig,
  parseEmailQueueMessage,
} from "../../worker/src/email-dispatcher.mjs";

const BASE_ENV = {
  KOVA_EMAIL_QUEUE_ENABLED: "true",
  SUPABASE_URL: "https://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-for-tests",
  RESEND_API_KEY: "resend-secret-for-tests",
  KOVA_PUBLIC_ORIGIN: "https://kovagpt.com",
  EMAIL_SENDER_DOMAINS: "notify.kovagpt.com",
};

function config(extra = {}) {
  return loadEmailWorkerConfig({ ...BASE_ENV, ...extra });
}

function message(extra = {}) {
  return {
    message_id: "message-123",
    idempotency_key: "idem-123",
    to: "alice@example.com",
    from: "KovaGPT <noreply@notify.kovagpt.com>",
    subject: "Your KovaGPT update",
    html: "<p>Private body</p>",
    text: "Private body",
    purpose: "transactional",
    unsubscribe_token: "a".repeat(64),
    queued_at: new Date("2026-09-04T00:00:00.000Z").toISOString(),
    ...extra,
  };
}

function json(value, status = 200, headers = {}) {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockApi({
  rows = [],
  logStatus = "pending",
  suppressed = false,
  resendStatus = 200,
  readCount = 1,
  cooldownUntil = null,
} = {}) {
  const calls = [];
  const queueRows =
    rows.length > 0 ? rows : [{ msg_id: 17, read_ct: readCount, message: message() }];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: url.toString(), method, body, headers: new Headers(init.headers) });

    if (url.hostname === "api.resend.com") {
      return resendStatus === 200
        ? json({ id: "provider-message-123" })
        : json({ message: "provider failure" }, resendStatus, { "retry-after": "3" });
    }
    if (url.pathname.endsWith("/email_send_state") && method === "GET") {
      return json([{ retry_after_until: cooldownUntil }]);
    }
    if (url.pathname.endsWith("/rpc/read_email_batch")) {
      return json(body.queue_name === "transactional_emails" ? queueRows : []);
    }
    if (url.pathname.endsWith("/rpc/delete_email")) return json(true);
    if (url.pathname.endsWith("/rpc/defer_email_retry")) return json(true);
    if (url.pathname.endsWith("/rpc/dead_letter_tracked_email")) return json(91);
    if (url.pathname.endsWith("/email_send_log") && method === "GET") {
      return json([{ id: "log-123", status: logStatus }]);
    }
    if (url.pathname.endsWith("/suppressed_emails")) {
      return json(suppressed ? [{ id: "suppressed-123" }] : []);
    }
    if (url.pathname.endsWith("/email_send_log") && method === "PATCH") return json(null, 204);
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  return { calls, fetchImpl };
}

test("configuration fails closed on missing secrets, insecure origins, and invalid bounds", () => {
  assert.throws(
    () => loadEmailWorkerConfig({ ...BASE_ENV, KOVA_EMAIL_QUEUE_ENABLED: "false" }),
    (error) => error instanceof EmailWorkerError && error.code === "email_queue_disabled",
  );
  assert.throws(
    () => loadEmailWorkerConfig({ ...BASE_ENV, SUPABASE_URL: "http://supabase.example" }),
    (error) => error instanceof EmailWorkerError && error.code === "invalid_supabase_url",
  );
  assert.throws(
    () => loadEmailWorkerConfig({ ...BASE_ENV, RESEND_API_KEY: "changeme" }),
    (error) => error instanceof EmailWorkerError && error.code === "missing_resend_api_key",
  );
  assert.throws(
    () => config({ EMAIL_WORKER_CONCURRENCY: "0" }),
    (error) =>
      error instanceof EmailWorkerError && error.code === "invalid_email_worker_concurrency",
  );
  assert.throws(
    () =>
      config({
        EMAIL_WORKER_BATCH_SIZE: "10",
        EMAIL_WORKER_CONCURRENCY: "1",
        EMAIL_WORKER_REQUEST_TIMEOUT_MS: "30000",
        EMAIL_WORKER_VISIBILITY_TIMEOUT_SECONDS: "300",
      }),
    (error) =>
      error instanceof EmailWorkerError &&
      error.code === "unsafe_email_worker_visibility_budget",
  );
});

test("payload validation restricts recipients, verified sender domains, content, and TTL", () => {
  const now = Date.parse("2026-09-04T00:10:00.000Z");
  assert.equal(parseEmailQueueMessage(message(), config(), now).messageId, "message-123");
  assert.throws(
    () =>
      parseEmailQueueMessage(
        message({ to: "alice@example.com\r\nBcc: bad@example.com" }),
        config(),
        now,
      ),
    (error) => error instanceof EmailWorkerError && error.code === "invalid_recipient",
  );
  assert.throws(
    () =>
      parseEmailQueueMessage(message({ from: "Attacker <attacker@other.example>" }), config(), now),
    (error) => error instanceof EmailWorkerError && error.code === "sender_domain_not_allowed",
  );
  assert.throws(
    () => parseEmailQueueMessage(message({ queued_at: "2026-09-03T22:00:00.000Z" }), config(), now),
    (error) => error instanceof EmailWorkerError && error.code === "email_expired",
  );
  assert.throws(
    () => parseEmailQueueMessage(message({ html: "", text: "" }), config(), now),
    (error) => error instanceof EmailWorkerError && error.code === "invalid_email_body",
  );
});

test("successful delivery uses provider idempotency then records and deletes the queue row", async () => {
  const api = mockApi();
  const logs = [];
  const dispatcher = createEmailDispatcher(config(), {
    fetchImpl: api.fetchImpl,
    now: () => Date.parse("2026-09-04T00:10:00.000Z"),
    log: (level, event, fields) => logs.push({ level, event, fields }),
  });

  const report = await dispatcher.pollOnce();
  assert.deepEqual(report, {
    processed: 1,
    sent: 1,
    suppressed: 0,
    alreadyComplete: 0,
    retrying: 0,
    deadLettered: 0,
    retryAfterMs: 0,
  });
  const send = api.calls.find((call) => call.url === "https://api.resend.com/emails");
  assert.ok(send);
  assert.equal(send.headers.get("idempotency-key"), "idem-123");
  assert.equal(send.body.from, "KovaGPT <noreply@notify.kovagpt.com>");
  assert.equal(send.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const patch = api.calls.find(
    (call) => call.method === "PATCH" && call.url.includes("email_send_log"),
  );
  assert.equal(patch.body.status, "sent");
  assert.equal(patch.body.metadata.provider_id, "provider-message-123");
  assert.ok(api.calls.some((call) => call.url.endsWith("/rpc/delete_email")));
  assert.doesNotMatch(JSON.stringify(logs), /alice@example\.com|Private body/);
});

test("terminal log reconciliation and suppression never call the provider", async () => {
  for (const scenario of [
    { logStatus: "sent", expected: "alreadyComplete" },
    { logStatus: "pending", suppressed: true, expected: "suppressed" },
  ]) {
    const api = mockApi(scenario);
    const report = await createEmailDispatcher(config(), {
      fetchImpl: api.fetchImpl,
      now: () => Date.parse("2026-09-04T00:10:00.000Z"),
    }).pollOnce();
    assert.equal(report[scenario.expected], 1);
    assert.equal(
      api.calls.filter((call) => call.url === "https://api.resend.com/emails").length,
      0,
    );
    assert.ok(api.calls.some((call) => call.url.endsWith("/rpc/delete_email")));
  }
});

test("transient delivery errors retain the queue row until the bounded final attempt", async () => {
  const retryApi = mockApi({ resendStatus: 503, readCount: 1 });
  const retry = await createEmailDispatcher(config({ EMAIL_WORKER_MAX_ATTEMPTS: "3" }), {
    fetchImpl: retryApi.fetchImpl,
    now: () => Date.parse("2026-09-04T00:10:00.000Z"),
  }).pollOnce();
  assert.equal(retry.retrying, 1);
  assert.equal(retry.retryAfterMs, 3_000);
  assert.equal(retryApi.calls.filter((call) => call.url.endsWith("/rpc/delete_email")).length, 0);
  assert.equal(
    retryApi.calls.filter((call) => call.url.endsWith("/rpc/dead_letter_tracked_email")).length,
    0,
  );
  const deferred = retryApi.calls.find((call) =>
    call.url.endsWith("/rpc/defer_email_retry"),
  );
  assert.ok(deferred);
  assert.equal(deferred.body.p_retry_after_seconds, 3);
  assert.equal(deferred.body.p_lease_seconds, 300);

  const finalApi = mockApi({ resendStatus: 503, readCount: 3 });
  const final = await createEmailDispatcher(config({ EMAIL_WORKER_MAX_ATTEMPTS: "3" }), {
    fetchImpl: finalApi.fetchImpl,
    now: () => Date.parse("2026-09-04T00:10:00.000Z"),
  }).pollOnce();
  assert.equal(final.deadLettered, 1);
  const deadLetter = finalApi.calls.find((call) =>
    call.url.endsWith("/rpc/dead_letter_tracked_email"),
  );
  assert.ok(deadLetter);
  assert.equal(deadLetter.body.p_log_id, "log-123");
  assert.equal(deadLetter.body.p_reason, "resend_http_503");
  assert.equal(deadLetter.body.p_attempts, 3);
  assert.equal(finalApi.calls.filter((call) => call.url.endsWith("/rpc/delete_email")).length, 0);
});

test("invalid or untracked payloads are dead-lettered without becoming an open relay", async () => {
  const api = mockApi({
    rows: [
      {
        msg_id: 17,
        read_ct: 1,
        message: message({ from: "Attacker <attacker@other.example>" }),
      },
    ],
  });
  const logs = [];
  const report = await createEmailDispatcher(config(), {
    fetchImpl: api.fetchImpl,
    now: () => Date.parse("2026-09-04T00:10:00.000Z"),
    log: (level, event, fields) => logs.push({ level, event, fields }),
  }).pollOnce();
  assert.equal(report.deadLettered, 1);
  assert.equal(api.calls.filter((call) => call.url === "https://api.resend.com/emails").length, 0);
  assert.doesNotMatch(JSON.stringify(logs), /alice@example\.com|Private body|attacker@/);
});

test("a shared provider cooldown prevents every replica from reclaiming queues early", async () => {
  const api = mockApi({ cooldownUntil: "2026-09-04T00:10:45.000Z" });
  const dispatcher = createEmailDispatcher(config(), {
    fetchImpl: api.fetchImpl,
    now: () => Date.parse("2026-09-04T00:10:00.000Z"),
  });

  const report = await dispatcher.pollOnce();
  assert.deepEqual(report, {
    processed: 0,
    sent: 0,
    suppressed: 0,
    alreadyComplete: 0,
    retrying: 0,
    deadLettered: 0,
    retryAfterMs: 45_000,
  });
  assert.equal(
    api.calls.filter((call) => call.url.endsWith("/rpc/read_email_batch")).length,
    0,
  );
  assert.equal(api.calls.filter((call) => call.url === "https://api.resend.com/emails").length, 0);
});
