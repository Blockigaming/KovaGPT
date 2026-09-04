import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  "supabase/migrations/20260903210000_library_folders_and_bulk_move.sql",
  "utf8",
);
const firstUser = "10000000-0000-4000-8000-000000000001";
const secondUser = "20000000-0000-4000-8000-000000000002";
const firstItem = "30000000-0000-4000-8000-000000000003";
const secondItem = "40000000-0000-4000-8000-000000000004";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema kova_private;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    insert into auth.users(id) values ('${firstUser}'), ('${secondUser}');

    create table public.user_library_items (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      title text not null,
      item_type text not null,
      source text not null default 'manual',
      content_text text,
      file_url text,
      file_name text,
      file_type text,
      file_size bigint,
      metadata jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    grant select, insert, update, delete on public.user_library_items to authenticated;
    grant all on public.user_library_items to service_role;
    alter table public.user_library_items enable row level security;
    create policy "library owner all" on public.user_library_items
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);

    create table public.account_audit_entries (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      event_type text not null,
      safe_description text not null,
      actor_id uuid,
      target_id text,
      result text not null check (result in ('success','failure')),
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  await database.exec(migration);
  return database;
}

async function rpc(database, sql, params = []) {
  await database.exec("set role service_role");
  try {
    return await database.query(sql, params);
  } finally {
    await database.exec("reset role");
  }
}

test("folder trees are durable, owner-scoped, auditable, and reject cycles", async () => {
  const database = await createDatabase();
  try {
    const root = await rpc(
      database,
      "select public.create_library_folder($1::uuid, $2::text, null::uuid) as result",
      [firstUser, "Research"],
    );
    const rootId = root.rows[0].result.id;
    const child = await rpc(
      database,
      "select public.create_library_folder($1::uuid, $2::text, $3::uuid) as result",
      [firstUser, "Sources", rootId],
    );
    const childId = child.rows[0].result.id;

    await assert.rejects(
      () =>
        rpc(
          database,
          "select public.create_library_folder($1::uuid, 'research'::text, null::uuid)",
          [firstUser],
        ),
      /duplicate key/u,
    );

    await assert.rejects(
      () =>
        rpc(
          database,
          "select public.update_library_folder($1::uuid, $2::uuid, null::text, $3::uuid, true)",
          [firstUser, rootId, childId],
        ),
      /folder_cycle/u,
    );

    const rows = await database.query(
      "select name, parent_id from public.library_folders where user_id = $1 order by name",
      [firstUser],
    );
    assert.deepEqual(rows.rows, [
      { name: "Research", parent_id: null },
      { name: "Sources", parent_id: rootId },
    ]);
    const audits = await database.query(
      "select event_type from public.account_audit_entries where user_id = $1 order by created_at",
      [firstUser],
    );
    assert.deepEqual(audits.rows, [
      { event_type: "library_folder_created" },
      { event_type: "library_folder_created" },
    ]);
  } finally {
    await database.close();
  }
});

test("folder depth is bounded and moving a subtree cannot exceed the same bound", async () => {
  const database = await createDatabase();
  try {
    let parentId = null;
    const folderIds = [];
    for (let depth = 1; depth <= 12; depth += 1) {
      const created = await rpc(
        database,
        "select public.create_library_folder($1::uuid, $2::text, $3::uuid) as result",
        [firstUser, `Level ${depth}`, parentId],
      );
      parentId = created.rows[0].result.id;
      folderIds.push(parentId);
    }
    await assert.rejects(
      () =>
        rpc(database, "select public.create_library_folder($1::uuid, 'Too deep'::text, $2::uuid)", [
          firstUser,
          parentId,
        ]),
      /folder_depth_exceeded/u,
    );

    const branch = await rpc(
      database,
      "select public.create_library_folder($1::uuid, 'Branch'::text, null::uuid) as result",
      [firstUser],
    );
    await rpc(
      database,
      "select public.create_library_folder($1::uuid, 'Branch leaf'::text, $2::uuid)",
      [firstUser, branch.rows[0].result.id],
    );
    await assert.rejects(
      () =>
        rpc(
          database,
          "select public.update_library_folder($1::uuid, $2::uuid, null::text, $3::uuid, true)",
          [firstUser, branch.rows[0].result.id, folderIds[10]],
        ),
      /folder_depth_exceeded/u,
    );
  } finally {
    await database.close();
  }
});

test("bulk moves are all-or-nothing and deleting folders preserves every item", async () => {
  const database = await createDatabase();
  try {
    const root = await rpc(
      database,
      "select public.create_library_folder($1::uuid, 'Work'::text, null::uuid) as result",
      [firstUser],
    );
    const rootId = root.rows[0].result.id;
    const child = await rpc(
      database,
      "select public.create_library_folder($1::uuid, 'Drafts'::text, $2::uuid) as result",
      [firstUser, rootId],
    );
    const childId = child.rows[0].result.id;
    await database.query(
      `insert into public.user_library_items(id,user_id,title,item_type)
       values ($1,$2,'One','document'),($3,$4,'Two','document')`,
      [firstItem, firstUser, secondItem, secondUser],
    );

    await rpc(database, "select public.bulk_move_library_items($1::uuid, $2::uuid[], $3::uuid)", [
      firstUser,
      [firstItem],
      childId,
    ]);
    await assert.rejects(
      () =>
        rpc(database, "select public.bulk_move_library_items($1::uuid, $2::uuid[], $3::uuid)", [
          firstUser,
          [firstItem, secondItem],
          rootId,
        ]),
      /library_item_not_found/u,
    );

    let items = await database.query(
      "select id, folder_id from public.user_library_items order by id",
    );
    assert.deepEqual(items.rows, [
      { id: firstItem, folder_id: childId },
      { id: secondItem, folder_id: null },
    ]);

    const removed = await rpc(
      database,
      "select public.delete_library_folder($1::uuid, $2::uuid) as result",
      [firstUser, rootId],
    );
    assert.deepEqual(removed.rows[0].result, {
      deletedFolderCount: 2,
      movedToRootCount: 1,
    });
    items = await database.query("select id, folder_id from public.user_library_items order by id");
    assert.deepEqual(items.rows, [
      { id: firstItem, folder_id: null },
      { id: secondItem, folder_id: null },
    ]);
  } finally {
    await database.close();
  }
});

test("client roles can only read their own folders and cannot call mutation RPCs", async () => {
  const database = await createDatabase();
  try {
    const first = await rpc(
      database,
      "select public.create_library_folder($1::uuid, 'Private'::text, null::uuid) as result",
      [firstUser],
    );
    const folderId = first.rows[0].result.id;
    const second = await rpc(
      database,
      "select public.create_library_folder($1::uuid, 'Other'::text, null::uuid) as result",
      [secondUser],
    );
    const secondFolderId = second.rows[0].result.id;
    await database.query(
      `insert into public.user_library_items(id,user_id,title,item_type)
       values ($1,$2,'Owned item','document')`,
      [firstItem, firstUser],
    );

    await database.exec(`set role authenticated; set request.jwt.claim.sub = '${firstUser}'`);
    const visible = await database.query("select id from public.library_folders");
    assert.deepEqual(visible.rows, [{ id: folderId }]);
    await assert.rejects(() =>
      database.query("select public.create_library_folder($1::uuid, 'Blocked'::text, null::uuid)", [
        firstUser,
      ]),
    );
    await assert.rejects(() =>
      database.query("update public.library_folders set name = 'Blocked' where id = $1", [
        folderId,
      ]),
    );
    await assert.rejects(
      () =>
        database.query("update public.user_library_items set folder_id = $1 where id = $2", [
          secondFolderId,
          firstItem,
        ]),
      /library_folder_not_owned/u,
    );
    await database.exec("reset role");

    const privileges = await database.query(`
      select
        has_function_privilege('anon', 'public.bulk_move_library_items(uuid,uuid[],uuid)', 'execute') as anon_execute,
        has_function_privilege('authenticated', 'public.bulk_move_library_items(uuid,uuid[],uuid)', 'execute') as authenticated_execute,
        has_function_privilege('service_role', 'public.bulk_move_library_items(uuid,uuid[],uuid)', 'execute') as service_execute
    `);
    assert.deepEqual(privileges.rows, [
      { anon_execute: false, authenticated_execute: false, service_execute: true },
    ]);
  } finally {
    await database.close();
  }
});
