import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = "src/routes/api/project-templates.ts";
const migrationPath = "supabase/migrations/20260903220000_project_templates.sql";

test("Project template ingress is authenticated, bounded, rate-limited, and no-store", async () => {
  const route = await readFile(routePath, "utf8");
  assert.match(route, /requireUser\(request\)/u);
  assert.match(route, /isCrossSiteMutation\(request\)/u);
  assert.match(route, /readBoundedJsonObject\(request, PROJECT_TEMPLATE_MAX_BODY_BYTES\)/u);
  assert.match(route, /consumeApplicationRateLimit/u);
  assert.match(route, /getCallerTier\(auth\)/u);
  assert.match(route, /project_template_protection_unavailable/u);
  assert.match(route, /"Cache-Control": "no-store"/u);
  assert.doesNotMatch(route, /request\.json\(/u);
  assert.doesNotMatch(route, /console\.(?:log|error|warn)/u);
});

test("Project template storage is immutable, permissioned, and service-mutated", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.project_template_versions/u);
  assert.match(migration, /primary key \(template_id, version\)/u);
  assert.match(migration, /can_copy boolean not null/u);
  assert.match(migration, /project_template_audit_events/u);
  assert.match(migration, /project_template_mutations/u);
  assert.match(migration, /project_template_revision_conflict/u);
  assert.match(migration, /project_template_copy_denied/u);
  assert.match(migration, /project_limit_reached/u);
  assert.match(migration, /p_project_limit not in \(3, 25, 200\)/u);
  assert.match(migration, /for update/u);
  assert.match(migration, /pg_advisory_xact_lock/u);
  assert.match(migration, /security invoker/gu);
  assert.match(migration, /revoke all on function public\.copy_project_template/u);
  assert.doesNotMatch(migration, /security definer/iu);
});

test("Project template audits never store template content", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const auditWrites = [
    ...migration.matchAll(/insert into public\.project_template_audit_events[\s\S]*?;/gu),
  ];
  assert.ok(auditWrites.length >= 6);
  for (const [write] of auditWrites) {
    assert.doesNotMatch(write, /p_snapshot|v_snapshot|systemPrompt|projectDescription/u);
  }
});
