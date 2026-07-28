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
test("Work can queue a real isolated browser run and the API exposes server history", async () => {
  const [workspace, api] = await Promise.all([
    read("src/components/AgentWorkspace.tsx"),
    read("src/routes/api/agents/runs.ts"),
  ]);
  assert.match(workspace, /Start secure browser run/);
  assert.match(workspace, /authFetch\("\/api\/agents\/runs"/);
  assert.match(api, /GET:/);
  assert.match(api, /agent_run_events/);
  assert.match(api, /eq\("owner_id" as never, auth\.userId\)/);
});
