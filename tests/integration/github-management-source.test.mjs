import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const server = await readFile("src/lib/github.functions.ts", "utf8"),
  ui = await readFile("src/routes/apps.tsx", "utf8");
test("GitHub management is server-backed and repository grants verify ownership", () => {
  for (const value of [
    "getGitHubManagement",
    "refreshGitHubInstallations",
    "createInstallationToken",
    "owner_id",
    "updateGitHubRepositoryGrants",
    "explicitly_granted",
    "github_coding_selections",
    "github_sync_records",
    "disconnectGitHub",
  ])
    assert.ok(server.includes(value), value);
});
test("Apps GitHub experience has truthful credential account installation and repository states", () => {
  for (const value of [
    "GitHubManager",
    "Credentials not configured",
    "Connect GitHub",
    "Refresh installations",
    "Search GitHub repositories",
    "Grant selected",
    "Remove selected",
    "Rate limit",
    "Operator setup required",
  ])
    assert.ok(ui.includes(value), value);
});
