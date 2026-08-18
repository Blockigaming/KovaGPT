import assert from "node:assert/strict";
import test from "node:test";

import { publicFinanceError } from "../../src/finances/public-errors.server.ts";

test("finance APIs expose only approved public error codes", () => {
  assert.deepEqual(publicFinanceError(new Error("plaid_not_configured"), "finance_unavailable"), {
    error: "plaid_not_configured",
    status: 503,
    logCode: "plaid_not_configured",
  });
  assert.deepEqual(
    publicFinanceError(new Error("finance_region_ineligible"), "finance_unavailable"),
    {
      error: "finance_region_ineligible",
      status: 400,
      logCode: "finance_region_ineligible",
    },
  );
  assert.deepEqual(publicFinanceError(new Error("plaid_401"), "finance_exchange_failed"), {
    error: "finance_provider_unavailable",
    status: 502,
    logCode: "plaid_401",
  });
  assert.deepEqual(
    publicFinanceError(new Error("secret=do-not-return"), "finance_exchange_failed"),
    {
      error: "finance_exchange_failed",
      status: 500,
      logCode: "finance_failure",
    },
  );
});
