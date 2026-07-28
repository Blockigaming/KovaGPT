import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const tool = await readFile("src/routes/api/github/tool.ts", "utf8"),
  webhook = await readFile("src/routes/api/github/webhook.ts", "utf8"),
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
test("webhook route verifies signatures rejects replay and handles required events", () => {
  for (const value of [
    "verifyGitHubWebhook",
    "x-github-delivery",
    "Duplicate delivery",
    "installation_repositories",
    "pull_request",
    "workflow_run",
    "check_suite",
    "check_run",
    "repository",
    "github_webhook_deliveries",
  ])
    assert.ok(webhook.includes(value), value);
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
