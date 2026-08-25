import assert from "node:assert/strict";
import test from "node:test";
import { validateSupabaseProductionContract } from "../../scripts/supabase/production-contract.mjs";

test("Supabase production contract has unique migrations, RLS, backups, and two-user isolation", () => {
  const result = validateSupabaseProductionContract();
  assert.equal(result.uniqueVersions, true);
  assert.equal(result.twoUserIsolationHarness, true);
  assert.ok(result.requiredTables.length >= 4);
});
