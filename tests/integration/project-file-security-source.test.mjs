import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Project files use the trusted bounded endpoint, never browser Storage writes", () => {
  const route = read("src/routes/api/project-files.ts");
  const ui = read("src/routes/projects.$projectId.tsx");
  const workspace = read("src/lib/project-workspace.functions.ts");
  const auth = read("src/lib/api-auth.server.ts");
  const lifecycle = route + read("src/lib/project-file-maintenance.server.ts");

  for (const contract of [
    "requireVerifiedUser",
    "isCrossSiteMutation",
    "readProjectFileBody",
    "inspectProjectFile",
    "sha256Hex",
    "reserve_project_file_upload",
    "acquire_project_file_upload_quota",
    "set_project_file_upload_state",
    "abort_project_file_upload",
    "claim_stale_project_file_cleanup",
    "renew_stale_project_file_cleanup",
    "fail_stale_project_file_cleanup",
    "finalize_stale_project_file_cleanup",
    "claim_project_file_delete",
    "restore_project_file_delete",
    "finalize_project_file_delete",
    "acquire_project_file_upload_quota",
    "reconcileProjectFileLifecycle",
    "storage_owner_id",
    "authorization.ownerId",
    "unsupported_media_type",
    "upload_attempt_id",
    "reserveAccountStorageArtifact",
    "retireAccountStorageArtifact",
    "project_file_delete_in_progress",
    "cleanupStaleProjectUploadObjects",
    "ProjectFileMaintenanceClient",
    "projectFileObjectPresence",
    'presence === "unknown"',
    'presence === "present"',
  ]) {
    assert.ok(lifecycle.includes(contract), `missing lifecycle contract: ${contract}`);
  }
  assert.doesNotMatch(route, /try_add_storage_bytes/);
  assert.doesNotMatch(route, /enforceQuota/);
  assert.doesNotMatch(route, /user_plan_tier/);
  assert.match(route, /getUserTier\(auth, project\.owner_id\)/);
  assert.match(auth, /resolveEffectiveBillingTier\(caller\.supabaseAdmin, userId\)/);
  assert.match(auth, /export async function getUserTier/);
  assert.match(read("src/lib/billing-entitlement.server.ts"), /rpc\("effective_user_plan_tier"/);
  const uploadHandler = route.slice(
    route.indexOf("async function upload"),
    route.indexOf("function missingObject"),
  );
  const deleteHandler = route.slice(
    route.indexOf("async function remove"),
    route.indexOf("async function sign"),
  );
  assert.match(uploadHandler, /requireVerifiedUser\(request\)/);
  assert.match(deleteHandler, /requireUser\(request\)/);
  assert.doesNotMatch(deleteHandler, /requireVerifiedUser\(request\)/);
  assert.match(route, /storage_charged: row\.storage_charged/);
  assert.match(route, /owner_id,deletion_requested_at/);
  assert.match(route, /project\.deletion_requested_at[\s\S]*project_deletion_pending/);
  assert.match(route, /file\.kind !== "agent-deliverable"/);
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
  assert.doesNotMatch(workspace, /\.from\("project_files"\)\s*\.select\("\*"\)/);
  assert.match(
    workspace,
    /\.select\("id, project_id, name, storage_path, mime_type, size_bytes, kind, created_at"\)/,
  );
  assert.match(workspace, /item\.kind === "agent-deliverable"/);
  assert.match(workspace, /Promise\.all/);
  assert.match(workspace, /createSignedUrl\(item\.storage_path, 60\)/);
});

test("all Project file readers explicitly hide unsettled rows", () => {
  for (const path of [
    "src/lib/projects.functions.ts",
    "src/lib/project-workspace.functions.ts",
    "src/lib/chat-workspace-context.server.ts",
    "src/lib/chat-workspace.functions.ts",
    "src/routes/api/project-files.ts",
  ]) {
    assert.match(read(path), /\.eq\("status", "ready"\)/, path);
  }
});

test("Project file migration serializes caps, accounting, and crash recovery", () => {
  const migration = read("supabase/migrations/20260904200000_project_file_upload_integrity.sql");
  const maintenance = read("src/lib/project-file-maintenance.server.ts");
  const ui = read("src/routes/projects.$projectId.tsx");

  assert.match(migration, /FOR UPDATE OF p/);
  assert.match(migration, /project_files_upload_idempotency_unique/);
  assert.match(migration, /upload_lease_until/);
  assert.match(migration, /delete_lease_until/);
  assert.match(migration, /storage_charged/);
  assert.match(migration, /upload_quota_acquired/);
  assert.match(
    migration,
    /legacy_to_charge[\s\S]*storage_owner_id = legacy\.owner_id[\s\S]*user_storage/,
  );
  assert.match(migration, /existing\.status = 'deleting'[\s\S]*project_file_delete_pending/);
  assert.match(migration, /id <> existing\.id[\s\S]*current_count >= p_file_cap/);
  assert.match(migration, /try_add_storage_bytes\(project_owner, p_size_bytes, p_storage_limit\)/);
  assert.match(migration, /kind = 'agent-deliverable'/);
  assert.match(
    migration,
    /kind IN \('file', 'image'\)[\s\S]*content_sha256 IS NULL[\s\S]*storage_path ~ \('\^' \|\| project_id::text \|\| '\/'\)/,
  );
  assert.match(migration, /status IN \('ready', 'deleting'\)/);
  assert.match(
    migration,
    /project_files_name_length_check[\s\S]*content_sha256 IS NULL OR char_length\(name\)/,
  );
  assert.match(migration, /project_files_size_check[\s\S]*content_sha256 IS NULL OR size_bytes/);
  assert.ok(migration.includes("storage_path !~ '(^|/)\\.\\.?(/|$)'"));
  assert.match(migration, /CREATE POLICY "files_select_members"[\s\S]*status = 'ready'/);
  assert.match(migration, /pf\.storage_path = storage\.objects\.name[\s\S]*pf\.status = 'ready'/);
  assert.match(migration, /file_size_limit[\s\S]*10485760/);
  assert.match(
    migration,
    /abort_project_file_upload[\s\S]*greatest\(0, bytes_used - target\.size_bytes\)/,
  );
  assert.match(
    migration,
    /acquire_project_file_upload_quota[\s\S]*try_increment_daily_usage[\s\S]*upload_quota_acquired = true/,
  );
  assert.match(
    migration,
    /Uploads completed by the immediately preceding implementation[\s\S]*SET upload_quota_acquired = true[\s\S]*VALIDATE CONSTRAINT project_files_upload_quota_check/,
  );
  assert.match(migration, /claim_project_file_delete[\s\S]*'inProgress', true/);
  assert.match(migration, /claim_stale_project_file_cleanup[\s\S]*FOR UPDATE SKIP LOCKED/);
  assert.match(
    migration,
    /finalize_stale_project_file_cleanup[\s\S]*settle_project_source_storage_charge/,
  );
  assert.match(migration, /restore_project_file_delete[\s\S]*delete_lease_until = NULL/);
  assert.match(migration, /finalize_project_file_delete[\s\S]*'idempotent', true/);
  assert.doesNotMatch(migration, /\nAS \$\n|\n\$;\n/);
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE ON public\.project_files FROM authenticated/,
  );
  for (const rpc of [
    "reserve_project_file_upload",
    "abort_project_file_upload",
    "claim_project_file_delete",
    "restore_project_file_delete",
    "finalize_project_file_delete",
  ]) {
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}[\\s\\S]*FROM PUBLIC, anon, authenticated`),
    );
    assert.match(
      migration,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}[\\s\\S]*TO service_role`),
    );
  }
  for (const policy of ["project_files_write", "project_files_update", "project_files_delete"]) {
    assert.match(migration, new RegExp(`DROP POLICY IF EXISTS "${policy}"`));
  }

  assert.match(maintenance, /purgeProjectUploadAttemptFolder/);
  assert.match(maintenance, /claim_stale_project_file_cleanup/);
  assert.match(maintenance, /renew_stale_project_file_cleanup/);
  assert.match(maintenance, /finalize_stale_project_file_cleanup/);
  assert.match(maintenance, /source\.bucket !== PROJECT_FILES_BUCKET/);
  assert.match(maintenance, /assertProjectStoragePath\(item\.projectId, source\.path\)/);
  assert.match(ui, /Files could not be loaded because earlier storage cleanup is incomplete/);
  assert.match(ui, /role="alert"/);
  assert.match(ui, /className="mt-3 min-h-11"/);
});

test("recovered reservations cannot bypass quota and stale rows remain recoverable", () => {
  const route = read("src/routes/api/project-files.ts");
  const migration = read("supabase/migrations/20260904200000_project_file_upload_integrity.sql");
  const upload = route.slice(
    route.indexOf("async function upload"),
    route.indexOf("function missingObject"),
  );

  assert.match(upload, /let uploadQuotaAcquired = row\.upload_quota_acquired/);
  assert.match(upload, /if \(!uploadQuotaAcquired\)[\s\S]*acquireUploadQuota/);
  assert.doesNotMatch(upload, /if \(row\.reservationCreated\)[\s\S]*getCallerTier/);
  assert.ok(
    upload.indexOf("reconcileProjectFileLifecycle") < upload.indexOf("reserve_project_file_upload"),
    "stale charges must be reconciled before a new reservation checks caps",
  );
  assert.match(
    migration,
    /status IN \('pending', 'upload_failed', 'cleanup_failed'\)[\s\S]*upload_lease_until > now\(\)/,
  );
  assert.match(
    migration,
    /claim_stale_project_file_cleanup[\s\S]*status = 'deleting'[\s\S]*delete_lease_until <= now\(\)/,
  );
  assert.match(migration, /set_project_file_upload_state[\s\S]*lock_project_for_file_operation/);
});
