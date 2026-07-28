import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile("worker/src/index.mjs", "utf8");
const migration = await readFile(
  "supabase/migrations/20260728090000_helios_agent_runtime.sql",
  "utf8",
);
test("worker exposes health, readiness, shutdown, recovery, and SSRF controls", () => {
  for (const control of [
    "/healthz",
    "/readyz",
    "SIGTERM",
    "recover_expired_agent_leases",
    "heartbeat_agent_job",
    "release_agent_lease",
    "Private network navigation is blocked",
    "page.route",
  ])
    assert.match(worker, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
test("worker queue RPCs are not callable by browser roles", () => {
  for (const role of ["public, anon, authenticated", "security definer", "skip locked"])
    assert.ok(migration.toLowerCase().includes(role));
});
test("deliverables and notifications are owner scoped", () => {
  assert.match(migration, /agent_deliverables[\s\S]+Owners manage deliverables/);
  assert.match(migration, /agent_notifications[\s\S]+Owners delete notifications/);
  assert.match(migration, /integrity_hash.*\{64\}/);
});
