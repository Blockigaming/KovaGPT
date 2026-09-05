import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("generic OAuth uses hashed one-time state, PKCE and encrypted token custody", async () => {
  const [oauth, vault, migration] = await Promise.all([
    read("src/integrations/oauth-lifecycle.server.ts"),
    read("src/integrations/credential-vault.server.ts"),
    read("supabase/migrations/20260727210000_constellation_connectors_agents.sql"),
  ]);
  assert.match(oauth, /state_hash: await sha256\(state\)/);
  assert.match(oauth, /code_challenge_method", "S256"/);
  assert.match(oauth, /is\("consumed_at", null\)/);
  assert.match(vault, /AES-GCM/);
  assert.match(vault, /bytes\.length !== 32/);
  assert.doesNotMatch(oauth, /localStorage|sessionStorage/);
  assert.match(migration, /unique\(owner_id, provider_id, provider_account_id\)/);
});

test("disconnect is owner-scoped, revokes provider access and cancels sync", async () => {
  const oauth = await read("src/integrations/oauth-lifecycle.server.ts");
  assert.match(oauth, /eq\("owner_id", ownerId\)/);
  assert.match(oauth, /provider\.revocationEndpoint/);
  assert.match(oauth, /integration_sync_jobs/);
  assert.match(oauth, /status: "cancelled"/);
  assert.doesNotMatch(oauth, /return \{[^}]*refresh_token/s);
});

test("scope-aware tools hide writes and require consequential confirmation", async () => {
  const tools = await read("src/integrations/tools.ts");
  assert.match(tools, /grantedScopes/);
  assert.match(tools, /writesAllowed/);
  assert.match(tools, /tool\.mode === "write" \|\| tool\.consequential/);
});

test("finance and health records are isolated and finance is read-only", async () => {
  const [migration, plaid] = await Promise.all([
    read("supabase/migrations/20260727210000_constellation_connectors_agents.sql"),
    read("src/finances/plaid.server.ts"),
  ]);
  assert.match(migration, /create table if not exists public\.financial_connections/);
  assert.match(migration, /create table if not exists public\.health_connections/);
  assert.match(plaid, /products: \["transactions", "liabilities", "investments"\]/);
  assert.doesNotMatch(plaid, /payment_initiation|transfer\/create|orders\/create/);
});

test("browser agents fail closed while legacy controls remain owner scoped", async () => {
  const [execution, worker, api, policy] = await Promise.all([
    read("src/agents/execution.server.ts"),
    read("workers/browser-agent.mjs"),
    read("src/routes/api/agents/runs.ts"),
    read("src/agents/policy.ts"),
  ]);
  for (const tier of ["plus", "pro", "business", "enterprise"])
    assert.match(execution, new RegExp(`${tier}:`));
  assert.match(execution, /supabaseUser\.rpc\("control_disabled_browser_run"/);
  assert.match(execution, /p_approval_id: approvalId \?\? null/);
  assert.match(execution, /command === "resume"[\s\S]+browser_agent_unavailable/);
  assert.match(api, /browser_agent_unavailable/);
  assert.match(api, /status: 503/);
  assert.match(worker, /legacy agent_runs browser worker is disabled/);
  assert.doesNotMatch(worker, /chromium|createClient|while \(true\)/);
  assert.match(policy, /raw_secret_entry_prohibited/);
});

test("no user-visible Voice surface remains in Omega", async () => {
  const omega = await read("src/routes/omega.tsx");
  assert.doesNotMatch(omega, /VoicePanel|Check microphone permission|\["voice", "Voice"/);
  assert.doesNotMatch(omega, /getUserMedia/);
});
