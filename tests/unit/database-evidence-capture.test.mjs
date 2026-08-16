import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/release/capture-database-evidence.mjs", "utf8");

test("database rehearsal evidence is read-only, comprehensive, and production blocked", () => {
  assert.match(source, /database_evidence_production_target_prohibited/u);
  assert.match(source, /pg_policies/u);
  assert.match(source, /security_definer/u);
  assert.match(source, /information_schema\.triggers/u);
  assert.match(source, /pg_extension/u);
  assert.match(source, /supabase_migrations\.schema_migrations/u);
  assert.match(source, /rls_disabled/u);
  assert.match(source, /--set", "ON_ERROR_STOP=1/u);
  assert.doesNotMatch(source, /\b(?:insert|update|delete|alter|drop|create|truncate)\b/iu);
});
