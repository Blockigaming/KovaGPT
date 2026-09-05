import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const sql = (name) =>
  readFileSync(new URL("../../supabase/migrations/" + name, import.meta.url), "utf8");
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema kova_private;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
 create function public.touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
 create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade,requested_at timestamptz default now(),updated_at timestamptz default now());
 create table public.user_preferences(user_id uuid primary key,settings jsonb);
 create table public.test_plans(user_id uuid primary key,tier text);
 create table public.test_event_readiness(enabled boolean);insert into public.test_event_readiness values(true);
 create function public.scheduled_task_event_grant_ready(uuid) returns boolean language sql stable as $$select enabled from public.test_event_readiness$$;
 create function public.effective_user_plan_tier(uuid) returns text language sql stable as $$select coalesce((select tier from public.test_plans where user_id=$1),'free')$$;
 create table public.user_library_items(id uuid primary key,user_id uuid,title text,content_text text);
 create table public.projects(id uuid primary key,owner_id uuid,deletion_requested_at timestamptz);
 create table public.project_files(id uuid primary key,project_id uuid,status text,account_cleanup_user_id uuid);
 create function public.is_project_member(uuid,uuid) returns boolean language sql stable as $$select exists(select 1 from public.projects where id=$2 and owner_id=$1)$$;
 create table public.google_oauth_tokens(id uuid primary key,user_id uuid,grant_id uuid,google_sub text,scopes text,expires_at timestamptz,refresh_token text,revoked_at timestamptz,reauthorization_required boolean default false,identity_verified boolean default true);
 create table public.integration_linked_accounts(id uuid primary key,owner_id uuid,provider_id text,provider_account_id text,status text,deleted_at timestamptz,token_expires_at timestamptz,granted_scopes text[],credential_key_version integer,updated_at timestamptz,workspace_id uuid);
 create table public.integration_consents(id uuid primary key default gen_random_uuid(),owner_id uuid,linked_account_id uuid,decision text,scopes text[],created_at timestamptz default now());
 create table public.integration_workspace_policies(workspace_id uuid,provider_id text,enabled boolean,allowed_scopes text[]);
 create table public.app_notifications(id uuid primary key default gen_random_uuid(),owner_id uuid,type text,title text,safe_preview text,action_url text,source_entity text,delivery_state text);
 create table public.notification_preferences(user_id uuid primary key,in_app_enabled boolean,categories jsonb);
 grant usage on schema auth,kova_private to authenticated,service_role;
 grant all on all tables in schema public to service_role;
 insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.com',now()),('${other}','other@example.com',now());
 insert into public.test_plans values('${owner}','pro'),('${other}','plus');
 revoke all on auth.users from public,anon,authenticated,service_role;`);
  for (const name of [
    "20260905001736_private_auth_identity_helpers.sql",
    "20260627210732_128bcdac-00eb-458b-8801-2a1bdb24915f.sql",
    "20260722123000_connectors_tasks_sharing_settings_audit.sql",
    "20260822143000_day14_scheduled_execution.sql",
    "20260823113000_day14_atomic_settlement.sql",
    "20260905005111_scheduled_tasks_activation_foundation.sql",
  ])
    await db.exec(sql(name));
  await db.exec("grant all on all tables in schema public to service_role;set role service_role");
  return db;
}
async function activate(db) {
  await db.exec(
    "update public.scheduled_task_runtime set enabled=true,policy_version='test-v1',enabled_event_providers=array['gmail','slack','github'];select public.scheduled_task_heartbeat('test-v1')",
  );
}
async function mutate(db, action, payload = {}, options = {}) {
  const id = options.id ?? randomUUID();
  const row = await db.query("select public.mutate_scheduled_task($1,$2,$3,$4,$5,$6,$7) result", [
    options.user ?? owner,
    options.mutationId ?? randomUUID(),
    id,
    options.revision ?? (action === "create" ? 0 : 1),
    action,
    JSON.stringify(payload),
    "test-v1",
  ]);
  return { id, ...row.rows[0].result };
}
const createPayload = () => ({
  title: "Daily task",
  prompt: "Write a short useful report.",
  run_at: new Date(Date.now() + 120000).toISOString(),
  repeat: "daily",
  timezone: "America/New_York",
});

test("Tasks require approved runtime plus fresh heartbeat and exact mutation receipts under service-only authority", async () => {
  const db = await fixture();
  try {
    await assert.rejects(mutate(db, "create", createPayload()), /execution_unavailable/);
    await activate(db);
    const id = randomUUID(),
      mutationId = randomUUID(),
      payload = createPayload();
    const result = await mutate(db, "create", payload, { id, mutationId });
    assert.equal(result.taskId, id);
    assert.deepEqual(await mutate(db, "create", payload, { id, mutationId }), result);
    await assert.rejects(
      mutate(db, "create", { ...payload, title: "Changed" }, { id, mutationId }),
      /idempotency_conflict/,
    );
    await assert.rejects(mutate(db, "pause", {}, { id, revision: 0 }), /revision_conflict/);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await assert.rejects(
      db.query("update public.scheduled_tasks set status='running' where id=$1", [id]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("Anchored recurrence defines gap, fold, and month-end behavior without UTC drift", async () => {
  const db = await fixture();
  try {
    const next = async (anchor, repeat, zone, after) =>
      (
        await db.query("select kova_private.next_task_occurrence($1,$2,$3,$4) n", [
          anchor,
          repeat,
          zone,
          after,
        ])
      ).rows[0].n.toISOString();
    assert.equal(
      await next("2026-03-07 02:30", "daily", "America/New_York", "2026-03-08T00:00:00Z"),
      "2026-03-08T07:30:00.000Z",
    );
    assert.equal(
      await next("2026-10-31 01:30", "daily", "America/New_York", "2026-11-01T00:00:00Z"),
      "2026-11-01T06:30:00.000Z",
    );
    assert.equal(
      await next("2026-01-31 09:00", "monthly", "UTC", "2026-02-01T00:00:00Z"),
      "2026-02-28T09:00:00.000Z",
    );
    assert.equal(
      await next("2026-01-31 09:00", "monthly", "UTC", "2026-03-01T00:00:00Z"),
      "2026-03-31T09:00:00.000Z",
    );
  } finally {
    await db.close();
  }
});

test("Task copies target one verified recipient, strip connection/context authority, and remain paused", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const created = await mutate(db, "create", {
      ...createPayload(),
      contextRefs: [
        {
          kind: "snapshot",
          text: "Explicit private task context",
          sourceChatId: "chat",
          capturedAt: new Date().toISOString(),
        },
      ],
    });
    const offer = await mutate(db, "shareCopy", { email: "other@example.com" }, { id: created.id });
    await assert.rejects(
      mutate(db, "acceptCopy", { offerId: offer.offerId }, { user: owner, revision: 0 }),
      /copy_unavailable/,
    );
    const copied = await mutate(
      db,
      "acceptCopy",
      { offerId: offer.offerId },
      { user: other, revision: 0 },
    );
    const row = (
      await db.query("select * from public.scheduled_tasks where id=$1", [copied.taskId])
    ).rows[0];
    assert.equal(row.user_id, other);
    assert.equal(row.status, "paused");
    assert.equal(row.automation_consent_at, null);
    assert.deepEqual(row.context_refs, []);
    assert.deepEqual(row.event_triggers, []);
  } finally {
    await db.close();
  }
});

async function gmailGrant(db) {
  const connection = randomUUID(),
    generation = randomUUID(),
    grant = randomUUID();
  await db.query(
    "insert into public.google_oauth_tokens(id,user_id,grant_id,google_sub,scopes,expires_at) values($1,$2,$3,'subject','https://www.googleapis.com/auth/gmail.readonly',now()+interval '1 hour')",
    [connection, owner, generation],
  );
  await db.query(
    "select public.grant_scheduled_task_connection($1,$2,'gmail',$3,$4,'subject',array['https://www.googleapis.com/auth/gmail.readonly'])",
    [owner, grant, connection, generation],
  );
  return { connection, generation, grant };
}
async function claim(db, id) {
  await db.query(
    "update public.scheduled_tasks set next_run_at=date_trunc('milliseconds',now()-interval '1 second') where id=$1 and trigger_mode='time'",
    [id],
  );
  const task = (await db.query("select * from public.claim_due_scheduled_tasks('worker',1,120)"))
    .rows[0];
  assert.equal(task.id, id);
  const at = task.next_run_at ?? task.run_at,
    runId = id + ":" + at.getTime();
  return { task, at, runId };
}
async function begin(db, run) {
  return (
    await db.query("select public.begin_scheduled_task_run($1,'worker',$2,$3) result", [
      run.task.id,
      run.at,
      run.runId,
    ])
  ).rows[0].result;
}

test("claimed Tasks stop when runtime or policy changes before admission and publication", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const created = await mutate(db, "create", createPayload()),
      run = await claim(db, created.id);
    await db.exec("update public.scheduled_task_runtime set enabled=false");
    await assert.rejects(begin(db, run), /execution_unavailable/);
    assert.equal(
      (
        await db.query("select public.scheduled_task_check_execution($1,'worker') ready", [
          created.id,
        ])
      ).rows[0].ready,
      false,
    );
    await activate(db);
    await begin(db, run);
    await db.exec("update public.scheduled_task_runtime set policy_version='new-policy'");
    await assert.rejects(
      db.query("select public.read_scheduled_task_saved_context($1,'worker')", [created.id]),
      /authorization_changed/,
    );
    await assert.rejects(
      db.query(
        "select public.settle_scheduled_task_success($1,'worker',$2,$3,'Should not publish')",
        [created.id, run.at, run.runId],
      ),
      /authorization_changed/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.app_notifications")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("connection grants bind one immutable account and grant generation, never a selected default", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const linked = await gmailGrant(db);
    assert.equal(
      (
        await db.query("select public.validate_scheduled_task_connection_grant($1,$2) ok", [
          owner,
          linked.grant,
        ])
      ).rows[0].ok,
      true,
    );
    await db.query("update public.google_oauth_tokens set grant_id=$1 where id=$2", [
      randomUUID(),
      linked.connection,
    ]);
    assert.equal(
      (
        await db.query("select public.validate_scheduled_task_connection_grant($1,$2) ok", [
          owner,
          linked.grant,
        ])
      ).rows[0].ok,
      false,
    );
    await assert.rejects(
      mutate(db, "create", {
        ...createPayload(),
        contextRefs: [
          { kind: "connected", grantId: linked.grant, provider: "gmail", resource: "abc" },
        ],
      }),
      /connection_unavailable/,
    );
    await assert.rejects(
      db.query(
        "select public.grant_scheduled_task_connection($1,$2,'gmail',$3,$4,'subject',null)",
        [owner, randomUUID(), linked.connection, linked.generation],
      ),
      /connection_unavailable/,
    );
    const acl = (
      await db.query(
        "select has_table_privilege(current_user,'auth.users','SELECT') auth_read,has_function_privilege('authenticated','public.grant_scheduled_task_connection(uuid,uuid,text,text,text,text,text[])','EXECUTE') browser_write",
      )
    ).rows[0];
    assert.deepEqual(acl, { auth_read: false, browser_write: false });
  } finally {
    await db.close();
  }
});

test("event delivery is idempotent, filters are explicit, and each accepted event settles once", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const linked = await gmailGrant(db);
    const created = await mutate(db, "create", {
      title: "Inbox updates",
      prompt: "Summarize the incoming message.",
      repeat: "none",
      triggerMode: "event",
      timezone: "UTC",
      eventTriggers: [
        {
          provider: "gmail",
          grantId: linked.grant,
          resource: "inbox",
          author: "sender@example.com",
          contains: "Project",
        },
      ],
    });
    const admit = async (key, event) =>
      (
        await db.query("select public.admit_scheduled_task_event($1,$2,$3) n", [
          linked.grant,
          key,
          JSON.stringify(event),
        ])
      ).rows[0].n;
    const event = {
      occurredAt: new Date(Date.now() + 1000).toISOString(),
      resource: "inbox",
      author: "sender@example.com",
      title: "Project update",
      text: "Source content",
    };
    assert.equal(await admit("gmail:1", { ...event, author: "other@example.com" }), 0);
    assert.equal(await admit("gmail:1", event), 1);
    assert.equal(await admit("gmail:1", event), 0);
    const run = await claim(db, created.id);
    assert.deepEqual((await begin(db, run)).event, event);
    await db.query("select public.settle_scheduled_task_success($1,'worker',$2,$3,'Result')", [
      created.id,
      run.at,
      run.runId,
    ]);
    await assert.rejects(
      db.query("select public.settle_scheduled_task_success($1,'worker',$2,$3,'Duplicate')", [
        created.id,
        run.at,
        run.runId,
      ]),
      /lease_not_owned/,
    );
    assert.equal(await admit("gmail:1", event), 0);
    assert.equal(await admit("gmail:2", event), 1);
    const next = await claim(db, created.id);
    assert.notEqual(next.runId, run.runId);
    assert.equal(
      (await db.query("select count(*)::int n from public.app_notifications")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("revocation and account deletion fence leased work before context or results can escape", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const linked = await gmailGrant(db);
    const created = await mutate(db, "create", {
      ...createPayload(),
      contextRefs: [
        { kind: "connected", grantId: linked.grant, provider: "gmail", resource: "abc" },
      ],
    });
    const run = await claim(db, created.id);
    await begin(db, run);
    await db.query("select public.revoke_scheduled_task_connection($1,$2)", [owner, linked.grant]);
    assert.equal(
      (
        await db.query("select public.scheduled_task_check_execution($1,'worker') ready", [
          created.id,
        ])
      ).rows[0].ready,
      false,
    );
    assert.equal(
      (await db.query("select status from public.scheduled_task_runs where id=$1", [run.runId]))
        .rows[0].status,
      "canceled",
    );
    const next = await mutate(db, "create", createPayload()),
      leased = await claim(db, next.id);
    await begin(db, leased);
    await db.query("insert into public.account_deletion_fences(user_id) values($1)", [owner]);
    await assert.rejects(
      db.query("select public.read_scheduled_task_saved_context($1,'worker')", [next.id]),
      /account_unavailable/,
    );
    await assert.rejects(
      db.query("select public.settle_scheduled_task_success($1,'worker',$2,$3,'No publication')", [
        next.id,
        leased.at,
        leased.runId,
      ]),
      /account_unavailable/,
    );
  } finally {
    await db.close();
  }
});

test("expired leases retain bounded retries and terminal timeout status without duplicate notifications", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const created = await mutate(db, "create", createPayload()),
      run = await claim(db, created.id);
    await begin(db, run);
    await db.query(
      "update public.scheduled_tasks set lease_expires_at=now()-interval '1 second' where id=$1",
      [created.id],
    );
    assert.equal(
      (await db.query("select public.recover_expired_scheduled_task_leases() n")).rows[0].n,
      1,
    );
    const retry = (
      await db.query("select status,retry_after from public.scheduled_tasks where id=$1", [
        created.id,
      ])
    ).rows[0];
    assert.equal(retry.status, "scheduled");
    assert.ok(retry.retry_after);
    await db.query(
      "update public.scheduled_tasks set retry_after=null,execution_attempts=3 where id=$1",
      [created.id],
    );
    const terminal = await claim(db, created.id);
    await begin(db, terminal);
    await db.query(
      "update public.scheduled_tasks set lease_expires_at=now()-interval '1 second' where id=$1",
      [created.id],
    );
    assert.equal(
      (await db.query("select public.recover_expired_scheduled_task_leases() n")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select public.recover_expired_scheduled_task_leases() n")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select status from public.scheduled_tasks where id=$1", [created.id]))
        .rows[0].status,
      "failed",
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.app_notifications")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("events before task consent or from an unregistered source cannot start new work", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const linked = await gmailGrant(db);
    const payload = {
      title: "Events",
      prompt: "Summarize",
      repeat: "none",
      triggerMode: "event",
      timezone: "UTC",
      eventTriggers: [{ provider: "gmail", grantId: linked.grant, resource: "inbox" }],
    };
    await db.exec("update public.test_event_readiness set enabled=false");
    await assert.rejects(mutate(db, "create", payload), /events_unavailable/);
    await db.exec("update public.test_event_readiness set enabled=true");
    const created = await mutate(db, "create", payload);
    const admit = async (event) =>
      (
        await db.query("select public.admit_scheduled_task_event($1,$2,$3) n", [
          linked.grant,
          randomUUID(),
          JSON.stringify(event),
        ])
      ).rows[0].n;
    assert.equal(
      await admit({ resource: "inbox", occurredAt: new Date(Date.now() - 10000).toISOString() }),
      0,
    );
    await assert.rejects(admit({ resource: "inbox" }), /event_invalid/);
    assert.equal(
      await admit({ resource: "inbox", occurredAt: new Date(Date.now() + 1000).toISOString() }),
      1,
    );
    const run = await claim(db, created.id);
    await begin(db, run);
    await db.exec("update public.test_event_readiness set enabled=false");
    await assert.rejects(
      db.query("select public.scheduled_task_check_execution($1,'worker')", [created.id]),
      /events_unavailable/,
    );
  } finally {
    await db.close();
  }
});

test("Lockdown and malformed settings invalidate existing background connection grants immediately", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const linked = await gmailGrant(db);
    for (const settings of [{ lockdown_mode: true }, "invalid-settings"]) {
      await db.query(
        "insert into public.user_preferences values($1,$2) on conflict(user_id) do update set settings=excluded.settings",
        [owner, JSON.stringify(settings)],
      );
      assert.equal(
        (
          await db.query("select public.validate_scheduled_task_connection_grant($1,$2) ready", [
            owner,
            linked.grant,
          ])
        ).rows[0].ready,
        false,
      );
    }
  } finally {
    await db.close();
  }
});

test("pending copy capacity is enforced inside account locks while completed retries remain idempotent", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const created = await mutate(db, "create", createPayload());
    const firstId = randomUUID();
    let first;
    for (let index = 0; index < 20; index++) {
      const row = await mutate(
        db,
        "shareCopy",
        { email: "other@example.com" },
        { id: created.id, revision: index + 1, mutationId: index === 0 ? firstId : randomUUID() },
      );
      if (index === 0) first = row;
    }
    await assert.rejects(
      mutate(db, "shareCopy", { email: "other@example.com" }, { id: created.id, revision: 21 }),
      /copy_capacity/,
    );
    assert.deepEqual(
      await mutate(
        db,
        "shareCopy",
        { email: "other@example.com" },
        { id: created.id, revision: 1, mutationId: firstId },
      ),
      first,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.scheduled_task_copy_offers where state='pending'",
        )
      ).rows[0].n,
      20,
    );
  } finally {
    await db.close();
  }
});

test("Tasks export includes both copy sides and safe grant/event metadata without portable authority or raw callback fields", async () => {
  const db = await fixture();
  try {
    await activate(db);
    const linked = await gmailGrant(db);
    const created = await mutate(db, "create", createPayload());
    await mutate(db, "shareCopy", { email: "other@example.com" }, { id: created.id });
    await db.query(
      "insert into public.scheduled_task_events(task_id,user_id,grant_id,event_key,event_data) values($1,$2,$3,'private-delivery-key',$4)",
      [
        created.id,
        owner,
        linked.grant,
        JSON.stringify({
          title: "User-owned content",
          text: "Exportable task source",
          resource: "inbox",
          authorization: "secret-fixture",
        }),
      ],
    );
    const own = (
      await db.query(
        "select * from public.scheduled_task_account_export where user_id=$1 order by id",
        [owner],
      )
    ).rows;
    const received = (
      await db.query(
        "select * from public.scheduled_task_account_export where user_id=$1 order by id",
        [other],
      )
    ).rows;
    assert.equal(own.length, 3);
    assert.equal(received.length, 1);
    assert.equal(received[0].data.direction, "received");
    const serialized = JSON.stringify(own);
    assert.match(serialized, /Exportable task source/);
    assert.doesNotMatch(
      serialized,
      /secret-fixture|private-delivery-key|connection_generation|provider_account_id/,
    );
    assert.ok(!serialized.includes(linked.generation));
    assert.ok(!serialized.includes(linked.connection));
    assert.ok(!serialized.includes(linked.grant));
    assert.equal(new Set(own.map((row) => row.id)).size, own.length);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select * from public.scheduled_task_account_export"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("native event readiness gates the real foundation before create and again after claim", async () => {
  const db = await fixture();
  try {
    await db.exec("reset role;drop function public.scheduled_task_event_grant_ready(uuid)");
    await db.exec(sql("20260905013636_scheduled_task_verified_event_ingress.sql"));
    await db.exec("set role service_role");
    await activate(db);
    const linked = await gmailGrant(db);
    const payload = {
      title: "Native Gmail",
      prompt: "Summarize new message",
      repeat: "none",
      triggerMode: "event",
      timezone: "UTC",
      eventTriggers: [{ provider: "gmail", grantId: linked.grant, resource: "inbox" }],
    };
    await assert.rejects(mutate(db, "create", payload), /events_unavailable/);
    await db.query(
      "insert into public.scheduled_task_event_provider_readiness(provider,active_config,verified_config,heartbeat_at,verified_at) values('gmail',$1,$1,now(),now())",
      ["a".repeat(64)],
    );
    await db.query(
      "insert into public.scheduled_task_gmail_cursors(grant_id,user_id,email,history_id,watch_consent,watch_expires_at) values($1,$2,'owner@example.com','1',true,now()+interval '1 day')",
      [linked.grant, owner],
    );
    const created = await mutate(db, "create", payload);
    await db.query("select public.admit_scheduled_task_event($1,'native-message',$2)", [
      linked.grant,
      JSON.stringify({
        resource: "inbox",
        occurredAt: new Date(Date.now() + 50).toISOString(),
        title: "New message",
      }),
    ]);
    const claimed = await claim(db, created.id);
    await db.query("select public.scheduled_task_event_ingress_rpc('source_disable',$1)", [
      JSON.stringify({ userId: owner, grantId: linked.grant, expectedRevision: 1 }),
    ]);
    const task = (
      await db.query("select next_run_at from public.scheduled_tasks where id=$1", [created.id])
    ).rows[0];
    await assert.rejects(
      db.query("select public.begin_scheduled_task_run($1,'worker',$2,$3)", [
        created.id,
        task.next_run_at,
        "run",
      ]),
      /events_unavailable/,
    );
    assert.equal(
      (await db.query("select has_table_privilege('service_role','auth.users','SELECT') ok"))
        .rows[0].ok,
      false,
    );
  } finally {
    await db.close();
  }
});
