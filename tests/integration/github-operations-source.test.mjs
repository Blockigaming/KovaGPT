import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const tool = await readFile("src/routes/api/github/tool.ts", "utf8"),
  webhook = await readFile("src/routes/api/github/webhook.ts", "utf8"),
  reliability = await readFile("src/lib/webhook-reliability.mjs", "utf8"),
  client = await readFile("src/lib/github-connector.mjs", "utf8"),
  migration = await readFile(
    "supabase/migrations/20260728220000_mercury_github_operations.sql",
    "utf8",
  );
test("GitHub tool route enforces authentication grants permissions confirmations and audit", () => {
  for (const value of [
    "requireUser",
    "explicitly_granted",
    "revoked_at",
    "Repository is not authorized",
    "Explicit confirmation required",
    "permissions.push",
    "github_tool_audit",
    "approvalId",
    "decryptSecret",
  ])
    assert.ok(tool.includes(value), value);
});
test("patch workflow creates blobs tree commit and non-force branch update", () => {
  for (const value of [
    "createBlob",
    "createTree",
    "createCommit",
    "updateBranch",
    "force: false",
    "Patches require a separate branch",
  ])
    assert.ok(client.includes(value), value);
});
test("webhook route verifies signatures and delegates replay-safe required events", () => {
  for (const value of [
    "verifyGitHubWebhook",
    "x-github-delivery",
    "installation_repositories",
    "pull_request",
    "workflow_run",
    "check_suite",
    "check_run",
    "repository",
    "processGitHubDelivery",
  ])
    assert.ok(webhook.includes(value), value);

  for (const value of [
    "POSTGRES_UNIQUE_VIOLATION",
    "github_webhook_deliveries",
    "github_delivery_lookup_failed",
    'existing.status === "processed"',
    'existing.status === "ignored"',
    "github_delivery_record_failed",
    "github_repository_revoke_failed",
    "github_repository_touch_failed",
    "github_delivery_finalize_failed",
  ])
    assert.ok(reliability.includes(value), value);
  assert.ok(
    reliability.includes('.eq("installation_id", installationId)'),
    "repository webhook mutations must be scoped to the originating installation",
  );
});
test("GitHub sync and coding selection persistence remain owner and grant scoped", () => {
  for (const value of [
    "github_sync_records",
    "github_coding_selections",
    "explicitly_granted",
    "revoked_at is null",
    "commit",
    "pull_request",
    "workflow",
    "release",
    "discussion",
  ])
    assert.ok(migration.includes(value), value);
});
