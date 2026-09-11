import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("release manifest is ordered, unique, and content-addressed", async () => {
  const m = JSON.parse(await readFile(new URL("../../release-migrations.json", import.meta.url)));
  assert.ok(m.count > 50);
  assert.equal(new Set(m.migrations.map((x) => x.timestamp)).size, m.count);
  assert.deepEqual(
    m.migrations.map((x) => x.filename),
    [...m.migrations.map((x) => x.filename)].sort(),
  );
  assert.ok(m.migrations.every((x) => /^[a-f0-9]{64}$/.test(x.sha256)));
});
test("function inventories preserve plain schema-qualified function names", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../release-migrations.json", import.meta.url)),
  );
  const workflowSkills = manifest.migrations.find(
    (entry) => entry.filename === "20260910210000_workflow_skill_packages.sql",
  );
  const scheduledTasks = manifest.migrations.find(
    (entry) => entry.filename === "20260905005111_scheduled_tasks_activation_foundation.sql",
  );
  assert.deepEqual(workflowSkills.functions, [
    "workflow_skill_principal_current",
    "list_workflow_skills",
    "mutate_workflow_skill",
    "resolve_workflow_skill",
  ]);
  assert.ok(scheduledTasks.functions.includes("next_task_occurrence"));
  assert.ok(manifest.migrations.every((entry) => !entry.functions.includes("kova_private")));

  const contract = JSON.parse(
    await readFile(new URL("../../database-contract.json", import.meta.url)),
  );
  assert.ok(contract.functions.includes("workflow_skill_principal_current"));
  assert.ok(!contract.functions.includes("kova_private"));
});
test("security hardening migration protects legacy definers and webhook claims", async () => {
  const s = await readFile(
    new URL(
      "../../supabase/migrations/20260803110000_release_security_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(s, /set search_path = public, pg_temp/);
  assert.match(s, /revoke all.*anon, authenticated/i);
});
