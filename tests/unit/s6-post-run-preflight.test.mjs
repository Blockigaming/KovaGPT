import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { S6Run } from "../../scripts/release/s6-deployed-checks.mjs";
import { postgresReadiness } from "../../scripts/release/s6-realtime-probe.mjs";

const makeRun = (database = {}) =>
  new S6Run({
    database,
    serviceKey: "test",
    apiKey: "test",
    deadline: Date.now() + 100000,
    sourceSha: "5f8cdcf059643a2fa82257ef97773c87448f70d1",
  });

test("missing or unreadable account fence stops Storage before fixture writes with exact receipt", async () => {
  for (const [accountFence, accountFenceReadable, assertionId] of [
    [false, false, "storage_private_account_fence"],
    [true, false, "storage_private_account_fence_readable"],
  ]) {
    const run = makeRun({
      json: () => ({ bucket: true, columns: 2, accountFence, accountFenceReadable }),
    });
    run.signup = () => assert.fail("fixture must not be created");
    run.service = () => assert.fail("Storage must not be called");
    try {
      await run.check("storage_revocation_and_url_lifetime", () => run.storageCheck());
      assert.equal(run.records[0].assertionId, assertionId);
      assert.equal(run.records[0].actual, false);
      assert.equal(run.records[0].expected, true);
    } finally {
      await run.dispatcher.close();
    }
  }
});

test("staging fence prerequisite is guarded, preserves irreversible security and satisfies actual preflight SQL", async () => {
  const db = new PGlite();
  const run = makeRun();
  let query;
  run.db = {
    json: (sql) => {
      query = sql;
      return { bucket: true, columns: 2, accountFence: true, accountFenceReadable: true };
    },
  };
  try {
    run.storagePreflight();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema kova_private; create schema storage;
      create table auth.users(id uuid primary key);
      create table storage.buckets(id text, public boolean,file_size_limit bigint,allowed_mime_types text[]);
      insert into storage.buckets values('project-files',false,10485760,ARRAY['image/png']);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table public.developer_credit_accounts(id uuid primary key);
      create table public.chat_memories(user_id uuid,chat_id text);
      create table public.projects(id uuid,owner_id uuid,name text,description text,updated_at timestamptz);
      create table public.project_chats(id uuid,project_id uuid,title text,updated_at timestamptz);
      create table public.project_files(id uuid,project_id uuid,name text,mime_type text,created_at timestamptz,status text,content_sha256 text);
      create table public.project_memory(id uuid,project_id uuid,content text,created_at timestamptz);
      create table public.user_library_items(id uuid,user_id uuid,item_type text,title text,content_text text,updated_at timestamptz);
      create table public.context_packs(id uuid,user_id uuid,name text,description text,updated_at timestamptz);
      create table public.scheduled_tasks(id uuid,user_id uuid,title text,prompt text,updated_at timestamptz);
      create table public.prompt_templates(id uuid,user_id uuid,project_id uuid,name text,body text,updated_at timestamptz);
      create table public.goals(id uuid,owner_id uuid,project_id uuid,title text,description text,updated_at timestamptz);`);
    assert.deepEqual((await db.query(query)).rows[0].json_build_object, {
      bucket: true,
      columns: 2,
      accountFence: false,
      accountFenceReadable: false,
    });
    const repair = readFileSync("scripts/release/s6-storage-fence-prerequisite.sql", "utf8");
    await assert.rejects(db.exec(repair), /s6_staging_project_binding_required/);
    await db.exec("rollback; set s6.staging_project_ref='oztdrjtdglkizlewnulh';");
    await db.exec(repair);
    assert.deepEqual((await db.query(query)).rows[0].json_build_object, {
      bucket: true,
      columns: 2,
      accountFence: true,
      accountFenceReadable: true,
    });
    const security = (
      await db.query(`select relrowsecurity as rls,
      has_table_privilege('authenticated','public.account_deletion_fences','SELECT') as public_read,
      has_table_privilege('service_role','public.account_deletion_fences','DELETE') as service_delete,
      has_table_privilege('service_role','public.account_deletion_fences','TRUNCATE') as service_truncate
      from pg_class where oid='public.account_deletion_fences'::regclass`)
    ).rows[0];
    assert.deepEqual(security, {
      rls: true,
      public_read: false,
      service_delete: false,
      service_truncate: false,
    });
    assert.deepEqual(
      (
        await db.query(`select tgname from pg_trigger where tgrelid='public.account_deletion_fences'::regclass
        and not tgisinternal order by tgname`)
      ).rows.map((r) => r.tgname),
      [
        "clear_chat_memory_on_account_deletion",
        "developer_funding_deletion_barrier",
        "preserve_started_account_deletion",
        "trusted_contacts_account_fence",
        "workspace_search_account_fence",
      ],
    );
    assert.equal(
      (
        await db.query(`select count(*)::int n from pg_class where relname in (
      'account_deletion_fences','chat_memory_write_epochs','chat_context_summaries','trusted_contacts',
      'developer_credit_offers','developer_funding_attempts','workspace_search_index') and relrowsecurity`)
      ).rows[0].n,
      7,
    );
    await db.exec(`insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
      insert into public.trusted_contacts(id,inviter_id,recipient_id,inviter_email,recipient_email,policy_version)
        values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222','fixture-one@example.invalid','fixture-two@example.invalid','trusted-contact-consent-v1');
      insert into public.developer_credit_accounts values('44444444-4444-4444-8444-444444444444');
      insert into public.developer_credit_offers(id,name,environment,stripe_price_id,currency,subtotal_amount,credits_amount,
        refund_reserve,dispute_reserve,maximum_processor_fee,tax_mode,tax_review_reference,approved_at,expires_at)
        values('55555555-5555-4555-8555-555555555555','offline','sandbox','price_offline','USD',100,100,0,0,0,
          'reviewed_exempt','offline',now(),now()+interval '1 hour');
      insert into public.developer_funding_attempts(account_id,owner_id,request_key,offer_id,offer_snapshot,state)
        values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','offline',
          '55555555-5555-4555-8555-555555555555','{}','open');`);
    await assert.rejects(
      db.exec(`insert into public.account_deletion_fences(user_id)
      values('11111111-1111-4111-8111-111111111111')`),
      /developer_payment_reconciliation_pending/,
    );
    await db.exec(`update public.developer_funding_attempts set state='paid';
      insert into public.chat_memories values('11111111-1111-4111-8111-111111111111','disposable');
      insert into public.workspace_search_index(source_table,source_id,owner_id,source_digest)
        values('projects','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','digest');
      insert into public.account_deletion_fences(user_id) select id from auth.users;`);
    assert.equal((await db.query("select count(*)::int n from public.chat_memories")).rows[0].n, 0);
    assert.equal(
      (await db.query("select count(*)::int n from public.workspace_search_index")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select state from public.trusted_contacts")).rows[0].state,
      "revoked",
    );
    await assert.rejects(
      db.exec("delete from public.account_deletion_fences"),
      /account_deletion_irreversible/,
    );
    await assert.rejects(
      db.exec(
        "update public.account_deletion_fences set started_at=started_at+interval '1 second'",
      ),
      /account_deletion_irreversible/,
    );
    await db.exec("delete from auth.users;");
    assert.equal(
      (await db.query("select count(*)::int as n from public.account_deletion_fences")).rows[0].n,
      0,
    );
  } finally {
    await run.dispatcher.close();
    await db.close();
  }
});

test("Postgres readiness is channel-specific, bounded and preserves sanitized error counters", async () => {
  const run = makeRun(),
    events = { postgresReady: 0, postgresErrors: 0 };
  const bind = (gate) => {
    let callback;
    gate.bind({
      on: (event, _filter, fn) => {
        assert.equal(event, "system");
        callback = fn;
      },
    });
    return callback;
  };
  let now = 0;
  const timing = [
    200,
    () => now,
    async () => {
      now += 100;
    },
  ];
  try {
    const initial = postgresReadiness(events),
      emit = bind(initial);
    emit({ extension: "broadcast", status: "ok" });
    await assert.rejects(
      initial.wait(run, "realtime_initial_postgres_ready", ...timing),
      /realtime_initial_postgres_ready/,
    );
    emit({ extension: "postgres_changes", status: "ok" });
    emit({ extension: "postgres_changes", status: "ok" });
    assert.equal(events.postgresReady, 1);
    await initial.wait(run, "realtime_initial_postgres_ready", ...timing);
    const fresh = postgresReadiness(events),
      freshEmit = bind(fresh);
    freshEmit({
      extension: "postgres_changes",
      status: "error",
      message: "SECRET_MUST_NOT_APPEAR",
    });
    await run.check("realtime_reauthorization", () =>
      fresh.wait(run, "realtime_fresh_postgres_ready", ...timing),
    );
    assert.equal(run.records[0].assertionId, "realtime_fresh_postgres_ready");
    assert.deepEqual(run.records[0].diagnostics, { postgresReady: 1, postgresErrors: 1 });
    assert.ok(!JSON.stringify(run.records).includes("SECRET_MUST_NOT_APPEAR"));
  } finally {
    await run.dispatcher.close();
  }
});

test("cleanup disables only this run's retained credentials and refuses a residual credential", async () => {
  const db = new PGlite();
  const run = makeRun();
  const statements = [];
  const email = `s6-${run.runId}-signup@example.invalid`;
  run.fixtures = [{ email }];
  run.db = {
    query: (sql) => statements.push(sql),
    json: () => ({ credentials: 0, sessions: 0, activeAccounts: 0, queued: 0 }),
  };
  try {
    await run.cleanup();
    const sql = statements.find((x) => x.includes("update kova_private.auth_credentials"));
    const update = sql.match(/update kova_private\.auth_credentials[^;]+;/)[0];
    await db.exec(`create schema kova_private;
      create table kova_private.auth_accounts(id int,primary_email text,deleted_at timestamptz);
      create table kova_private.auth_credentials(account_id int,disabled_at timestamptz,updated_at timestamptz);
      insert into kova_private.auth_accounts values(1,'${email}',now()),(2,'unrelated@example.invalid',null);
      insert into kova_private.auth_credentials values(1,null,null),(2,null,null);`);
    await db.exec(update);
    assert.deepEqual(
      (
        await db.query(
          "select account_id,disabled_at is not null as disabled from kova_private.auth_credentials order by account_id",
        )
      ).rows,
      [
        { account_id: 1, disabled: true },
        { account_id: 2, disabled: false },
      ],
    );
    run.db.json = () => ({ credentials: 1, sessions: 0, activeAccounts: 0, queued: 0 });
    await assert.rejects(run.cleanup(), /synthetic cleanup incomplete/);
    assert.equal(run.cleanupComplete, false);
  } finally {
    await run.dispatcher.close();
    await db.close();
  }
});
