import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const requester = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const generation = "44444444-4444-4444-8444-444444444444";
const otherGeneration = "55555555-5555-4555-8555-555555555555";
const projectPath = `${project}/${generation}.pdf`;

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema kova_private; grant usage on schema auth to service_role;
    create table auth.users(id uuid primary key, deleted_at timestamptz);
    create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade);
    create table public.user_library_items(id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade, title text, file_url text, item_type text not null default 'image',
      metadata jsonb not null default '{}'::jsonb);
    insert into auth.users(id) values ('${owner}'),('${requester}');
  `);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260905001736_private_auth_identity_helpers.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260904232923_account_storage_generation_outbox.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}

async function reserve(
  db,
  {
    id = generation,
    ownerId = owner,
    requesterId = requester,
    bucket = "project-files",
    path = projectPath,
  } = {},
) {
  return (
    await db.query("select public.reserve_account_storage_artifact($1,$2,$3,$4,$5) ok", [
      id,
      ownerId,
      requesterId,
      bucket,
      path,
    ])
  ).rows[0].ok;
}
async function transition(db, operation, id = generation, overrides = {}) {
  const existing = (
    await db.query("select * from public.account_storage_artifacts where generation=$1", [id])
  ).rows[0];
  const binding = {
    ownerId: existing?.owner_id ?? owner,
    requesterId: existing?.requester_id ?? requester,
    bucket: existing?.bucket ?? "project-files",
    path: existing?.storage_path ?? `${project}/${id}.pdf`,
    ...overrides,
  };
  return (
    await db.query(`select public.${operation}_account_storage_artifact($1,$2,$3,$4,$5) ok`, [
      id,
      binding.ownerId,
      binding.requesterId,
      binding.bucket,
      binding.path,
    ])
  ).rows[0].ok;
}
const settle = (db, id, overrides) => transition(db, "settle", id, overrides);
const retire = (db, id, overrides) => transition(db, "retire", id, overrides);
async function claim(db, userId = null, limit = 25) {
  return (
    await db.query("select * from public.claim_account_storage_artifact_cleanup($1,$2)", [
      userId,
      limit,
    ])
  ).rows;
}
async function recordCleanup(db, id = generation) {
  return (await db.query("select public.record_account_storage_artifact_cleanup($1) ok", [id]))
    .rows[0].ok;
}
async function prepare(db, userId = owner) {
  return (
    await db.query("select public.prepare_account_storage_artifact_deletion($1) ok", [userId])
  ).rows[0].ok;
}

const roles = [
  "reserve_account_storage_artifact(uuid,uuid,uuid,text,text)",
  "settle_account_storage_artifact(uuid,uuid,uuid,text,text)",
  "retire_account_storage_artifact(uuid,uuid,uuid,text,text)",
  "prepare_account_storage_artifact_deletion(uuid)",
  "claim_account_storage_artifact_cleanup(uuid,integer)",
  "record_account_storage_artifact_cleanup(uuid)",
];

test("storage generation RPCs are service-only invokers and browser roles cannot read obligations", async () => {
  const db = await database();
  try {
    for (const fn of roles) {
      const result = await db.query(
        "select has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') browser,has_function_privilege('service_role',$1,'EXECUTE') service",
        [`public.${fn}`],
      );
      assert.deepEqual(result.rows, [{ anon: false, browser: false, service: true }]);
      const config = await db.query(
        "select prosecdef,proconfig from pg_proc where oid=$1::regprocedure",
        [`public.${fn}`],
      );
      assert.deepEqual(config.rows, [{ prosecdef: false, proconfig: ['search_path=""'] }]);
    }
    const table = await db.query(
      "select relrowsecurity rls,has_table_privilege('authenticated',oid,'SELECT') browser,has_table_privilege('anon',oid,'INSERT') anon from pg_class where oid='public.account_storage_artifacts'::regclass",
    );
    assert.deepEqual(table.rows, [{ rls: true, browser: false, anon: false }]);
    const trigger = await db.query(
      "select has_function_privilege('authenticated','kova_private.fence_library_item_account_deletion()','EXECUTE') browser",
    );
    assert.deepEqual(trigger.rows, [{ browser: false }]);
  } finally {
    await db.close();
  }
});

test("reservation checks both owner and requester deletion fences and missing Auth principals", async () => {
  const db = await database();
  try {
    await db.query("insert into public.account_deletion_fences values ($1)", [owner]);
    assert.equal(await reserve(db), false);
    await db.exec("delete from public.account_deletion_fences");
    await db.query("insert into public.account_deletion_fences values ($1)", [requester]);
    assert.equal(await reserve(db), false);
    await db.exec("delete from public.account_deletion_fences");
    assert.equal(await reserve(db), true);
    assert.equal(await reserve(db), true, "same live reservation retry is idempotent");
    assert.equal(
      await reserve(db, { ownerId: requester, requesterId: owner }),
      false,
      "a token cannot be reassigned",
    );
    await db.query("delete from auth.users where id=$1", [requester]);
    assert.equal(
      await reserve(db, { id: otherGeneration, path: `${project}/${otherGeneration}.pdf` }),
      false,
    );
    assert.equal(await settle(db), false);
    assert.equal(
      (await db.query("select count(*)::int n from public.account_storage_artifacts")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("Library upload reservations require the same owner/requester and exact generation image path", async () => {
  const db = await database();
  try {
    await assert.rejects(
      reserve(db, { bucket: "library-images", path: `${owner}/${generation}.png` }),
      /invalid_storage_artifact/u,
    );
    await assert.rejects(
      reserve(db, {
        requesterId: owner,
        bucket: "library-images",
        path: `${requester}/${generation}.png`,
      }),
      /invalid_storage_artifact/u,
    );
    await assert.rejects(
      reserve(db, {
        requesterId: owner,
        bucket: "library-images",
        path: `${owner}/${generation}.png/../hidden`,
      }),
      /invalid_storage_artifact/u,
    );
    assert.equal(
      await reserve(db, {
        requesterId: owner,
        bucket: "library-images",
        path: `${owner}/${generation}.png`,
      }),
      true,
    );
  } finally {
    await db.close();
  }
});

test("expired and retired generations cannot be renewed or published after a fence is released", async () => {
  const db = await database();
  try {
    assert.equal(await reserve(db), true);
    await db.exec(
      "update public.account_storage_artifacts set lease_expires_at=now()-interval '1 second'",
    );
    assert.equal(await reserve(db), false);
    assert.equal(await settle(db), false);
    await db.query("insert into public.account_deletion_fences values ($1)", [owner]);
    assert.equal(await prepare(db), false);
    await db.exec("delete from public.account_deletion_fences");
    assert.equal(await reserve(db), false);
    assert.equal(await settle(db), false);
    assert.equal(
      (await db.query("select state from public.account_storage_artifacts")).rows[0].state,
      "retired",
    );
    assert.equal(
      await reserve(db, { id: otherGeneration, path: `${project}/${otherGeneration}.pdf` }),
      true,
    );
    await retire(db, otherGeneration);
    assert.equal(await settle(db, otherGeneration), false);
    assert.equal(await settle(db, "66666666-6666-4666-8666-666666666666"), false);
  } finally {
    await db.close();
  }
});

test("published artifacts remain live across lease expiry and stale retire calls", async () => {
  const db = await database();
  try {
    assert.equal(await reserve(db), true);
    assert.equal(await settle(db), true);
    assert.equal(await settle(db), true);
    await db.exec(
      "update public.account_storage_artifacts set lease_expires_at=now()-interval '1 day'",
    );
    await retire(db);
    assert.deepEqual(await claim(db), []);
    assert.equal(await recordCleanup(db), false);
    await db.query("insert into public.account_deletion_fences values ($1)", [owner]);
    assert.equal(
      await prepare(db),
      true,
      "published live data is handled by its metadata/storage lifecycle",
    );
    assert.deepEqual(await claim(db, owner), []);
    assert.equal(
      (await db.query("select state from public.account_storage_artifacts")).rows[0].state,
      "published",
    );
  } finally {
    await db.close();
  }
});

test("live producers block deletion; successful empty cleanup remains retryable after Auth cascade", async () => {
  const db = await database();
  try {
    await assert.rejects(prepare(db), /account_deletion_fence_required/u);
    assert.equal(await reserve(db), true);
    await db.query("insert into public.account_deletion_fences values ($1)", [owner]);
    assert.equal(await prepare(db), false);
    assert.deepEqual(await claim(db, owner), []);
    await db.exec(
      "update public.account_storage_artifacts set lease_expires_at=now()-interval '1 second'",
    );
    assert.equal(await prepare(db), false);
    const first = await claim(db, owner);
    assert.equal(first.length, 1);
    assert.equal(await prepare(db), false, "claiming a DELETE does not acknowledge success");
    const objects = new Set();
    objects.delete(first[0].storage_path);
    assert.equal(await recordCleanup(db), true);
    assert.equal(await prepare(db), true);
    await db.query("delete from auth.users where id=$1", [owner]);
    assert.equal(
      (await db.query("select count(*)::int n from public.account_deletion_fences")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.account_storage_artifacts")).rows[0].n,
      1,
    );
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      objects.add(projectPath); // A delayed external request arrives after a prior empty DELETE.
      assert.deepEqual(await claim(db), [], "successful sweeps honor the bounded backoff");
      await db.exec(
        "update public.account_storage_artifacts set next_cleanup_at=now()-interval '1 second'",
      );
      const next = await claim(db);
      assert.equal(next.length, 1);
      assert.equal(next[0].storage_path, projectPath);
      objects.delete(next[0].storage_path);
      assert.equal(await recordCleanup(db), true);
      assert.equal(objects.size, 0);
      assert.equal(Number(next[0].cleanup_attempts), attempt);
    }
    assert.equal(
      (await db.query("select state from public.account_storage_artifacts")).rows[0].state,
      "retired",
    );
  } finally {
    await db.close();
  }
});

test("global cleanup pages remain bounded and fair when previous cleanup workers crash", async () => {
  const db = await database();
  try {
    await db.exec(`insert into public.account_storage_artifacts(generation,owner_id,requester_id,bucket,storage_path,state)
      select id,'${owner}','${requester}','project-files','${project}/'||id::text||'.pdf','retired'
      from (select gen_random_uuid() id from generate_series(1,60)) fixture;`);
    const first = await claim(db, null, 25); // Simulate a worker crash before removing or recording.
    const second = await claim(db, null, 25);
    const third = await claim(db, null, 25);
    assert.deepEqual([first.length, second.length, third.length], [25, 25, 10]);
    assert.equal(new Set([...first, ...second, ...third].map((row) => row.generation)).size, 60);
    assert.deepEqual(await claim(db), []);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.account_storage_artifacts where last_cleanup_at is null",
        )
      ).rows[0].n,
      60,
    );
    // The deleting user can retry unacknowledged work immediately, without
    // selecting another account's artifacts or erasing failed obligations.
    assert.equal((await claim(db, owner, 25)).length, 25);
    await assert.rejects(claim(db, null, 0), /invalid_cleanup_limit/u);
    await assert.rejects(claim(db, null, 101), /invalid_cleanup_limit/u);
  } finally {
    await db.close();
  }
});

test("expired producer recovery retires at most the requested cleanup page", async () => {
  const db = await database();
  try {
    await db.exec(`insert into public.account_storage_artifacts(generation,owner_id,requester_id,bucket,storage_path,state,lease_expires_at)
      select id,'${owner}','${requester}','project-files','${project}/'||id::text||'.pdf','pending',now()-interval '1 second'
      from (select gen_random_uuid() id from generate_series(1,60)) fixture;`);
    assert.equal((await claim(db, null, 25)).length, 25);
    assert.deepEqual(
      (
        await db.query(
          "select state,count(*)::int n from public.account_storage_artifacts group by state order by state",
        )
      ).rows,
      [
        { state: "pending", n: 35 },
        { state: "retired", n: 25 },
      ],
    );
    assert.equal((await claim(db, null, 25)).length, 25);
    assert.equal((await claim(db, null, 25)).length, 10);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.account_storage_artifacts where state='pending'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("Library metadata writes respect the deletion fence while cleanup DELETE remains possible", async () => {
  const db = await database();
  try {
    const inserted = await db.query(
      "insert into public.user_library_items(user_id,title) values ($1,'before fence') returning id",
      [owner],
    );
    const id = inserted.rows[0].id;
    await db.query("insert into public.account_deletion_fences values ($1)", [owner]);
    await assert.rejects(
      db.query("insert into public.user_library_items(user_id,title) values ($1,'late insert')", [
        owner,
      ]),
      /account_deletion_in_progress/u,
    );
    await assert.rejects(
      db.query("update public.user_library_items set title='late update' where id=$1", [id]),
      /account_deletion_in_progress/u,
    );
    await db.query(
      "insert into public.user_library_items(user_id,title) values ($1,'other user')",
      [requester],
    );
    await db.query("delete from public.user_library_items where id=$1", [id]);
    assert.deepEqual((await db.query("select user_id,title from public.user_library_items")).rows, [
      { user_id: requester, title: "other user" },
    ]);
    await db.exec("delete from public.account_deletion_fences");
    await db.query(
      "insert into public.user_library_items(user_id,title) values ($1,'new request after abort')",
      [owner],
    );
  } finally {
    await db.close();
  }
});

test("publication and retirement reject another owner, requester, bucket, or path", async () => {
  const db = await database();
  try {
    assert.equal(await reserve(db), true);
    for (const mismatch of [
      { ownerId: requester },
      { requesterId: owner },
      { bucket: "library-images" },
      { path: `${project}/${otherGeneration}.pdf` },
    ]) {
      assert.equal(await settle(db, generation, mismatch), false);
      await retire(db, generation, mismatch);
    }
    assert.equal(
      (await db.query("select state from public.account_storage_artifacts")).rows[0].state,
      "pending",
    );
    assert.equal(await settle(db), true);
    assert.equal(
      await settle(db, generation, { ownerId: requester }),
      false,
      "published idempotency cannot bypass exact binding",
    );
    await assert.rejects(
      db.query("select public.settle_account_storage_artifact($1)", [generation]),
      /does not exist/u,
    );
    await assert.rejects(
      db.query("select public.retire_account_storage_artifact($1)", [generation]),
      /does not exist/u,
    );
  } finally {
    await db.close();
  }
});

test("recorded Library cleanup removes only the exact retired generation metadata", async () => {
  const db = await database();
  try {
    const path = `${owner}/${generation}.png`;
    assert.equal(await reserve(db, { requesterId: owner, bucket: "library-images", path }), true);
    await db.query(
      "insert into public.user_library_items(user_id,title,file_url,metadata) values ($1,'matching',$2,$3)",
      [owner, path, { storage_generation: generation }],
    );
    await db.query(
      "insert into public.user_library_items(user_id,title,file_url,metadata) values ($1,'other generation',$2,$3)",
      [owner, path, { storage_generation: otherGeneration }],
    );
    await db.query(
      "insert into public.user_library_items(user_id,title,file_url,metadata) values ($1,'other owner',$2,$3)",
      [requester, path, { storage_generation: generation }],
    );
    assert.equal(await recordCleanup(db), false, "pending uploads cannot remove metadata");
    await retire(db);
    await claim(db);
    assert.equal(await recordCleanup(db), true);
    assert.deepEqual(
      (await db.query("select title from public.user_library_items order by title")).rows,
      [{ title: "other generation" }, { title: "other owner" }],
    );
    assert.equal(
      (await db.query("select state from public.account_storage_artifacts")).rows[0].state,
      "retired",
    );
  } finally {
    await db.close();
  }
});

test("a real service role can reserve and publish without SELECT on Auth users", async () => {
  const db = await database();
  try {
    await db.exec(
      "grant select on public.account_deletion_fences to service_role; set role service_role",
    );
    assert.equal(
      (await db.query("select has_table_privilege(current_user,'auth.users','SELECT') allowed"))
        .rows[0].allowed,
      false,
    );
    assert.equal(await reserve(db), true);
    assert.equal(await settle(db), true);
  } finally {
    await db.close();
  }
});
