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
    "try_add_storage_bytes",
    "storage_owner_id",
    "authorization.ownerId",
    "unsupported_media_type",
    "upload_attempt_id",
    "finalize_project_file_delete",
  ]) {
    assert.match(route, new RegExp(contract));
  }
  assert.match(ui, /fetch\(\`\/api\/project-files\$\{search\}\`/);
  assert.match(ui, /X-Kova-Idempotency-Key/);
  assert.match(ui, /getFreshFileUrl/);
  assert.match(ui, /url\.protocol !== "https:"/);
  assert.match(ui, /window\.open\("about:blank", "_blank"\)/);
  assert.ok(
    ui.indexOf('window.open("about:blank", "_blank")') <
      ui.indexOf("await getFreshFileUrl(file.id)"),
    "the mobile-safe target must open during the user gesture",
  );
  assert.match(ui, /onError=\{\(\) => void refreshImageUrl\(f\)\}/);
  assert.doesNotMatch(ui, /storage\.from\("project-files"\)\.upload/);
  assert.doesNotMatch(workspace, /registerUploadedFile|deleteProjectFile/);
  assert.match(workspace, /\.eq\("status", "ready"\)/);
  assert.match(workspace, /Promise\.all/);
  assert.match(workspace, /createSignedUrl\(item\.storage_path, 60\)/);
});

test("Project file migration serializes caps and removes browser mutations", () => {
  const migration = read("supabase/migrations/20260904200000_project_file_upload_integrity.sql");

  assert.match(migration, /FOR UPDATE OF p/);
  assert.match(migration, /project_files_upload_idempotency_unique/);
  assert.match(migration, /upload_lease_until/);
  assert.match(migration, /storage_charged/);
  assert.match(migration, /p_user_id, project_owner, 'pending'/);
  assert.match(
    migration,
    /kind = 'agent-deliverable'[\s\S]*storage_path !~ '\(\^\|\/\)\\\.\\\.\?\(\/\|\$\)'/,
  );
  assert.match(migration, /CREATE POLICY "files_select_members"[\s\S]*status = 'ready'/);
  assert.match(migration, /pf\.storage_path = storage\.objects\.name[\s\S]*pf\.status = 'ready'/);
  assert.match(migration, /file_size_limit[\s\S]*10485760/);
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE ON public\.project_files FROM authenticated/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.reserve_project_file_upload[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.reserve_project_file_upload[\s\S]*TO service_role/,
  );
  for (const policy of ["project_files_write", "project_files_update", "project_files_delete"]) {
    assert.match(migration, new RegExp(`DROP POLICY IF EXISTS "${policy}"`));
  }
});
