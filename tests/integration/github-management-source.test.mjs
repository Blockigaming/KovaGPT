import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const server = await readFile("src/lib/github.functions.ts", "utf8"),
  ui = await readFile("src/routes/apps.tsx", "utf8"),
  migration = await readFile("supabase/migrations/20260728180000_mercury_github.sql", "utf8");
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
test("installation refresh cannot claim another owner's global App installations", () => {
  assert.match(server, /from\("github_accounts"\)[\s\S]*eq\("owner_id", context\.userId\)/);
  assert.ok(server.includes("listGitHubAppInstallations"));
  assert.ok(server.includes('installation.account?.type === "User"'));
  assert.ok(server.includes("Number(account.github_user_id)"));
  assert.ok(server.includes("/user/memberships/orgs/"));
  assert.ok(server.includes('access.state === "active" && access.role === "admin"'));
  assert.ok(server.includes("decryptSecret(account.token_ciphertext)"));
  assert.ok(server.includes('onConflict: "owner_id,id"'));
  assert.ok(migration.includes("github_installations(id bigint not null"));
  assert.ok(migration.includes("primary key(owner_id,id)"));
  assert.ok(
    migration.includes(
      "foreign key(owner_id,installation_id) references public.github_installations(owner_id,id)",
    ),
  );
});
test("the same GitHub repository can be granted independently by multiple owners", () => {
  assert.ok(migration.includes("primary key(owner_id,id)"));
  assert.ok(
    migration.includes(
      "foreign key(owner_id,repository_id) references public.github_repositories(owner_id,id)",
    ),
  );
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
test("Apps GitHub selections cannot survive disconnecting their account", () => {
  assert.match(
    ui,
    /setSelected\(\(current\) => current\.filter\(\(id\) => activeRepositoryIds\.has\(id\)\)\)/u,
  );
  assert.match(
    ui,
    /const accountId = disconnectAccount\.id;[\s\S]*setSelected\(\[\]\);[\s\S]*disconnect\(/u,
  );
});
