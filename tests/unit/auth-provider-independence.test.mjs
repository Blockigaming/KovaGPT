import assert from "node:assert/strict";
import test from "node:test";

import { inspectAuthProviderContract } from "../../scripts/release/auth-provider-contract.mjs";

test("KovaGPT authentication is Supabase-owned and active source is Clerk-free", () => {
  const result = inspectAuthProviderContract();
  assert.deepEqual(result.errors, []);
  for (const warning of result.warnings) {
    assert.match(warning, /package-lock\.json:[^\n]*@clerk\//u);
  }
});

test("strict auth-provider validation rejects any Clerk package in the lock graph", () => {
  const result = inspectAuthProviderContract({ requireCleanLock: true });
  assert.ok(result.errors.some((finding) => /package-lock\.json:[^\n]*@clerk\//u.test(finding)));
});
