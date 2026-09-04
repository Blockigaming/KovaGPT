import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Project files use the trusted bounded endpoint, never browser Storage writes", () => {
  const route = read("src/routes/api/project-files.ts");
  const ui = read("src/routes/projects.$projectId.tsx");
  const workspace = read("src/lib/project-workspace.functions.ts");

  for (const contract of [
    "requireVerifiedUser",
    "isCrossSiteMutation",
    "readProjectFileBody",
    "inspectProjectFile",
    "sha256Hex",
    "reserve_project_file_upload",
    "enforceQuota",
    "enforceStorage",
    "upload_attempt_id",
    "finalize_project_file_delete",
  ]) {
    assert.match(route, new RegExp(contract));
  }
  assert.match(ui, /fetch\("\/api\/project-files"/);
  assert.match(ui, /X-Kova-Idempotency-Key/);
  assert.doesNotMatch(ui, /storage\.from\("project-files"\)\.upload/);
  assert.doesNotMatch(workspace, /registerUploadedFile|deleteProjectFile/);
  assert.match(workspace, /\.eq\("status", "ready"\)/);
  assert.match(workspace, /createSignedUrl\(it\.storage_path, 60\)/);
});

test("Project file migration serializes caps and removes browser mutations", () => {
  const migration = read(
    "supabase/migrations/20260904200000_project_file_upload_integrity.sql",
  );

  assert.match(migration, /FOR UPDATE OF p/);
  assert.match(migration, /project_files_upload_idempotency_unique/);
  assert.match(migration, /upload_lease_until/);
  assert.match(migration, /storage_charged/);
  assert.match(migration, /file_size_limit[\s\S]*10485760/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.project_files FROM authenticated/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.reserve_project_file_upload[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.reserve_project_file_upload[\s\S]*TO service_role/,
  );
  for (const policy of [
    "project_files_write",
    "project_files_update",
    "project_files_delete",
  ]) {
    assert.match(migration, new RegExp(`DROP POLICY IF EXISTS "${policy}"`));
  }
});
