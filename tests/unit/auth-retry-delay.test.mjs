import { test } from "node:test";
import assert from "node:assert/strict";
import { authRetryDelay } from "../../src/lib/auth-retry-delay.mjs";
import { readFileSync } from "node:fs";
test("authoritative seconds and absolute Retry-After are respected", () => {
  assert.equal(authRetryDelay("120"), 120);
  assert.equal(authRetryDelay("0"), 0);
  assert.equal(
    authRetryDelay("Mon, 19 Oct 2026 02:30:00 GMT", Date.parse("2026-10-19T02:28:00Z")),
    120,
  );
  for (const value of [null, "", "invalid", "-2"]) assert.equal(authRetryDelay(value), null);
});
test("verification consumes delay before rejecting and uses fallback only without a server delay", () => {
  const source = readFileSync("src/routes/auth.tsx", "utf8");
  assert.match(source, /authRetryDelay\(response.headers.get\("Retry-After"\)\)/);
  assert.ok(
    source.indexOf("if (retryDelay !== null)") <
      source.indexOf('throw new Error("verification_unavailable")'),
  );
});
