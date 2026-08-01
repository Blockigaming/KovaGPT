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
test("worker exposes health, readiness, shutdown, recovery, and team-only execution", () => {
  for (const control of [
    "/healthz",
    "/readyz",
    "SIGTERM",
    "recover_expired_agent_leases",
    "heartbeat_agent_job",
    "release_agent_lease",
    'job.kind !== "team"',
  ])
    assert.match(worker, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(worker, /\.from\("agent_job_events"\)/);
  assert.doesNotMatch(worker, /browserJob|chromium|page\.goto|agent_run_events/);
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
test("pause and cancellation transitions cannot be converted into retries", () => {
  assert.match(migration, /status='cancelling' then 'cancelled'/);
  assert.match(migration, /status='paused' then 'paused'/);
  assert.match(migration, /current_status='paused' and current_worker is null/);
  assert.match(migration, /current_status='paused' and current_worker is not null/);
  assert.match(migration, /settle_interrupted_agent_job/);
  assert.match(migration, /fail_agent_job[\s\S]+status in \('leased','running'\)/);
  assert.match(worker, /controller\.signal\.aborted[\s\S]+heartbeat_agent_job/);
  assert.match(
    worker,
    /\["cancelling", "cancelled", "paused"\][\s\S]+settle_interrupted_agent_job/,
  );
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
  for (const role of ["public, anon, authenticated", "security definer", "skip locked"])
    assert.ok(migration.toLowerCase().includes(role));
  assert.match(migration, /grant execute on function public\.lease_agent_job[\s\S]+service_role/);
  assert.match(migration, /grant execute on function public\.settle_interrupted_agent_job/);
  assert.match(migration, /where kind='team'/);
});
test("fresh and existing schemas keep run events separate from job events", () => {
  assert.match(constellationMigration, /create table if not exists public\.agent_run_events/);
  assert.match(migration, /create table public\.agent_job_events/);
  assert.doesNotMatch(migration, /create table public\.agent_run_events/);
  assert.match(compatibilityMigration, /create table if not exists public\.agent_job_events/);
  assert.match(compatibilityMigration, /before insert or update of kind on public\.agent_jobs/);
  assert.match(compatibilityMigration, /if new\.kind <> 'team'/);
  assert.match(compatibilityMigration, /where kind = 'team'/);
  assert.doesNotMatch(
    compatibilityMigration,
    /(?:drop|truncate|rename|alter\s+table)\s+(?:table\s+)?public\.agent_run_events/i,
  );
  assert.match(workFunctions, /\.from\("agent_job_events"\)/);
});
test("worker smoke validation is read-only and the image has no browser runtime", () => {
  assert.match(smokeTest, /\.from\("agent_run_events"\)/);
  assert.match(smokeTest, /\.from\("agent_job_events"\)/);
  assert.doesNotMatch(smokeTest, /\.insert\(|\.update\(|\.delete\(|createUser|AI_PROVIDER/);
  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.doesNotMatch(dockerfile, /playwright|chromium|pwuser/i);
});
test("deliverables and notifications are owner scoped", () => {
  assert.match(migration, /agent_deliverables[\s\S]+Owners manage deliverables/);
  assert.match(migration, /agent_notifications[\s\S]+Owners delete notifications/);
  assert.match(migration, /integrity_hash.*\{64\}/);
});
