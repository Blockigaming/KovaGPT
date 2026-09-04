import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Project deletion is durable, owner-only, lease-fenced, and Storage-first", () => {
  const migration = read(
    "supabase/migrations/20260904210000_project_deletion_storage_integrity.sql",
  );
  const coordinator = read("src/lib/project-deletion.server.ts");

  const jobDefinition = migration.match(
    /CREATE TABLE IF NOT EXISTS public\.project_deletion_jobs[\s\S]*?\n\);/,
  )?.[0];
  assert.ok(jobDefinition);
  assert.doesNotMatch(jobDefinition, /REFERENCES public\.projects/);
  assert.match(jobDefinition, /owner_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
  assert.match(migration, /ALTER TABLE public\.project_deletion_jobs ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.project_deletion_jobs FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /REVOKE DELETE ON TABLE public\.projects FROM PUBLIC, anon, authenticated/,
  );
  assert.match(migration, /DROP POLICY IF EXISTS "owner can delete project"/);
  assert.match(migration, /projects_storage_first_delete_guard/);

  assert.match(migration, /projects_deletion_write_fence/);
  assert.match(migration, /project_deletion_project_write_fence/);
  assert.match(migration, /project_deletion_child_write_fence/);
  assert.match(
    migration,
    /SET deletion_requested_at = now\(\)[\s\S]*deletion_requested_at IS NULL/,
  );
  for (const table of [
    "project_activity",
    "project_chats",
    "project_comments",
    "project_file_chunks",
    "project_invites",
    "project_members",
    "project_memory",
    "project_notes",
    "project_tasks",
  ]) {
    assert.match(migration, new RegExp(`${table}_deletion_write_fence`));
  }
  assert.match(
    migration,
    /project_row\.deletion_requested_at IS NOT NULL[\s\S]*metadata_finalizing/,
  );

  assert.match(
    migration,
    /pf\.status IN \('pending', 'upload_failed', 'cleanup_failed'\)[\s\S]*pf\.upload_lease_until > now\(\)/,
  );
  assert.match(migration, /pf\.status = 'deleting'[\s\S]*pf\.delete_lease_until > now\(\)/);
  assert.match(
    migration,
    /CREATE TRIGGER project_files_deletion_fence[\s\S]*BEFORE INSERT OR UPDATE ON public\.project_files/,
  );
  assert.doesNotMatch(
    migration,
    /OLD\.delete_attempt_id IS NOT NULL[\s\S]*NEW\.delete_attempt_id IS NULL/,
  );
  assert.match(migration, /project_file_operations_settling/);

  for (const fn of [
    "claim_project_deletion",
    "renew_project_deletion",
    "fail_project_deletion",
    "finalize_project_deletion",
  ]) {
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]*?FROM PUBLIC, anon, authenticated`),
    );
    assert.match(
      migration,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*?TO service_role`),
    );
  }
  for (const fence of [
    "project_deletion_project_write_fence",
    "project_deletion_child_write_fence",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${fence}\\(\\)[\\s\\S]*?FROM PUBLIC, anon, authenticated`,
      ),
    );
  }
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.abort_project_file_upload/);

  const claim = coordinator.indexOf('"claim_project_deletion"');
  const purge = coordinator.indexOf("purgeProjectStorageFolder({");
  const finalize = coordinator.indexOf('"finalize_project_deletion"');
  assert.ok(claim >= 0 && purge > claim && finalize > purge);
  assert.match(coordinator, /assertProjectStoragePath\(projectId, row\.storage_path\)/);
  assert.match(coordinator, /row\.kind === "agent-deliverable"/);
  assert.match(coordinator, /renewed !== true/);
  assert.match(coordinator, /markDeletionFailed/);
  assert.match(coordinator, /\.range\(start, start \+ METADATA_PAGE_SIZE - 1\)/);
});

test("Project and account routes keep incomplete cleanup visible and retryable", () => {
  const projectsFunctions = read("src/lib/projects.functions.ts");
  const account = read("src/routes/api/account.ts");
  const projectsRoute = read("src/routes/projects.tsx");
  const detailRoute = read("src/routes/projects.$projectId.tsx");
  const projectFilesRoute = read("src/routes/api/project-files.ts");

  const deleteFunction = projectsFunctions.slice(
    projectsFunctions.indexOf("export const deleteProject"),
    projectsFunctions.indexOf("// -------- Members --------"),
  );
  assert.match(deleteFunction, /deleteProjectStorageFirst/);
  assert.match(deleteFunction, /projectDeletionPublicMessage/);
  assert.doesNotMatch(deleteFunction, /\.from\("projects"\)\.delete/);

  const cleanupIndex = account.indexOf("deleteOwnedProjectsBeforeAccountDeletion");
  const authDeleteIndex = account.indexOf("auth.admin.deleteUser");
  assert.ok(cleanupIndex >= 0 && authDeleteIndex > cleanupIndex);
  assert.match(account, /Some projects may already have been deleted; retry to resume safely/);

  const uiDeleteIndex = projectsRoute.indexOf("await fnDelete({ data: { id: p.id } })");
  const uiRemovalIndex = projectsRoute.indexOf(
    "setProjects((current) => current.filter((project) => project.id !== p.id))",
  );
  assert.ok(uiDeleteIndex >= 0 && uiRemovalIndex > uiDeleteIndex);
  assert.match(projectsRoute, /await refresh\(\)/);
  assert.match(projectsRoute, /stored file copies/);
  assert.match(projectsRoute, /Deletion incomplete — retry cleanup/);
  assert.match(projectsRoute, /deletingProjectIds/);
  assert.match(projectsRoute, /aria-busy=\{deletingProjectIds\.has\(p\.id\)/);

  assert.match(detailRoute, /Project deletion is incomplete/);
  assert.match(detailRoute, /No new\s+workspace changes are accepted/);
  assert.match(detailRoute, /Retry deletion/);
  assert.match(detailRoute, /aria-busy=\{deletionBusy/);
  assert.match(detailRoute, /<span>\{confirmLabel\}…<\/span>/);

  assert.match(projectFilesRoute, /project_deletion_pending/);
  assert.match(projectFilesRoute, /"Retry-After": "5"/);
});

test("Project queries expose the durable deletion marker", () => {
  const projectsFunctions = read("src/lib/projects.functions.ts");
  assert.match(projectsFunctions, /deletion_requested_at: string \| null/);
  assert.match(projectsFunctions, /archived_at, deletion_requested_at/);
  assert.match(projectsFunctions, /updated_at, deletion_requested_at/);
  assert.match(
    projectsFunctions,
    /deletion_requested_at: \(p\.deletion_requested_at as string \| null\) \?\? null/,
  );
});

test("checked-in database types expose the deletion schema and every file RPC", () => {
  const types = read("src/integrations/supabase/types.ts");
  assert.match(types, /project_deletion_jobs: \{/);
  assert.match(types, /deletion_requested_at: string \| null/);
  for (const fn of [
    "abort_project_file_upload",
    "claim_project_deletion",
    "acquire_project_file_upload_quota",
    "claim_project_file_delete",
    "claim_stale_project_file_cleanup",
    "fail_project_deletion",
    "fail_stale_project_file_cleanup",
    "finalize_project_deletion",
    "finalize_project_file_delete",
    "finalize_stale_project_file_cleanup",
    "lock_project_for_file_operation",
    "release_project_storage_bytes",
    "renew_project_deletion",
    "renew_stale_project_file_cleanup",
    "reserve_project_file_upload",
    "restore_project_file_delete",
    "set_project_file_upload_state",
  ]) {
    assert.match(types, new RegExp(`${fn}: \\{`));
  }
});
