import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  authenticateEmailWorkerRequest,
  signEmailWorkerRequest,
} from "../../src/lib/kova-email-worker-auth.server.mjs";

const secret = "local-fixture-worker-secret-0123456789";
const runId = "263750fa-451a-4d06-9486-0007336bff3e";
const issuedAt = "2026-10-21T10:20:30.000Z";
const now = Date.parse(issuedAt);
const env = { KOVA_EMAIL_WORKER_SECRET: secret };

function request({
  url = "https://kovagpt.com/api/internal/email-dispatch",
  method = "POST",
  body = "{}",
  headers = {},
} = {}) {
  return new Request(url, {
    method,
    ...(method === "GET" ? {} : { body }),
    headers: {
      "content-type": "application/json",
      "x-kova-email-run-id": runId,
      "x-kova-email-issued-at": issuedAt,
      "x-kova-email-signature": signEmailWorkerRequest({ runId, issuedAt }, secret),
      ...headers,
    },
  });
}

function rejectsSafely(operation, code = "email_worker_unauthorized") {
  assert.throws(operation, (error) => {
    assert.equal(error.name, "EmailWorkerAuthError");
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.doesNotMatch(
      error.stack,
      /local-fixture-worker-secret|https:\/\/kovagpt|x-kova-email-signature/,
    );
    return true;
  });
}

test("signing matches the exact version, method, path, identifiers and fixed empty body", () => {
  const expected = createHmac("sha256", secret)
    .update(`kova-email-worker-v1\nPOST\n/api/internal/email-dispatch\n${runId}\n${issuedAt}\n{}`)
    .digest("hex");
  assert.equal(signEmailWorkerRequest({ runId, issuedAt }, secret), expected);
  assert.deepEqual(authenticateEmailWorkerRequest(request(), env, now), { runId, issuedAt });
});

test("authentication leaves body consumption and database replay authority to the handler", async () => {
  const req = request({ body: '{"not":"empty"}' });
  assert.deepEqual(authenticateEmailWorkerRequest(req, env, now), { runId, issuedAt });
  assert.equal(req.bodyUsed, false);
  assert.equal(await req.text(), '{"not":"empty"}');
  assert.deepEqual(authenticateEmailWorkerRequest(request(), env, now), { runId, issuedAt });
});

test("a signature of caller-controlled body content is never accepted", () => {
  const signature = createHmac("sha256", secret)
    .update(
      `kova-email-worker-v1\nPOST\n/api/internal/email-dispatch\n${runId}\n${issuedAt}\n{"not":"empty"}`,
    )
    .digest("hex");
  rejectsSafely(() =>
    authenticateEmailWorkerRequest(
      request({ headers: { "x-kova-email-signature": signature } }),
      env,
      now,
    ),
  );
});

test("wrong methods, paths, encoded paths and any query or fragment are rejected", async (t) => {
  for (const options of [
    { method: "GET" },
    { method: "PUT" },
    { url: "https://kovagpt.com/api/internal/email-dispatch/" },
    { url: "https://kovagpt.com/api/internal/%65mail-dispatch" },
    { url: "https://kovagpt.com/api/internal/email-dispatch?mode=execute" },
    { url: "https://kovagpt.com/api/internal/email-dispatch?" },
    { url: "https://kovagpt.com/api/internal/email-dispatch#private" },
    { url: "https://kovagpt.com/api/internal/email-dispatch#" },
  ])
    await t.test(JSON.stringify(options), () =>
      rejectsSafely(() => authenticateEmailWorkerRequest(request(options), env, now)),
    );
});

test("JSON content type is required and media-type parameters are accepted", () => {
  for (const type of ["text/plain", "application/problem+json", "", "application/jsonx"])
    rejectsSafely(() =>
      authenticateEmailWorkerRequest(request({ headers: { "content-type": type } }), env, now),
    );
  assert.deepEqual(
    authenticateEmailWorkerRequest(
      request({ headers: { "content-type": "application/json; charset=utf-8" } }),
      env,
      now,
    ),
    { runId, issuedAt },
  );
});

test("the exact 60-second past and 5-second future boundaries are enforced", () => {
  for (const clock of [now - 5_000, now, now + 60_000])
    assert.deepEqual(authenticateEmailWorkerRequest(request(), env, clock), { runId, issuedAt });
  for (const clock of [now - 5_001, now + 60_001, NaN, Infinity])
    rejectsSafely(() => authenticateEmailWorkerRequest(request(), env, clock));
});

test("malformed identifiers, noncanonical timestamps and signatures are rejected safely", async (t) => {
  for (const headers of [
    { "x-kova-email-run-id": "not-a-uuid" },
    { "x-kova-email-run-id": `${runId}extra` },
    { "x-kova-email-issued-at": "2026-10-21T10:20:30Z" },
    { "x-kova-email-issued-at": "2026-02-30T10:20:30.000Z" },
    { "x-kova-email-issued-at": "2026-10-21T10:20:30.000+00:00" },
    { "x-kova-email-signature": "f".repeat(63) },
    { "x-kova-email-signature": "F".repeat(64) },
    { "x-kova-email-signature": "g".repeat(64) },
    { "x-kova-email-signature": "0".repeat(64) },
    { "x-kova-email-signature": "" },
  ])
    await t.test(Object.keys(headers)[0] + ":" + Object.values(headers)[0], () =>
      rejectsSafely(() => authenticateEmailWorkerRequest(request({ headers }), env, now)),
    );
});

test("tampered valid identifiers cannot reuse the original signature", () => {
  for (const headers of [
    { "x-kova-email-run-id": "263750fa-451a-4d06-9486-0007336bff3f" },
    { "x-kova-email-issued-at": "2026-10-21T10:20:29.000Z" },
  ])
    rejectsSafely(() => authenticateEmailWorkerRequest(request({ headers }), env, now));
});

test("a shared CRON secret never substitutes for the dedicated worker credential", () => {
  for (const config of [
    { CRON_SECRET: secret },
    { KOVA_EMAIL_WORKER_SECRET: "", CRON_SECRET: secret },
  ])
    rejectsSafely(
      () => authenticateEmailWorkerRequest(request(), config, now),
      "email_worker_unavailable",
    );
  assert.deepEqual(
    authenticateEmailWorkerRequest(request(), { ...env, CRON_SECRET: "unrelated" }, now),
    { runId, issuedAt },
  );
  rejectsSafely(() =>
    authenticateEmailWorkerRequest(
      request(),
      {
        KOVA_EMAIL_WORKER_SECRET: "different-private-worker-secret-0123456789",
        CRON_SECRET: secret,
      },
      now,
    ),
  );
});

test("missing, short and multiline secrets disable authentication without revealing inputs", () => {
  for (const config of [
    {},
    { KOVA_EMAIL_WORKER_SECRET: "short", CRON_SECRET: secret },
    { KOVA_EMAIL_WORKER_SECRET: `${secret}\n` },
    { CRON_SECRET: `${secret}\r` },
  ])
    rejectsSafely(
      () => authenticateEmailWorkerRequest(request(), config, now),
      "email_worker_unavailable",
    );
});

test("signing rejects invalid identifiers and unusable secrets", () => {
  rejectsSafely(
    () => signEmailWorkerRequest({ runId: "invalid", issuedAt }, secret),
    "email_worker_signing_input_invalid",
  );
  rejectsSafely(
    () => signEmailWorkerRequest({ runId, issuedAt: "invalid" }, secret),
    "email_worker_signing_input_invalid",
  );
  rejectsSafely(
    () => signEmailWorkerRequest({ runId, issuedAt }, "short"),
    "email_worker_unavailable",
  );
});
