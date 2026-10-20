import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/routes/api/account.ts", "utf8");
const cleanup = readFileSync("src/lib/account-storage-cleanup.server.ts", "utf8");

test("account deletion finishes ordered Storage cleanup before Auth deletion", () => {
  const finalizer = readFileSync("src/lib/account-deletion-finalizer.server.ts", "utf8");
  assert.match(route, /makeAccountLifecycleHandlers\(\{ authenticate: requireUser \}\)/);
  assert.doesNotMatch(route, /cleanupOwnedStorageBeforeAccountDeletion|auth\.admin\.deleteUser/);
  const storageAt = finalizer.lastIndexOf("cleanupOwnedStorageBeforeAccountDeletion(");
  const confirmAt = finalizer.lastIndexOf("await confirmAccountFinalization(");
  const authDeleteAt = finalizer.indexOf("auth.admin.deleteUser(");
  assert.ok(storageAt > 0);
  assert.ok(confirmAt > storageAt && authDeleteAt > confirmAt);
  assert.match(finalizer, /if \(!storageCleanup\.complete\)/u);
  assert.match(finalizer, /account_storage_cleanup_pending/u);
  assert.match(finalizer, /Retry-After": "5"/u);
});

test("account Storage cleanup keeps Library last and releases metadata after bytes", () => {
  const projectAt = cleanup.indexOf("cleanupOwnedProjectFiles(");
  const evidenceAt = cleanup.lastIndexOf("AGENT_EVIDENCE_BUCKET");
  const libraryAt = cleanup.lastIndexOf("LIBRARY_IMAGE_BUCKET");
  assert.ok(projectAt > 0);
  assert.ok(evidenceAt > projectAt);
  assert.ok(libraryAt > evidenceAt);

  const storageRemoveAt = cleanup.indexOf("client.storage.from(bucket).remove(paths)");
  const metadataDeleteAt = cleanup.indexOf("projectFiles(client).delete().in");
  assert.ok(storageRemoveAt > 0);
  assert.ok(metadataDeleteAt > storageRemoveAt);
  assert.doesNotMatch(cleanup, /MAX_STORAGE_ENTRIES|entry_limit_exceeded/u);
  assert.match(cleanup, /offset: 0/u);
  assert.match(cleanup, /projects!inner\(owner_id\)/u);
  assert.match(cleanup, /\.eq\("projects\.owner_id", userId\)/u);
  assert.match(cleanup, /loadProjectFileAssociations/u);
  assert.match(cleanup, /externallyReferencedProjectObjects/u);
  assert.match(cleanup, /entry\.bucket !== PROJECT_FILE_BUCKET/u);
  assert.match(cleanup, /list_account_project_storage_objects/u);
});
