import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/routes/api/work/sync.ts", "utf8");
const migration = await readFile(
  "supabase/migrations/20260903213000_work_cross_device_sync.sql",
  "utf8",
);

test("Work sync API is authenticated, bounded, origin-protected, and fail-closed", () => {
  assert.match(route, /requireUser\(request\)/u);
  assert.match(route, /isCrossSiteMutation\(request\)/u);
  assert.match(route, /readBoundedJsonObject\(request, WORK_SYNC_MAX_BODY_BYTES\)/u);
  assert.match(route, /consumeApplicationRateLimit/u);
  assert.match(route, /work_sync_protection_unavailable/u);
  assert.match(route, /Cache-Control": "no-store"/u);
  assert.doesNotMatch(route, /error\.message|String\(error\)/u);
});

test("one global cursor and exact revisions prevent silent cross-device overwrites", () => {
  assert.match(migration, /current_version = current_version \+ 1/u);
  assert.match(migration, /work_revision_conflict'[\s\S]*errcode = '40001'/u);
  assert.match(migration, /primary key \(owner_id, mutation_id\)/u);
  assert.match(migration, /if found then return v_result; end if;/u);
  assert.match(migration, /union all[\s\S]*order by sync_version[\s\S]*limit p_limit/u);
  assert.match(migration, /for share/u);
});

test("browser clients can read only their own state and cannot mutate it directly", () => {
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = owner_id\)/u);
  assert.match(migration, /grant select on table public\.work_saved_records to authenticated/u);
  assert.match(migration, /grant select on table public\.work_recent_items to authenticated/u);
  assert.match(
    migration,
    /revoke all on function public\.upsert_work_saved_record[\s\S]*from public, anon, authenticated/u,
  );
  assert.match(
    migration,
    /grant execute on function public\.upsert_work_saved_record[\s\S]*to service_role/u,
  );
  assert.doesNotMatch(migration, /security definer/iu);
});
