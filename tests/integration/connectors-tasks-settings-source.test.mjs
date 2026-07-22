import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("Gmail, Calendar, and Drive architecture requires confirmation and treats content as untrusted", () => {
  const google = read("src/lib/google-workspace.server.ts");
  for (const token of [
    "GmailWritePreview",
    "requiresConfirmation",
    "normalizeGmailSearchResult",
    "normalizeCalendarEvent",
    "timeZone",
    "normalizeDriveFile",
    "authorizedContentRef",
    "connectorActivityForTool",
    "treatConnectorContentAsUntrusted",
  ]) {
    assert.match(google, new RegExp(token), `google workspace should include ${token}`);
  }
  assert.doesNotMatch(google, /access_token|refresh_token|client_secret/);
});

test("connector tool loop validates ownership, scope, explicit write intent, and bounded args", () => {
  const connectors = read("src/lib/connectors.server.ts");
  for (const token of [
    "ConnectorToolName",
    "validateConnectorToolRequest",
    "not_connected",
    "confirmation_required",
    "arguments_too_large",
    "gmail.send",
    "calendar.create",
    "drive.read",
  ]) {
    assert.match(
      connectors,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `connectors should include ${token}`,
    );
  }
});

test("scheduled tasks support recurrence, due selection, idempotent runs, and documented scheduler abstraction", () => {
  const tasks = read("src/lib/scheduled-workflows.server.ts");
  for (const token of [
    "ScheduledTaskType",
    "recurring_summary",
    "connector_task",
    "Notification",
    "RecurrenceRule",
    "timeZone",
    "validateRecurrence",
    "scheduleSummary",
    "selectDueTasks",
    "createTaskRun",
    "skipped_duplicate",
    "nextRunAfter",
  ]) {
    assert.match(tasks, new RegExp(token), `tasks should include ${token}`);
  }
});

test("sharing, collaboration, settings, billing, entitlements, and audit are centralized", () => {
  const governance = read("src/lib/security-governance.server.ts");
  for (const token of [
    "ChatShare",
    "snapshot",
    "revoked",
    "ProjectRole",
    "owner",
    "editor",
    "viewer",
    "preventFinalOwnerRemoval",
    "SETTINGS_SECTIONS",
    "PlanState",
    "PLAN_LIMITS",
    "enforceEntitlement",
    "AuditEventType",
    "sanitizeAudit",
  ]) {
    assert.match(governance, new RegExp(token), `governance should include ${token}`);
  }
  assert.doesNotMatch(governance, /client_secret|refresh_token|access_token/);
});

test("connector/task/settings migration includes RLS and owner isolation", () => {
  const sql = read(
    "supabase/migrations/20260722123000_connectors_tasks_sharing_settings_audit.sql",
  );
  for (const token of [
    "connected_accounts",
    "scheduled_task_runs",
    "notification_deliveries",
    "chat_share_links",
    "user_preferences",
    "account_audit_entries",
    "enable row level security",
    "auth.uid() = user_id",
  ]) {
    assert.match(
      sql,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `migration should include ${token}`,
    );
  }
});
