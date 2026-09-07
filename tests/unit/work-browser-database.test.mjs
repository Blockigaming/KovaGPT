import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseBrowserOwnerInput } from "../../src/lib/work-browser-policy.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  run = "33333333-3333-4333-8333-333333333333",
  session = "44444444-4444-4444-8444-444444444444",
  runner = "55555555-5555-4555-8555-555555555555",
  step = "66666666-6666-4666-8666-666666666666",
  approval = "77777777-7777-4777-8777-777777777777";
const migration = await readFile(
  new URL("../../supabase/migrations/20260905034000_work_browser_takeover.sql", import.meta.url),
  "utf8",
);
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;
  create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function kova_private.auth_user_exists(p_owner uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=p_owner)$$;
  grant usage on schema auth,kova_private to service_role,authenticated;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
  create table account_deletion_fences(user_id uuid primary key);create table user_preferences(user_id uuid primary key,settings jsonb);
  create table work_execution_runs(id uuid primary key,owner_id uuid references auth.users(id) on delete cascade,revision bigint,status text,state jsonb,unique(id,owner_id));
  grant select on account_deletion_fences,user_preferences to service_role;grant select,update on work_execution_runs to service_role;
  `);
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.query("insert into work_execution_runs values($1,$2,1,$3,$4)", [
      run,
      owner,
      "paused",
      { step: null, effect: null, runnerId: runner, runnerBuild: "a".repeat(40) },
    ]);
    await db.exec(migration);
    const role = async (action) => {
      await db.exec("set role service_role");
      try {
        return await action();
      } finally {
        await db.exec("reset role");
      }
    };
    const admit = (operation = "open", sequence = 0, actor = owner, revision = 1) =>
      role(
        async () =>
          (
            await db.query("select admit_work_browser_owner($1,$2,$3,$4,$5,$6) value", [
              actor,
              run,
              session,
              revision,
              sequence,
              operation,
            ])
          ).rows[0].value,
      );
    const finish = (sequence) =>
      role(
        async () =>
          (
            await db.query("select finish_work_browser_owner($1,$2,$3,$4) value", [
              owner,
              run,
              session,
              sequence,
            ])
          ).rows[0].value,
      );
    const authority = (actor = "owner", phase = "check", sequence = 1, actorOwner = owner) =>
      role(
        async () =>
          (
            await db.query(
              "select authorize_work_browser($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value",
              [
                actorOwner,
                run,
                session,
                runner,
                "a".repeat(40),
                actor,
                phase,
                sequence,
                1,
                step,
                "b".repeat(64),
                approval,
              ],
            )
          ).rows[0].value,
      );
    return { db, role, admit, finish, authority };
  } catch (error) {
    await db.close();
    throw error;
  }
}
test("only the current paused owner admits takeover; database blocks cross-tab resume until confirmed release", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.admit("open", 0, other), /not_found/);
    await assert.rejects(f.admit("open", 0, owner, 2), /revision_conflict/);
    const opened = await f.admit();
    assert.equal(opened.mode, "takeover");
    assert.equal(opened.sequence, 1);
    assert.equal((await f.authority()).allowed, true);
    await assert.rejects(
      f.role(() => f.db.query("update work_execution_runs set status='queued' where id=$1", [run])),
      /takeover_active/,
    );
    await f.admit("release", 1);
    await assert.rejects(
      f.role(() =>
        f.db.query("update work_execution_runs set status='running' where id=$1", [run]),
      ),
      /takeover_active/,
    );
    assert.equal(await f.finish(2), true);
    await f.role(() =>
      f.db.query("update work_execution_runs set status='queued' where id=$1", [run]),
    );
    await assert.rejects(f.authority("owner", "check", 2), /owner_denied/);
  } finally {
    await f.db.close();
  }
});
test("sequence CAS never repeats an owner action and no private command values enter durable metadata", async () => {
  const f = await fixture();
  try {
    await f.admit();
    await f.admit("fill", 1);
    await assert.rejects(f.admit("fill", 1), /sequence_conflict/);
    await assert.rejects(f.authority("owner", "check", 1), /owner_denied/);
    assert.equal((await f.authority("owner", "check", 2)).allowed, true);
    const columns = (
      await f.db.query(
        "select column_name from information_schema.columns where table_name='work_browser_sessions' order by ordinal_position",
      )
    ).rows.map((r) => r.column_name);
    assert.deepEqual(columns, [
      "id",
      "owner_id",
      "run_id",
      "mode",
      "sequence",
      "operation",
      "last_approval_id",
      "created_at",
      "expires_at",
    ]);
    await f.db.exec("set role authenticated");
    await assert.rejects(
      f.db.query("select admit_work_browser_owner($1,$2,$3,1,0,'open')", [
        owner,
        run,
        crypto.randomUUID(),
      ]),
      /permission denied/,
    );
    await assert.rejects(f.db.query("delete from work_browser_sessions"), /permission denied/);
  } finally {
    await f.db.close();
  }
});
test("a released session requires the exact approved live Work step and one admitted sequence", async () => {
  const f = await fixture();
  try {
    await f.admit();
    await f.admit("release", 1);
    await f.finish(2);
    const now = Date.now(),
      state = {
        runnerId: runner,
        runnerBuild: "a".repeat(40),
        epoch: 1,
        deadline: now + 60000,
        lease: { expiresAt: now + 30000 },
        step: { id: step, inputHash: "b".repeat(64) },
        approval: {
          id: approval,
          action: "browser_interact",
          status: "consumed",
          expiresAt: now + 30000,
          canonicalInput: JSON.stringify({ sessionId: session, operation: "snapshot" }),
        },
        effect: { id: approval, status: "started" },
      };
    await f.db.query("update work_execution_runs set status='running',state=$1 where id=$2", [
      state,
      run,
    ]);
    assert.equal((await f.authority("agent", "catalog", null)).sequence, 2);
    assert.equal((await f.authority("agent", "admit_agent", null)).sequence, 3);
    assert.equal((await f.authority("agent", "admit_agent", null)).sequence, 3);
    assert.equal((await f.authority("agent", "check", 3)).allowed, true);
    await assert.rejects(f.authority("agent", "check", 2), /sequence_conflict/);
    state.approval.canonicalInput = JSON.stringify({
      sessionId: crypto.randomUUID(),
      operation: "snapshot",
    });
    await f.db.query("update work_execution_runs set state=$1 where id=$2", [state, run]);
    await assert.rejects(f.authority("agent", "check", 3), /approval_required/);
  } finally {
    await f.db.close();
  }
});
test("Lockdown, deletion, and expiry revoke already admitted browser authority", async () => {
  const f = await fixture();
  try {
    await f.admit();
    await f.db.query("insert into user_preferences values($1,$2)", [
      owner,
      { lockdown_mode: true },
    ]);
    await assert.rejects(f.authority(), /lockdown_active/);
    await f.db.exec("delete from user_preferences");
    await f.db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(f.authority(), /owner_unavailable/);
    await f.db.exec("delete from account_deletion_fences");
    await f.db.exec(
      "update work_browser_sessions set expires_at=clock_timestamp()-interval '1 second'",
    );
    await assert.rejects(f.authority(), /session_stale/);
    await f.db.query("delete from auth.users where id=$1", [owner]);
    assert.equal(
      (await f.db.query("select count(*)::int n from work_browser_sessions")).rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("owner payloads are exact, bounded, UUID-targeted and cannot smuggle browser code", () => {
  const base = {
    expectedUserId: owner,
    runId: run,
    sessionId: session,
    expectedRevision: 1,
    expectedSequence: 1,
    operation: "fill",
    view: step,
    target: approval,
    text: "private value",
  };
  assert.deepEqual(parseBrowserOwnerInput(base), base);
  for (const change of [
    { script: "evil" },
    { target: "input[name=password]" },
    { text: "x".repeat(4001) },
    { operation: "evaluate" },
    { expectedSequence: -1 },
    { operation: "navigate", url: "https://user:pass@example.com" },
  ])
    assert.throws(() => parseBrowserOwnerInput({ ...base, ...change }));
});
