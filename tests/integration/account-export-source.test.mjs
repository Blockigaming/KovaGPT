import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("account export ingress is authenticated, bounded, rate-limited, and no-store", async () => {
  const route = await read("src/routes/api/account/export.ts");
  assert.match(route, /requireVerifiedUser\(request\)/u);
  assert.match(route, /isCrossSiteMutation\(request\)/u);
  assert.match(route, /readBoundedJsonObject\(request, 512\)/u);
  assert.match(route, /ACCOUNT_EXPORT_RATE_LIMIT/u);
  assert.match(route, /accountExportCooldownRetryAfter/u);
  assert.doesNotMatch(route, /windowSeconds:\s*86_400/u);
  assert.match(route, /"Cache-Control": "no-store"/u);
  assert.match(route, /createSignedUrl\(result\.data\.storage_path, 300\)/u);
  assert.doesNotMatch(route, /getPublicUrl/u);
  assert.ok(
    route.indexOf("accountExportCooldownRetryAfter") <
      route.indexOf('.from("account_export_jobs")\n          .insert'),
    "the durable cooldown must run before a new export job is inserted",
  );
  assert.ok(
    route.indexOf('.update({\n            status: "canceled"') <
      route.indexOf("await clearAccountExportArtifacts(auth.userId, body.id)"),
    "cancellation must revoke database access before deleting every attempt artifact",
  );
  const cancellationUpdate = route.slice(
    route.indexOf('.update({\n            status: "canceled"'),
    route.indexOf("if (updated.error)"),
  );
  assert.doesNotMatch(cancellationUpdate, /storage_path:\s*null/u);
  assert.doesNotMatch(cancellationUpdate, /worker_id:\s*null/u);
  assert.ok(
    route.indexOf("await clearAccountExportArtifacts(auth.userId, body.id)") <
      route.indexOf("await finalizeAccountExportArtifactCleanup(auth.userId, body.id)"),
    "object removal must succeed before cancellation clears retry metadata",
  );
  assert.match(route, /account_export_delete_failed[\s\S]*cleanupPending: true/u);
  assert.match(
    route,
    /selected\.data\.status === "processing"[\s\S]*account_export_processing[\s\S]*retryRequired: true[\s\S]*409/u,
  );
  assert.match(route, /\.eq\("status", selected\.data\.status\)/u);
  assert.doesNotMatch(route, /selected\.data\.status[^\n]*(?:canceled|cancelled)/u);
});

test("the worker uses leases, private storage, redaction, and truthful settlement", async () => {
  const worker = await read("src/lib/account-export.server.ts");
  assert.match(worker, /claim_account_export_jobs/u);
  assert.match(worker, /settle_account_export_success/u);
  assert.match(worker, /settle_account_export_failure/u);
  assert.match(worker, /sanitizeAccountExportValue/u);
  assert.match(worker, /account-exports/u);
  assert.match(worker, /upsert: false/u);
  assert.match(worker, /clearAccountExportArtifacts/u);
  assert.match(worker, /settled\.data === "queued"/u);
  assert.match(worker, /createHash\("sha256"\)/u);
  assert.match(worker, /OAuth credentials, access tokens/u);
  assert.match(worker, /assertClaimStillOwnsUpload/u);
  assert.doesNotMatch(
    worker.slice(worker.indexOf("async function processClaimed"), worker.indexOf("const path =")),
    /clearAccountExportArtifacts/u,
  );
  assert.match(worker, /storage[\s\S]*\.remove\(\[uploadedPath\]\)/u);
});

test("account deletion is fenced and export cleanup completes before auth cascade", async () => {
  const accountRoute = await read("src/routes/api/account.ts");
  const cleanup = await read("src/lib/account-export.server.ts");
  const storageCleanup = await read("src/lib/account-storage-cleanup.server.ts");
  const migration = await read(
    "supabase/migrations/20260903204500_account_export_deletion_fence.sql",
  );

  assert.ok(
    accountRoute.indexOf("cleanupAccountExportsBeforeAccountDeletion(auth.userId)") <
      accountRoute.indexOf(".auth.admin.deleteUser("),
    "auth deletion must not cascade export metadata before cleanup",
  );
  assert.match(accountRoute, /account_export_cleanup_pending/u);
  assert.match(accountRoute, /account_export_cleanup_failed/u);
  assert.match(cleanup, /begin_account_export_account_deletion/u);
  assert.match(cleanup, /discoverAccountExportJobIds/u);
  assert.match(cleanup, /job\.status === "processing"/u);
  assert.match(cleanup, /cancel_account_export_account_deletion/u);
  assert.match(accountRoute, /cleanupOwnedStorageBeforeAccountDeletion/u);
  assert.match(accountRoute, /releaseAccountExportDeletionFence\(auth\.userId\)/u);
  assert.ok(
    accountRoute.indexOf("await cleanupOwnedStorageBeforeAccountDeletion(") <
      accountRoute.indexOf(".auth.admin.deleteUser("),
    "all owned Storage objects must be removed before Auth deletion",
  );
  assert.match(storageCleanup, /account_storage_cleanup_unverified/u);
  assert.match(migration, /account_deletion_fences/u);
  assert.match(migration, /cancel_account_export_account_deletion/u);
  assert.match(migration, /before insert on public\.account_export_jobs/u);
  assert.match(migration, /set status = 'canceled', updated_at = now\(\)/u);
  assert.doesNotMatch(migration, /set status = 'canceled',[\s\S]{0,180}storage_path\s*=\s*null/u);
});

test("the internal export runner fails closed behind a dedicated or cron secret", async () => {
  const route = await read("src/routes/api/internal/account-exports.ts");
  assert.match(route, /ACCOUNT_EXPORT_WORKER_SECRET/u);
  assert.match(route, /CRON_SECRET/u);
  assert.match(route, /timingSafeEqualText/u);
  assert.match(route, /account_export_worker_not_configured/u);
  assert.doesNotMatch(route, /request\.text\(/u);
});

test("readiness and product ledgers classify cloud export truthfully", async () => {
  const readiness = await read("src/lib/readiness.server.ts");
  const capability = await read("docs/feature-parity.md");
  const parity = await read("docs/chatgpt-feature-parity.md");
  assert.match(
    readiness,
    /accountExports: capability\(any\("ACCOUNT_EXPORT_WORKER_SECRET", "CRON_SECRET"\)\)/u,
  );
  assert.match(capability, /private asynchronous cloud-account export backend/u);
  assert.match(
    capability,
    /Production migration, worker scheduling, and multi-account verification remain required/u,
  );
  assert.match(parity, /production migration, worker scheduling, authenticated UI wiring/u);
});
