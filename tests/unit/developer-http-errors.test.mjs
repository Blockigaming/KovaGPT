import assert from "node:assert/strict";
import test from "node:test";
import {
  developerHttpError,
  developerRateError,
  developerRetryHeaders,
} from "../../src/lib/pricing/developer-http-errors.mjs";
test("public failure categories preserve known contract and redact unknown provider exceptions", () => {
  for (const [code, status] of Object.entries({
    developer_unauthorized: 401,
    developer_scope_required: 403,
    developer_owner_required: 403,
    developer_prompt_not_found: 404,
    developer_idempotency_conflict: 409,
    developer_quote_expired: 409,
    developer_upload_quota_exceeded: 409,
    developer_input_invalid: 400,
    developer_idempotency_key_required: 400,
    developer_rate_limit: 429,
    developer_rate_unavailable: 503,
    developer_settlement_unavailable: 503,
  })) {
    assert.deepEqual(developerHttpError(new Error(code)), {
      status,
      code,
      message: code.replaceAll("_", " "),
    });
  }
  assert.equal(
    developerHttpError(Object.assign(new Error("private"), { code: "request_too_large" })).status,
    413,
  );
  assert.equal(
    developerHttpError(Object.assign(new Error("private"), { code: "invalid_utf8" })).code,
    "developer_input_invalid",
  );
  assert.equal(developerHttpError(new Error("upstream secret")).code, "developer_unavailable");
});
test("throttle headers and limiter outage are distinct and fail closed", () => {
  assert.equal(developerRateError({ allowed: true, status: "allowed" }), null);
  assert.equal(
    developerRateError({ allowed: false, status: "limited" }).message,
    "developer_rate_limit",
  );
  for (const value of [
    null,
    {},
    { allowed: false, status: "unavailable" },
    { allowed: true, status: "unavailable" },
  ])
    assert.equal(developerRateError(value).message, "developer_rate_unavailable");
  assert.deepEqual(developerRetryHeaders(429), { "Retry-After": "60" });
  assert.deepEqual(developerRetryHeaders(503), {});
});
