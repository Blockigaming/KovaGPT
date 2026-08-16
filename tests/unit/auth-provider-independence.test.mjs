import assert from "node:assert/strict";
import test from "node:test";

import { inspectAuthProviderContract } from "../../scripts/release/auth-provider-contract.mjs";

test("KovaGPT authentication is Supabase-owned and Clerk-free", () => {
  assert.deepEqual(inspectAuthProviderContract(), []);
});
