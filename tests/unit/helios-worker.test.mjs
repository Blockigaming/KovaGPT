import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertPublicUrl, isPrivateAddress } from "../../worker/src/network-safety.mjs";

const worker = await readFile("worker/src/index.mjs", "utf8");
const migration = await readFile(
  "supabase/migrations/20260728090000_helios_agent_runtime.sql",
  "utf8",
);
const compatibilityMigration = await readFile(
  "supabase/migrations/20260801235959_agent_runtime_event_schema_compatibility.sql",
  "utf8",
);
const constellationMigration = await readFile(
  "supabase/migrations/20260727210000_constellation_connectors_agents.sql",
  "utf8",
);
const workFunctions = await readFile("src/lib/work.functions.ts", "utf8");
const smokeTest = await readFile("worker/scripts/smoke-test.mjs", "utf8");
const dockerfile = await readFile("worker/Dockerfile", "utf8");
test("worker exposes liveness while readiness and execution fail closed", () => {
  for (const control of [
    "/healthz",
    "/readyz",
    "SIGTERM",
    "execution_enabled: false",
    "agent_runtime_unavailable",
    "worker_execution_disabled",
  ])
    assert.match(worker, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(worker, /request\.url === "\/readyz"[\s\S]+writeHead\(503/);
  assert.doesNotMatch(
    worker,
    /createClient|lease_agent_job|fail_agent_job|AI_PROVIDER|browserJob|chromium|page\.goto/,
  );
});
test("SSRF protection rejects private IPv4, IPv6, mapped IPv4, and private DNS answers", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:7f00:1",
    "2001:db8::1",
  ])
    assert.equal(isPrivateAddress(address), true, address);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
  await assert.rejects(
    assertPublicUrl("https://example.test/path", async () => [{ address: "fd00::1" }]),
    /Private network navigation is blocked/,
  );
  await assert.rejects(assertPublicUrl("http://[::ffff:7f00:1]/"), /Private network/);
  assert.equal(
    await assertPublicUrl("https://example.test/path", async () => [{ address: "93.184.216.34" }]),
    "https://example.test/path",
  );
});
test("historical cancellation settles immediately without resume or approval", () => {
  assert.match(
    migration,
    /recover_expired_agent_leases[\s\S]+set status='cancelled',error='Agent runtime unavailable'/,
  );
  assert.match(
    migration,
    /settle_interrupted_agent_job[\s\S]+set status='cancelled',error='Agent runtime unavailable'/,
  );
  assert.match(migration, /complete_agent_job[\s\S]+raise exception 'Agent runtime unavailable'/);
  assert.match(migration, /fail_agent_job[\s\S]+perform public\.settle_interrupted_agent_job/);
  assert.match(migration, /p_action <> 'cancel'/);
  assert.match(
    migration,
    /set status='cancelled',worker_id=null,lease_expires_at=null,completed_at=now\(\)/,
  );
  assert.doesNotMatch(migration, /p_action='resume'|p_action='pause'/);
  assert.match(migration, /p_decision <> 'denied'/);
  assert.doesNotMatch(migration, /request_metadata=coalesce/);
});
test("duplicated deliverables get a new identity while revisions retain their lineage", () => {
  assert.match(migration, /deliverable_key uuid not null default gen_random_uuid\(\)/);
  assert.match(migration, /unique \(owner_id, deliverable_key, revision\)/);
  assert.match(workFunctions, /deliverable_key,[\s\S]+\.\.\.copy/);
  assert.match(workFunctions, /eq\("deliverable_key", source\.data\.deliverable_key\)/);
  assert.match(
    workFunctions,
    /downloadDeliverable[\s\S]+select\("storage_reference"\)[\s\S]+createSignedUrl/,
  );
  assert.match(workFunctions, /listDeliverableVersions[\s\S]+select\("deliverable_key"\)/);
});
test("worker queue RPCs are not callable by browser roles", () => {
  for (const role of ["public, anon, authenticated", "security definer"])
    assert.ok(migration.toLowerCase().includes(role));
  assert.match(migration, /grant execute on function public\.lease_agent_job[\s\S]+service_role/);
  assert.match(migration, /grant execute on function public\.settle_interrupted_agent_job/);
  assert.match(migration, /returns setof public\.agent_jobs[\s\S]+begin\s+return;/);
  assert.match(migration, /revoke all on function public\.control_agent_job[\s\S]+public, anon/);
  assert.match(
    migration,
    /revoke all on function public\.decide_agent_approval[\s\S]+public, anon/,
  );
});
test("fresh and existing schemas keep run events separate from job events", () => {
  assert.match(constellationMigration, /create table if not exists public\.agent_run_events/);
  assert.match(migration, /create table public\.agent_job_events/);
  assert.doesNotMatch(migration, /create table public\.agent_run_events/);
  assert.match(compatibilityMigration, /create table if not exists public\.agent_job_events/);
  assert.match(compatibilityMigration, /before insert or update of kind on public\.agent_jobs/);
  assert.match(compatibilityMigration, /raise exception 'Agent runtime unavailable'/);
  assert.match(compatibilityMigration, /with check \(false\)/);
  assert.match(compatibilityMigration, /returns setof public\.agent_jobs[\s\S]+begin\s+return;/);
  assert.match(
    compatibilityMigration,
    /complete_agent_job[\s\S]+raise exception 'Agent runtime unavailable'/,
  );
  assert.match(compatibilityMigration, /heartbeat_agent_job[\s\S]+set status = 'cancelled'/);
  assert.match(
    compatibilityMigration,
    /fail_agent_job[\s\S]+perform public\.settle_interrupted_agent_job/,
  );
  assert.doesNotMatch(
    compatibilityMigration,
    /(?:drop|truncate|rename|alter\s+table)\s+(?:table\s+)?public\.agent_run_events/i,
  );
  assert.match(workFunctions, /\.from\("agent_job_events"\)/);
});
test("worker smoke validation is read-only and the image has no browser runtime", () => {
  assert.match(smokeTest, /\.from\("agent_run_events"\)/);
  assert.match(smokeTest, /\.from\("agent_job_events"\)/);
  assert.match(smokeTest, /readiness\.status !== 503/);
  assert.match(smokeTest, /execution_enabled !== false/);
  assert.doesNotMatch(smokeTest, /\.insert\(|\.update\(|\.delete\(|createUser|AI_PROVIDER/);
  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.doesNotMatch(dockerfile, /playwright|chromium|pwuser|npm ci/i);
});
test("deliverables and notifications are owner scoped", () => {
  assert.match(migration, /agent_deliverables[\s\S]+Owners manage deliverables/);
  assert.match(migration, /agent_notifications[\s\S]+Owners delete notifications/);
  assert.match(migration, /integrity_hash.*\{64\}/);
});
