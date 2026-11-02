import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const deleting = "30000000-0000-4000-8000-000000000003";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20261102231924_scheduled_task_private_fence_reads.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = await readFile(
  new URL("../../scripts/rollback-scheduled-task-private-fence-reads.sql", import.meta.url),
  "utf8",
);
const foundation = await readFile(
  new URL(
    "../../supabase/migrations/20260905005111_scheduled_tasks_activation_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const originalPolicy = foundation.match(
  /create policy scheduled_tasks_current_owner[\s\S]*?;/u,
)?.[0];
assert.ok(originalPolicy);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema kova_private; create schema kova_auth_guard;
    grant usage on schema auth,kova_auth_guard to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    $$;
    create table public.account_deletion_fences(user_id uuid primary key);
    alter table public.account_deletion_fences enable row level security;
    revoke all on public.account_deletion_fences from public,anon,authenticated;
    create table public.scheduled_tasks(id uuid primary key,user_id uuid not null,title text);
    insert into public.scheduled_tasks values
      ('10000000-0000-4000-8000-000000000011','${owner}','Owner fixture'),
      ('20000000-0000-4000-8000-000000000022','${other}','Other fixture'),
      ('30000000-0000-4000-8000-000000000033','${deleting}','Deleting fixture');
    insert into public.account_deletion_fences values('${deleting}');
    alter table public.scheduled_tasks enable row level security;
    grant select on public.scheduled_tasks to authenticated;
    create function kova_auth_guard.session_is_active() returns boolean language sql stable as $$
      select coalesce(current_setting('fixture.session_active',true),'true') <> 'false';
    $$;
    create policy kova_owned_session_guard on public.scheduled_tasks as restrictive for all
      to anon,authenticated using((select kova_auth_guard.session_is_active()))
      with check((select kova_auth_guard.session_is_active()));
    ${originalPolicy}
  `);
  return db;
}
async function asOwner(db, id, action) {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
    return await action();
  } finally {
    await db.exec("reset role");
  }
}

test("scheduled reads recover without exposing fences, other owners, deleting accounts or revoked sessions", async () => {
  const db = await fixture();
  try {
    await asOwner(db, owner, () =>
      assert.rejects(
        db.query("select id from public.scheduled_tasks"),
        (error) => error.code === "42501",
      ),
    );
    const guardBefore = await db.query(
      "select * from pg_policies where policyname='kova_owned_session_guard'",
    );
    await db.exec(migration);
    assert.deepEqual(
      await db.query("select * from pg_policies where policyname='kova_owned_session_guard'"),
      guardBefore,
    );
    for (const id of [owner, other, deleting, null]) {
      await asOwner(db, id, async () => {
        const rows = (await db.query("select user_id from public.scheduled_tasks")).rows;
        assert.deepEqual(rows, [owner, other].includes(id) ? [{ user_id: id }] : []);
        await assert.rejects(
          db.query("select user_id from public.account_deletion_fences"),
          (error) => error.code === "42501",
        );
      });
    }
    await asOwner(db, owner, async () => {
      await db.query("select set_config('fixture.session_active','false',false)");
      assert.deepEqual((await db.query("select id from public.scheduled_tasks")).rows, []);
    });
    const privileges = (
      await db.query(`select
      has_function_privilege('anon','kova_private.scheduled_task_reader_is_active()','EXECUTE') anon_execute,
      has_function_privilege('authenticated','kova_private.scheduled_task_reader_is_active()','EXECUTE') owner_execute,
      has_table_privilege('authenticated','public.scheduled_tasks','INSERT,UPDATE,DELETE') write_access,
      has_table_privilege('authenticated','public.account_deletion_fences','SELECT') fence_access`)
    ).rows[0];
    assert.deepEqual(privileges, {
      anon_execute: false,
      owner_execute: true,
      write_access: false,
      fence_access: false,
    });
    await db.exec(rollback);
    assert.equal(
      (await db.query("select count(*)::integer n from public.scheduled_tasks")).rows[0].n,
      3,
    );
    await db.query("select set_config('fixture.session_active','true',false)");
    await asOwner(db, owner, () =>
      assert.rejects(
        db.query("select id from public.scheduled_tasks"),
        (error) => error.code === "42501",
      ),
    );
  } finally {
    await db.close();
  }
});

test("unexpected deployed policy drift stops the migration without installing the helper", async () => {
  const db = await fixture();
  try {
    await db.exec(
      "alter policy scheduled_tasks_current_owner on public.scheduled_tasks using(true)",
    );
    await assert.rejects(db.exec(migration), /scheduled_task_read_policy_changed/u);
    await db.exec("rollback");
    assert.equal(
      (
        await db.query(
          "select to_regprocedure('kova_private.scheduled_task_reader_is_active()') as helper",
        )
      ).rows[0].helper,
      null,
    );
  } finally {
    await db.close();
  }
});
