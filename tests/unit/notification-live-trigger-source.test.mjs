import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTIFICATION_IDS, notificationDefinition } from "../../src/lib/notification-catalog.mjs";

const source = (path) => readFileSync(path, "utf8");

test("notification host exists exactly once in the root for every app route", () => {
  const root = source("src/routes/__root.tsx");
  assert.match(root, /<RootNotificationCenter\s*\/>/);
  assert.match(root, /<KovaNotificationSurface key=/);
  assert.doesNotMatch(source("src/components/AppShell.tsx"), /<KovaNotificationSurface\s*\/>/);
  assert.doesNotMatch(source("src/routes/images.tsx"), /<KovaNotificationSurface\s*\/>/);
});

test("real feature operations emit exact source-backed notices", () => {
  const expected = {
    "src/components/LibraryUploadDialog.tsx": ["upload_completed", "upload_failed"],
    "src/routes/images.tsx": ["image_ready", "image_limit", "image_failed", "image_copied"],
    "src/routes/projects.tsx": ["project_created", "project_deleted", "project_updated"],
    "src/components/ShareChatDialog.tsx": ["sharing_link_copied", "sharing_disabled"],
    "src/components/ComposerVoiceDialog.tsx": ["voice_listening", "dictation_ready", "voice_limit"],
    "src/components/ScheduledTaskEditor.tsx": ["task_created", "task_updated"],
    "src/routes/scheduled-tasks.tsx": ["task_deleted", "task_paused", "task_resumed"],
    "src/components/WorkspaceJoinDialog.tsx": ["workspace_join_requested"],
    "src/components/WorkspaceJoinAdminPanel.tsx": [
      "workspace_join_approved",
      "workspace_join_denied",
    ],
    "src/components/KovaPasswordPanel.tsx": ["password_updated"],
    "src/components/AccountEmailPreferences.tsx": ["notification_preferences_updated"],
    "src/components/ProjectCollaboration.tsx": [
      "project_comment_posted",
      "project_comment_deleted",
    ],
  };
  for (const [path, ids] of Object.entries(expected)) {
    const content = source(path);
    assert.match(content, /publishKovaNotice\s*\(/, path);
    for (const id of ids) {
      assert.ok(NOTIFICATION_IDS.includes(id), id + " is missing from the catalog");
      assert.ok(content.includes('"' + id + '"'), path + ": no " + id + " trigger");
    }
  }
});

test("workspace discovery requires verified domain, not an email suffix heuristic", () => {
  const sql = source(
    "supabase/migrations/20261110224500_kova_verified_team_workspace_join_requests.sql",
  );
  assert.match(sql, /team_verified_domains/);
  assert.match(sql, /team_verified_email\(p_actor\)/);
  assert.match(sql, /team_join_requests/);
  assert.match(sql, /gmail\.com/);
  assert.match(sql, /claim_team_join_notification/);
  assert.match(sql, /notification_lease_until/);
  assert.match(sql, /notification_attempts < 6/);
  assert.match(sql, /notification_started_at > now\(\)-interval '20 hours'/);
  assert.match(sql, /grant execute on function public\.claim_team_join_notification/);
  assert.match(source("src/lib/workspace-join.functions.ts"), /retryWorkspaceJoinNotification/);
  assert.match(source("src/lib/team-invitations.server.ts"), /retryWorkspaceJoinNotification/);
  assert.match(source("src/components/Sidebar.tsx"), /verifiedWorkspaceEmail/);
});

test("nonblocking sources stay contextual; confirmations are cancellable", () => {
  assert.equal(notificationDefinition("file_selected")?.surface, "status");
  assert.equal(notificationDefinition("upload_failed")?.surface, "inline");
  assert.equal(notificationDefinition("image_limit")?.surface, "inline");
  assert.equal(notificationDefinition("file_saved")?.surface, "toast");
  assert.equal(notificationDefinition("connection_failed")?.surface, "toast");
  assert.equal(notificationDefinition("confirm_account_delete")?.surface, "modal");
  assert.equal(notificationDefinition("confirm_account_delete")?.dismissible, true);
});
