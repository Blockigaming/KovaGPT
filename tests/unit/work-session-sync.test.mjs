import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createWorkSession,
  updateWorkSession,
  branchWorkSession,
  mergeWorkSessionHistory,
  validWorkSession,
} from "../../src/lib/work-session.mjs";
import {
  createWorkSyncState,
  prepareWorkMutation,
  replaceLocalWork,
  settleWorkMutation,
  resolveWorkConflict,
  visibleWorkRecords,
} from "../../src/lib/work-sync-state.ts";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const migrations = await Promise.all(
  [
    "20260903213000_work_cross_device_sync.sql",
    "20260903214500_work_sync_protection_hardening.sql",
    "20260904235937_work_session_sync.sql",
  ].map((name) => readFile(`supabase/migrations/${name}`, "utf8")),
);
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.account_audit_entries(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),event_type text,safe_description text,actor_id uuid,target_id text,result text,metadata jsonb,created_at timestamptz default now());
 create table public.agent_jobs(id uuid primary key,owner_id uuid references auth.users(id));
 insert into auth.users values('${owner}'),('${other}');
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 `);
  for (const sql of migrations) await db.exec(sql);
  return db;
}
async function save(db, session, revision = 0, user = owner, mutation = crypto.randomUUID()) {
  const result = await db.query(
    "select public.upsert_work_saved_record($1,$2,$3,$4,$5,$6,$7) result",
    [user, mutation, session.id, "session", session.objective.slice(0, 160), session, revision],
  );
  return result.rows[0].result;
}
const rejects = (action, code) => assert.rejects(action, (error) => error.code === code);

test("planning session RPC preserves immutable events and exact revision lineage without impersonating execution", async () => {
  const db = await setup();
  try {
    const session = createWorkSession({ objective: "Prepare launch", plan: ["Review evidence"] });
    const mutation = crypto.randomUUID();
    const first = await save(db, session, 0, owner, mutation);
    assert.deepEqual(await save(db, session, 0, owner, mutation), first);
    const updated = updateWorkSession(
      session,
      { status: "paused" },
      "status_updated",
      "Planning paused",
    );
    assert.equal((await save(db, updated, 1)).revision, 2);
    const rewritten = structuredClone(updated);
    rewritten.events[0].label = "Rewritten history";
    await rejects(() => save(db, rewritten, 2), "22023");
    await rejects(() => save(db, { ...updated, events: updated.events.slice(1) }, 2), "22023");
    await rejects(() => save(db, { ...updated, objective: "Silent edit" }, 2), "22023");
    await rejects(() => save(db, { ...updated, status: "running" }, 2), "22023");
    await rejects(
      () => save(db, updateWorkSession(updated, { context: "stale" }, "plan_updated", "Edit"), 1),
      "40001",
    );
    const branch = branchWorkSession(updated, 2);
    assert.equal((await save(db, branch)).revision, 1);
    await rejects(() => save(db, branchWorkSession(updated, 2), 0, other), "40001");
    await rejects(() => save(db, branchWorkSession(updated, 1)), "40001");
    const reparented = { ...branch, parent: null, rootId: branch.id };
    await rejects(() => save(db, reparented, 1), "22023");
    const plan = updateWorkSession(
      branch,
      { objective: "A new direction" },
      "plan_updated",
      "Direction changed",
    );
    await save(db, plan, 1);
    await db.query("select public.delete_work_saved_record($1,$2,$3,$4)", [
      owner,
      crypto.randomUUID(),
      branch.id,
      2,
    ]);
    await rejects(() => save(db, plan, 3), "22023");
    const tombstone = await db.query(
      "select payload from public.work_saved_records where owner_id=$1 and id=$2",
      [owner, branch.id],
    );
    assert.deepEqual(tombstone.rows[0].payload, {});
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.account_audit_entries where event_type='work_sync'",
        )
      ).rows[0].n,
      5,
    );
  } finally {
    await db.close();
  }
});

test("session rows remain owner-readable and every mutation helper remains service-only", async () => {
  const db = await setup();
  try {
    const session = createWorkSession({ objective: "Private objective" });
    await save(db, session);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`,
    );
    assert.equal((await db.query("select id from public.work_saved_records")).rows.length, 0);
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
    assert.equal(
      (await db.query("select id from public.work_saved_records")).rows[0].id,
      session.id,
    );
    await rejects(() => save(db, createWorkSession({ objective: "Unauthorized write" })), "42501");
    await rejects(
      () =>
        db.query("select public.validate_work_session($1,$2,$3,null)", [
          owner,
          session.id,
          session,
        ]),
      "42501",
    );
  } finally {
    await db.close();
  }
});

test("session outbox recovers after delayed acknowledgment and merges both planning histories on conflict", () => {
  const session = createWorkSession({ objective: "Write plan" });
  let state = createWorkSyncState(owner, { session: [session] });
  const mutation = crypto.randomUUID();
  state = prepareWorkMutation(state, session.id, mutation);
  const request = JSON.stringify(state.pending[session.id].request);
  const edited = updateWorkSession(
    session,
    { context: "Saved while offline" },
    "plan_updated",
    "Context edited",
  );
  state = replaceLocalWork(state, "session", [edited]);
  assert.equal(JSON.stringify(state.pending[session.id].request), request);
  state = settleWorkMutation(state, session.id, mutation, {
    result: {
      id: session.id,
      kind: "session",
      revision: 1,
      syncVersion: 1,
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    },
  });
  assert.equal(state.pending[session.id].expectedRevision, 1);
  assert.equal(visibleWorkRecords(state, "session")[0].context, "Saved while offline");
  const remote = updateWorkSession(
    session,
    { status: "paused" },
    "status_updated",
    "Planning paused elsewhere",
  );
  // Postgres JSONB may reorder object keys; semantic event identity remains unchanged.
  remote.events[0] = {
    label: remote.events[0].label,
    kind: remote.events[0].kind,
    at: remote.events[0].at,
    id: remote.events[0].id,
  };
  state.records[session.id] = { ...state.records[session.id], payload: remote, revision: 2 };
  state.pending[session.id].conflict = true;
  state = resolveWorkConflict(state, session.id, "device");
  const merged = state.pending[session.id].desired;
  assert.deepEqual(merged.events.slice(0, remote.events.length), remote.events);
  assert.ok(merged.events.some((event) => event.id === edited.events[1].id));
  assert.equal(merged.context, "Saved while offline");
  assert.equal(state.pending[session.id].expectedRevision, 2);
  state.pending[session.id].conflict = true;
  const recovered = resolveWorkConflict(state, session.id, "new_session");
  assert.equal(recovered.pending[session.id], undefined);
  const fresh = Object.values(recovered.pending).find((entry) => entry.kind === "session").desired;
  assert.notEqual(fresh.id, session.id);
  assert.equal(fresh.rootId, fresh.id);
  assert.equal(fresh.parent, null);
  assert.equal(fresh.context, "Saved while offline");

  const forged = structuredClone(edited);
  forged.events[0].label = "Replace history";
  assert.throws(() => mergeWorkSessionHistory(remote, forged), /history changed/);
  assert.equal(
    validWorkSession({ ...session, events: [session.events[0], session.events[0]] }),
    false,
  );
});
