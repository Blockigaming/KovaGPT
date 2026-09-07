import assert from "node:assert/strict";
import test from "node:test";

import { inspectAuthProviderContract } from "../../scripts/release/auth-provider-contract.mjs";

test("KovaGPT authentication is Supabase-owned and Clerk-free", () => {
  const result = inspectAuthProviderContract();
  assert.deepEqual(result.errors, []);
  for (const warning of result.warnings) {
    assert.match(warning, /package-lock\.json:root:@clerk\/clerk-react/u);
  }
});

test("auth-provider source scan tolerates a tracked file deleted before staging", () => {
  const result = inspectAuthProviderContract({ files: ["src/lib/deleted-before-stage.ts"] });
  assert.deepEqual(result.errors, []);
});
