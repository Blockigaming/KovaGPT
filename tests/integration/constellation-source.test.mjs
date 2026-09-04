import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
test("parity manifest fails closed when official live verification is unavailable", async () => {
  const manifest = await read("src/integrations/chatgpt-parity-manifest.ts");
  assert.match(manifest, /official_directory_unavailable/);
  assert.match(manifest, /CHATGPT_PARITY_APPS: readonly ChatGptParityApp\[\] = \[\]/);
  assert.match(manifest, /KOVA_EXTENSION_PROVIDER_IDS/);
});
test("provider families have credential-ready adapters and callbacks", async () => {
  const [providers, callback, accounts] = await Promise.all([
    read("src/integrations/oauth-providers.server.ts"),
    read("src/routes/api/integrations/oauth/callback/$provider.ts"),
    read("src/routes/api/integrations/accounts.ts"),
  ]);
  for (const provider of ["microsoft", "github", "slack", "notion", "linear", "dropbox", "box"])
    assert.match(providers, new RegExp(`${provider}:`));
  assert.match(callback, /completeOAuth/);
  assert.match(accounts, /configuredOAuthProviders/);
});
test("sync policy applies bounded retry and deletion propagation", async () => {
  const sync = await read("src/integrations/sync-policy.ts");
  assert.match(sync, /Math\.min\(15 \* 60_000/);
  assert.match(sync, /propagateDeletion: true/);
  assert.match(sync, /retry_wait/);
});
test("Work exposes history but browser execution fails closed", async () => {
  const [workspace, api, execution, teamApi, teamExecution] = await Promise.all([
    read("src/components/AgentWorkspace.tsx"),
    read("src/routes/api/agents/runs.ts"),
    read("src/agents/execution.server.ts"),
    read("src/routes/api/agents/teams.ts"),
    read("src/agents/team.server.ts"),
  ]);
  assert.match(workspace, /Secure browser runs unavailable/);
  assert.doesNotMatch(workspace, /authFetch\("\/api\/agents\/runs"|run queued/);
  assert.match(api, /GET:/);
  assert.match(api, /agent_run_events/);
  assert.match(api, /eq\("owner_id" as never, auth\.userId\)/);
  assert.match(api, /browser_agent_unavailable/);
  assert.match(api, /status: 503/);
  assert.doesNotMatch(api, /status: 202/);
  assert.match(execution, /Promise<never>/);
  assert.match(execution, /throw new Error\("browser_agent_unavailable"\)/);
  assert.match(teamApi, /agent_team_execution_unavailable/);
  assert.match(teamApi, /status: 503/);
  assert.doesNotMatch(teamApi, /status: 202/);
  const disabledTeamCreate = teamExecution.slice(
    teamExecution.indexOf("export async function createAgentTeamRun"),
    teamExecution.indexOf("export async function getAgentTeamRuns"),
  );
  assert.match(disabledTeamCreate, /Promise<never>/);
  assert.match(disabledTeamCreate, /throw new Error\("agent_team_execution_unavailable"\)/);
  assert.doesNotMatch(disabledTeamCreate, /\.from\("agent_runs"\)|status: "queued"/);
  assert.match(teamExecution, /command !== "cancel" && command !== "deny"/);
  assert.match(teamExecution, /rawUser\(caller\)\.rpc\("control_disabled_agent_team_run"/);
  assert.doesNotMatch(teamExecution, /\.from\("agent_run_tasks"\)[\s\S]*?\.update\(/);
});
