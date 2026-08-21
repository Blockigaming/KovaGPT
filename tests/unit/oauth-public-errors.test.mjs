import assert from "node:assert/strict";
import test from "node:test";

import { publicOAuthErrorCode, safeOAuthLogCode } from "../../src/lib/oauth-security.server.ts";

test("OAuth endpoints expose only approved machine codes", () => {
  assert.equal(
    publicOAuthErrorCode(new Error("provider_not_configured"), "oauth_start_failed"),
    "provider_not_configured",
  );
  assert.equal(
    publicOAuthErrorCode(new Error("linked_account_not_found"), "disconnect_failed"),
    "linked_account_not_found",
  );
  assert.equal(
    publicOAuthErrorCode(new Error("oauth_exchange_401"), "oauth_start_failed"),
    "connection_failed",
  );
  assert.equal(
    publicOAuthErrorCode(new Error("token=secret-value"), "oauth_start_failed"),
    "oauth_start_failed",
  );
  assert.equal(
    publicOAuthErrorCode({ message: "database details" }, "disconnect_failed"),
    "disconnect_failed",
  );
});

test("OAuth logs retain safe codes without leaking arbitrary exceptions", () => {
  assert.equal(safeOAuthLogCode(new Error("oauth_profile_403")), "oauth_profile_403");
  assert.equal(safeOAuthLogCode(new Error("oauth_state_replayed")), "oauth_state_replayed");
  assert.equal(safeOAuthLogCode(new Error("client_secret=do-not-log")), "oauth_failure");
});
