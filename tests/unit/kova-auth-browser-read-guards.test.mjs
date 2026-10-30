import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { authDatabase, livePasswordAccount } from "../helpers/kova-auth-database.mjs";

const migration = await readFile(
  new URL(
    "../../supabase/migrations/20261030121100_kova_browser_read_session_guards.sql",
    import.meta.url,
  ),
  "utf8",
);
const tables = ["chat_history_records", "library_folders"];
// Reuse the complete checked postcondition under the same relation locks before
// dropping the two exact additions. This is only an isolated reversal rehearsal.
const rollback = `begin;
  lock table public.chat_history_records,public.library_folders in share row exclusive mode;
  do $$begin
    if (select count(*) from pg_policy where polname='kova_owned_browser_read_guard'
      and polrelid in('public.chat_history_records'::regclass,'public.library_folders'::regclass))<>2
    then raise exception 'kova_browser_read_rollback_missing_policy';end if;
  end$$;
  ${migration}
  drop policy kova_owned_browser_read_guard on public.chat_history_records;
  drop policy kova_owned_browser_read_guard on public.library_folders;
  commit;`;

async function fixture() {
  const db = await authDatabase({
    beforeMigrations: `
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
      $$;
    `,
  });
  await db.exec(`
    -- Create the browser-readable tables after canonical guard coverage, matching
    -- the observed production gap. The existing chat helper is independently
    -- covered elsewhere; return true here so it cannot hide the missing guard.
    create function kova_private.chat_history_reader_current() returns boolean
      language sql stable security definer set search_path='' as $$ select true $$;
    revoke all on function kova_private.chat_history_reader_current() from public,anon;
    grant execute on function kova_private.chat_history_reader_current() to authenticated;
    create table public.chat_history_records(id uuid primary key,owner_id uuid,payload text);
    create table public.library_folders(id uuid primary key,user_id uuid,name text);
    alter table public.chat_history_records enable row level security;
    alter table public.library_folders enable row level security;
    revoke all on public.chat_history_records,public.library_folders from public,anon,authenticated;
    grant select on public.chat_history_records,public.library_folders to authenticated;
    grant all on public.chat_history_records,public.library_folders to service_role;
    create policy chat_history_owner_read on public.chat_history_records for select to authenticated
      using(owner_id=(select auth.uid()) and (select kova_private.chat_history_reader_current()));
    create policy "library folders owner read" on public.library_folders for select to authenticated
      using((select auth.uid())=user_id);
  `);
  return db;
}

async function queryAs(db, caller, sql, role = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(caller)]);
    await tx.exec(`set local role ${role}`);
    return tx.query(sql);
  });
}

function claims(account) {
  const now = Math.floor(Date.now() / 1000);
  return {
    kova_auth: 1,
    role: "authenticated",
    aud: "authenticated",
    sub: account.account_id,
    session_id: account.session_id,
    email: account.email,
    email_verified: true,
    aal: account.assurance_level,
    iat: now,
    exp: now + 300,
  };
}

async function guards(db) {
  return (
    await db.query(`select polrelid::regclass::text as relation,oid,polpermissive,polcmd,
      polroles::text,pg_get_expr(polqual,polrelid) as expression
      from pg_policy where polname='kova_owned_browser_read_guard' order by polrelid`)
  ).rows;
}

async function preserved(db) {
  return (
    await db.query(`select
      (select jsonb_agg(jsonb_build_object('id',id,'owner',owner_id,'payload',payload) order by id)
         from public.chat_history_records) as chats,
      (select jsonb_agg(jsonb_build_object('id',id,'owner',user_id,'name',name) order by id)
         from public.library_folders) as folders,
      (select jsonb_agg(jsonb_build_object('oid',c.oid,'acl',c.relacl::text) order by c.oid)
         from pg_class c where c.oid in('public.chat_history_records'::regclass,'public.library_folders'::regclass,
           'kova_private.auth_accounts'::regclass,'kova_private.auth_sessions'::regclass)) as relations,
      (select jsonb_agg(jsonb_build_object('oid',p.oid,'qual',pg_get_expr(p.polqual,p.polrelid)) order by p.oid)
         from pg_policy p where p.polname in('chat_history_owner_read','library folders owner read')) as owners,
      (select jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl::text,'body',p.prosrc) order by p.oid)
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='kova_auth_guard') as functions,
      (select count(*)::int from kova_private.auth_accounts) as accounts,
      (select count(*)::int from kova_private.auth_sessions) as sessions`)
  ).rows[0];
}

test("two additive browser guards enforce owned revocation while preserving owner and hosted isolation", async () => {
  const db = await fixture();
  try {
    const owner = await livePasswordAccount(db, { id: randomUUID(), token: randomUUID() });
    const other = await livePasswordAccount(db, { id: randomUUID(), token: randomUUID() });
    const hostedId = randomUUID();
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'hosted@example.invalid',now())",
      [hostedId],
    );
    for (const [table, column, value] of [
      ["chat_history_records", "owner_id", "payload"],
      ["library_folders", "user_id", "name"],
    ]) {
      for (const id of [owner.account_id, other.account_id, hostedId]) {
        await db.query(
          `insert into public.${table}(id,${column},${value}) values($1,$2,'private')`,
          [randomUUID(), id],
        );
      }
    }
    const ownerClaims = claims(owner);
    const hostedClaims = { sub: hostedId, role: "authenticated" };
    const before = await preserved(db);
    assert.equal((await guards(db)).length, 0);
    await db.exec(migration);
    assert.deepEqual(await preserved(db), before);
    const firstGuards = await guards(db);
    assert.equal(firstGuards.length, 2);
    assert.ok(firstGuards.every((policy) => !policy.polpermissive && policy.polcmd === "r"));
    for (const table of tables) {
      const ownerColumn = table === "chat_history_records" ? "owner_id" : "user_id";
      for (const [caller, expectedOwner] of [
        [ownerClaims, owner.account_id],
        [claims(other), other.account_id],
        [hostedClaims, hostedId],
      ]) {
        const result = (await queryAs(db, caller, `select * from public.${table}`)).rows;
        assert.equal(result.length, 1);
        assert.equal(result[0][ownerColumn], expectedOwner);
      }
      await assert.rejects(
        queryAs(db, {}, `select * from public.${table}`, "anon"),
        /permission denied/u,
      );
      assert.equal(
        (
          await queryAs(
            db,
            { ...ownerClaims, session_id: randomUUID() },
            `select * from public.${table}`,
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (await queryAs(db, { ...ownerClaims, email: other.email }, `select * from public.${table}`))
          .rows.length,
        0,
      );
      assert.equal(
        (
          await queryAs(
            db,
            { ...ownerClaims, iat: ownerClaims.iat - 600, exp: ownerClaims.iat - 300 },
            `select * from public.${table}`,
          )
        ).rows.length,
        0,
      );
    }
    await db.exec(migration);
    assert.deepEqual(await guards(db), firstGuards);
    assert.deepEqual(await preserved(db), before);

    await db.query("select public.kova_auth_revoke_session($1)", [owner.digest]);
    const revoked = await preserved(db);
    for (const table of tables) {
      assert.equal(
        (await queryAs(db, ownerClaims, `select * from public.${table}`)).rows.length,
        0,
      );
      assert.equal(
        (await queryAs(db, claims(other), `select * from public.${table}`)).rows.length,
        1,
      );
    }

    // Qualify the deliberately narrow rollback only against the exact saved
    // poststate. Refuse changed policies before DROP and never use CASCADE.
    assert.deepEqual(await guards(db), firstGuards);
    await db.exec(rollback);
    assert.deepEqual(await preserved(db), revoked);
    assert.equal((await guards(db)).length, 0);
    for (const table of tables) {
      assert.equal(
        (await queryAs(db, ownerClaims, `select * from public.${table}`)).rows.length,
        1,
      );
    }
    await db.exec(migration);
    for (const table of tables) {
      assert.equal(
        (await queryAs(db, ownerClaims, `select * from public.${table}`)).rows.length,
        0,
      );
    }
  } finally {
    await db.close();
  }
});

for (const [name, sql, error] of [
  [
    "guard body drift",
    "create or replace function kova_auth_guard.session_is_active() returns boolean language plpgsql stable security definer set search_path='' as $$begin return true;end$$",
    /guard_definition_drift/u,
  ],
  [
    "guard execution revoked",
    "revoke execute on function kova_auth_guard.session_is_active() from authenticated",
    /guard_definition_drift/u,
  ],
  ["authenticated role bypasses RLS", "alter role authenticated bypassrls", /roles_drift/u],
  [
    "owner predicate drift",
    "alter policy chat_history_owner_read on public.chat_history_records using(true)",
    /owner_policy_drift/u,
  ],
  [
    "unexpected policy on second table",
    "create policy unexpected_access on public.library_folders for select to authenticated using(true)",
    /owner_policy_drift/u,
  ],
  [
    "RLS disabled on second table",
    "alter table public.library_folders disable row level security",
    /table_privilege_drift/u,
  ],
  [
    "authenticated mutation grant",
    "grant insert on public.chat_history_records to authenticated",
    /table_privilege_drift/u,
  ],
  [
    "authenticated maintenance grant",
    "grant maintain on public.chat_history_records to authenticated",
    /table_privilege_drift/u,
  ],
  [
    "anonymous maintenance grant",
    "grant maintain on public.library_folders to anon",
    /table_privilege_drift/u,
  ],
  [
    "anonymous column access",
    "grant select(name) on public.library_folders to anon",
    /table_privilege_drift/u,
  ],
  [
    "public table grant",
    "grant select on public.library_folders to public",
    /table_privilege_drift/u,
  ],
  [
    "conflicting guard on second table",
    "create policy kova_owned_browser_read_guard on public.library_folders as restrictive for select to authenticated using(true)",
    /policy_conflict/u,
  ],
  [
    "weakened earlier broad guard",
    "create policy kova_owned_session_guard on public.library_folders as restrictive for all to anon,authenticated using(true) with check(true)",
    /existing_guard_conflict/u,
  ],
  [
    "earlier broad guard with absent predicate",
    "create policy kova_owned_session_guard on public.library_folders as restrictive for all to anon,authenticated",
    /existing_guard_conflict/u,
  ],
  [
    "earlier broad guard with absent explicit check",
    "create policy kova_owned_session_guard on public.library_folders as restrictive for all to anon,authenticated using((select kova_auth_guard.session_is_active()))",
    /existing_guard_conflict/u,
  ],
]) {
  test(`browser guard refuses ${name} without a partial repair`, async () => {
    const db = await fixture();
    try {
      await db.exec(sql);
      const before = await guards(db);
      const beforePreserved = await preserved(db);
      await assert.rejects(db.exec(migration), error);
      assert.deepEqual(await guards(db), before);
      assert.deepEqual(await preserved(db), beforePreserved);
    } finally {
      await db.close();
    }
  });
}

test("canonical preexisting all-command guards are validated and preserved", async () => {
  const db = await fixture();
  try {
    for (const table of tables) {
      await db.exec(`create policy kova_owned_session_guard on public.${table}
        as restrictive for all to anon,authenticated
        using((select kova_auth_guard.session_is_active()))
        with check((select kova_auth_guard.session_is_active()))`);
    }
    const before = (
      await db.query(
        "select oid,polrelid,polqual::text,polwithcheck::text from pg_policy where polname='kova_owned_session_guard' order by oid",
      )
    ).rows;
    await db.exec(migration);
    assert.equal((await guards(db)).length, 2);
    assert.deepEqual(
      (
        await db.query(
          "select oid,polrelid,polqual::text,polwithcheck::text from pg_policy where polname='kova_owned_session_guard' order by oid",
        )
      ).rows,
      before,
    );
  } finally {
    await db.close();
  }
});

test("conflicting replay never replaces a guard or owner policy", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(
      "alter policy kova_owned_browser_read_guard on public.library_folders using(true)",
    );
    const before = await guards(db);
    const old = await preserved(db);
    await assert.rejects(db.exec(migration), /policy_conflict/u);
    assert.deepEqual(await guards(db), before);
    assert.deepEqual(await preserved(db), old);
    await assert.rejects(db.exec(rollback), /policy_conflict/u);
    await db.exec("rollback");
    assert.deepEqual(await guards(db), before);
    assert.deepEqual(await preserved(db), old);
  } finally {
    await db.close();
  }
});
