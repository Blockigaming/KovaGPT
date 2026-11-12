import test from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_IDS } from "../../src/lib/notification-catalog.mjs";
import { rows, summary } from "../../scripts/audit-notification-coverage.mjs";

test("all declared notification types have an explicit audit disposition", () => {
  assert.equal(rows.length, NOTIFICATION_IDS.length);
  assert.equal(new Set(rows.map((row) => row.id)).size, NOTIFICATION_IDS.length);
  assert.equal(summary.sourceConnected + summary.missingSourceEmitter, summary.total);
  for (const row of rows) {
    assert.ok(row.group, row.id + " has no category");
    assert.equal(typeof row.sourceConnected, "boolean");
    assert.equal(row.verifiedEndToEnd, false, "source wiring alone is not end-to-end acceptance");
  }
});
test("critical real operations stay source-bound rather than catalog-only", () => {
  for (const id of [
    "workspace_join_requested",
    "workspace_join_approved",
    "upload_failed",
    "checkout_started",
    "checkout_unavailable",
    "task_created",
    "image_ready",
    "project_created",
  ]) {
    const row = rows.find((x) => x.id === id);
    assert.ok(row?.sourceConnected, id + " has no source emitter");
  }
});

test("source-owned notice surfaces and typed dynamic emitters retain their actual source", () => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of [
    "confirm_project_delete",
    "confirm_chat_delete",
    "confirm_file_delete",
    "confirm_account_delete",
    "confirm_leave_project",
    "disconnect_confirm",
    "join_workspace_offer",
    "sketch_unsaved",
    "no_matching_files",
    "external_approval",
  ]) {
    assert.ok(byId.get(id)?.nativeSurfaces.length, id);
    assert.equal(byId.get(id).verifiedEndToEnd, false);
  }
  for (const id of ["voice_limit", "analysis_started", "message_too_long", "conversation_full"]) {
    assert.ok(byId.get(id)?.conditionalEmitters.length, id);
  }
  assert.equal(summary.unclassifiedDynamicEmitters, 0);
});
