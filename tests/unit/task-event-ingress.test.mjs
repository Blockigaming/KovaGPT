import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createTaskEventRuntime } from "../../src/lib/task-event-runtime.server.mjs";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260905013636_scheduled_task_verified_event_ingress.sql",
    import.meta.url,
  ),
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  grantId = "33333333-3333-4333-8333-333333333333";
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;grant usage on schema kova_private to service_role;
 create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');
 create table public.account_deletion_fences(user_id uuid);grant select on public.account_deletion_fences to service_role;
 create function kova_private.lock_scheduled_task_account(uid uuid)returns void language plpgsql security definer as $$begin perform pg_advisory_xact_lock(hashtextextended(uid::text,20260903204500));if uid is null or exists(select 1 from public.account_deletion_fences where user_id=uid) or not exists(select 1 from auth.users where id=uid)then raise exception 'account_fenced';end if;end$$;
 create function public.effective_user_plan_tier(uid uuid)returns text language sql as $$select 'plus'::text$$;
 create table public.scheduled_task_runtime(id boolean primary key,enabled boolean,heartbeat_at timestamptz,enabled_event_providers text[]);insert into public.scheduled_task_runtime values(true,true,now(),array['gmail','slack','github']);
 create table public.scheduled_task_connection_grants(id uuid primary key,user_id uuid references auth.users on delete cascade,provider text,connection_ref text,connection_generation text,provider_account_id text,required_scopes text[],granted_at timestamptz default now()-interval '1 hour',expires_at timestamptz default now()+interval '30 days',revoked_at timestamptz);
 create table public.scheduled_tasks(id uuid primary key,user_id uuid,trigger_mode text default 'event',status text default 'scheduled',automation_consent_at timestamptz default now()-interval '1 hour',event_triggers jsonb);
 create function public.validate_scheduled_task_connection_grant(uid uuid,gid uuid)returns boolean language sql as $$select exists(select 1 from public.scheduled_task_connection_grants where id=gid and user_id=uid and revoked_at is null and expires_at>now()) and not exists(select 1 from public.account_deletion_fences where user_id=uid)$$;
 grant all on public.scheduled_task_runtime,public.scheduled_task_connection_grants,public.scheduled_tasks to service_role;`);
  await db.exec(migration);
  const rpc = async (op, data = {}) => {
    await db.exec("set role service_role");
    try {
      return (
        await db.query("select public.scheduled_task_event_ingress_rpc($1,$2::jsonb) as value", [
          op,
          JSON.stringify(data),
        ])
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const grant = async (provider = "gmail", gid = grantId, user = owner) => {
    await db.query(
      "insert into public.scheduled_task_connection_grants(id,user_id,provider,connection_ref,connection_generation,provider_account_id,required_scopes) values($1,$2,$3,$4,$5,$6,$7)",
      [
        gid,
        user,
        provider,
        "connection-1",
        "generation-1",
        provider === "slack" ? "T12345678:U12345678" : "subject-1",
        provider === "slack" ? ["channels:history"] : ["scope"],
      ],
    );
    await db.query(
      "insert into public.scheduled_tasks(id,user_id,event_triggers)values($1,$2,$3)",
      [
        crypto.randomUUID(),
        user,
        JSON.stringify([
          {
            grantId: gid,
            provider,
            resource:
              provider === "gmail" ? "inbox" : provider === "slack" ? "C12345678" : "Owner/Repo",
          },
        ]),
      ],
    );
    return (
      await db.query("select * from public.scheduled_task_connection_grants where id=$1", [gid])
    ).rows[0];
  };
  const init = () =>
    rpc("source_init", {
      userId: owner,
      grantId,
      expectedRevision: 0,
      email: "owner@example.test",
      historyId: "100",
      watchConsent: true,
    });
  return { db, rpc, grant, init };
}
const event = (provider = "slack") => ({
  provider,
  eventKey: "a".repeat(64),
  configId: "b".repeat(64),
  scopeKey: provider === "slack" ? "T12345678" : "",
  resource: provider === "slack" ? "C12345678" : "owner/repo",
  occurredAt: new Date().toISOString(),
  reference:
    provider === "slack" ? { ts: "1788609600.000001" } : { pullNumber: 1, activity: "opened" },
});

test("service-only inbox dedupes, leases and walks each currently matched grant deterministically", async () => {
  const { db, rpc, grant } = await fixture();
  try {
    await grant("slack");
    await grant("slack", "44444444-4444-4444-8444-444444444444", other);
    assert.deepEqual(await rpc("enqueue", event()), { duplicate: false });
    assert.deepEqual(await rpc("enqueue", event()), { duplicate: true });
    const workerId = crypto.randomUUID(),
      item = await rpc("claim", { workerId });
    assert.equal(await rpc("claim", { workerId: crypto.randomUUID() }), null);
    const args = { workerId, inboxId: item.id },
      first = await rpc("target", args);
    assert.equal(first.id, grantId);
    await assert.rejects(
      rpc("advance", {
        ...args,
        workerId: crypto.randomUUID(),
        grantId,
        resource: first.trigger_resource,
      }),
      /lease_lost/,
    );
    await rpc("advance", { ...args, grantId: first.id, resource: first.trigger_resource });
    const second = await rpc("target", args);
    assert.equal(second.user_id, other);
    await rpc("advance", { ...args, grantId: second.id, resource: second.trigger_resource });
    assert.equal(await rpc("target", args), null);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from scheduled_task_event_inbox"), /permission denied/);
    await assert.rejects(
      db.query("select scheduled_task_event_ingress_rpc('claim','{}')"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
test("Gmail cursor changes are monotonic, owner bound and invalidated by disable/reset or deletion fence", async () => {
  const { db, rpc, grant, init } = await fixture();
  try {
    await grant();
    await init();
    const workerId = crypto.randomUUID(),
      cursor = await rpc("cursor_claim", { userId: owner, grantId, workerId });
    const args = {
      userId: owner,
      grantId,
      workerId,
      expectedRevision: cursor.revision,
      expectedCursorVersion: cursor.cursor_version,
    };
    assert.deepEqual(
      await rpc("cursor_claim", { userId: owner, grantId, workerId: crypto.randomUUID() }),
      { busy: true },
    );
    await assert.rejects(
      rpc("cursor_save", { ...args, userId: other, historyId: "101", pageState: {} }),
      /connection_unavailable/,
    );
    const next = await rpc("cursor_save", { ...args, historyId: "101", pageState: {} });
    assert.equal(next.revision, cursor.revision);
    assert.equal(next.cursor_version, cursor.cursor_version + 1);
    await assert.rejects(
      rpc("cursor_save", { ...args, historyId: "99", pageState: {} }),
      /conflict|invalid/,
    );
    await rpc("source_disable", { userId: owner, grantId, expectedRevision: cursor.revision });
    await assert.rejects(
      rpc("watch_saved", { ...args, expiresAt: new Date(Date.now() + 3600000).toISOString() }),
      /unavailable|conflict/,
    );
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(
      rpc("source_init", {
        userId: owner,
        grantId,
        expectedRevision: 2,
        email: "owner@example.test",
        historyId: "200",
      }),
      /fenced/,
    );
  } finally {
    await db.close();
  }
});
test("enabling Gmail watch preserves its established baseline and unfinished history page", async () => {
  const { db, rpc, grant, init } = await fixture();
  try {
    const g = await grant();
    await init();
    const workerId = crypto.randomUUID();
    const cursor = await rpc("cursor_claim", { userId: owner, grantId, workerId });
    const pageState = { ids: ["a1", "b2"], index: 1, historyId: "200", nextPageToken: "next" };
    await rpc("cursor_save", {
      userId: owner,
      grantId,
      workerId,
      expectedRevision: cursor.revision,
      expectedCursorVersion: cursor.cursor_version,
      historyId: "100",
      pageState,
    });
    const calls = [];
    const api = createTaskEventRuntime({
      rpc,
      getToken: async () => "token",
      checkCurrent: async () => {},
      admit: async () => 0,
      fetchImpl: async (url) => {
        calls.push(url);
        assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/watch");
        return Response.json({ expiration: String(Date.now() + 3600000), historyId: "999" });
      },
    });
    await api.initialize(
      g,
      {
        expectedRevision: cursor.revision,
        watch: true,
        topic: "projects/kova-test/topics/task-events",
      },
      AbortSignal.timeout(10000),
    );
    const saved = (
      await db.query("select * from scheduled_task_gmail_cursors where grant_id=$1", [grantId])
    ).rows[0];
    assert.equal(saved.history_id, "100");
    assert.deepEqual(saved.page_state, pageState);
    assert.equal(saved.revision, cursor.revision + 1);
    assert.equal(saved.watch_consent, true);
    assert.equal(calls.length, 1);
    await assert.rejects(
      rpc("cursor_save", {
        userId: owner,
        grantId,
        workerId,
        expectedRevision: cursor.revision,
        expectedCursorVersion: cursor.cursor_version + 1,
        historyId: "200",
        pageState: {},
      }),
      /conflict/,
    );
  } finally {
    await db.close();
  }
});
test("Gmail event readiness needs current native callback proof and an explicit unexpired watch", async () => {
  const { db, rpc, grant, init } = await fixture();
  try {
    await grant();
    let cursor = await init();
    const ready = async () =>
      (await db.query("select scheduled_task_event_grant_ready($1) as value", [grantId])).rows[0]
        .value;
    assert.equal(await ready(), false);
    await rpc("config_heartbeat", { provider: "gmail", configId: "a".repeat(64) });
    await rpc("config_verified", { provider: "gmail", configId: "a".repeat(64) });
    assert.equal(await ready(), false);
    const workerId = crypto.randomUUID();
    cursor = await rpc("cursor_claim", { userId: owner, grantId, workerId });
    await rpc("watch_saved", {
      userId: owner,
      grantId,
      workerId,
      expectedRevision: cursor.revision,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    assert.equal(await ready(), true);
    await rpc("config_heartbeat", { provider: "gmail", configId: "b".repeat(64) });
    assert.equal(await ready(), false);
  } finally {
    await db.close();
  }
});
test("Gmail history checkpoints survive failures without skipping messages or advancing the baseline early", async () => {
  const { db, rpc, grant, init } = await fixture();
  try {
    const g = await grant();
    await init();
    const delivered = [],
      admitted = new Set();
    let failOnce = true;
    const api = createTaskEventRuntime({
      rpc,
      getToken: async () => "token",
      checkCurrent: async () => {},
      admit: async (_grant, key) => {
        if (key === "gmail:b2" && failOnce) {
          failOnce = false;
          throw new Error("database unavailable");
        }
        admitted.add(key);
        delivered.push(key);
      },
      fetchImpl: async (url) => {
        if (url.includes("/history?"))
          return Response.json({
            historyId: "200",
            history: [{ messagesAdded: [{ message: { id: "a1" } }, { message: { id: "b2" } }] }],
          });
        const messageId = url.includes("/a1?") ? "a1" : "b2";
        return Response.json({
          id: messageId,
          internalDate: String(Date.now()),
          labelIds: ["INBOX"],
          payload: {
            headers: [
              { name: "From", value: "Sender <sender@example.test>" },
              { name: "Subject", value: "Fixture" },
            ],
          },
          snippet: "private",
        });
      },
    });
    await assert.rejects(
      api.gmail({}, g, crypto.randomUUID(), AbortSignal.timeout(10000)),
      /database unavailable/,
    );
    let cursor = (await db.query("select * from scheduled_task_gmail_cursors")).rows[0];
    assert.equal(cursor.history_id, "100");
    assert.equal(cursor.page_state.index, 1);
    assert.equal(await api.gmail({}, g, crypto.randomUUID(), AbortSignal.timeout(10000)), true);
    cursor = (await db.query("select * from scheduled_task_gmail_cursors")).rows[0];
    assert.equal(cursor.history_id, "200");
    assert.deepEqual([...admitted], ["gmail:a1", "gmail:b2"]);
    assert.deepEqual(delivered, ["gmail:a1", "gmail:b2"]);
  } finally {
    await db.close();
  }
});
test("expired Gmail history requests explicit resync and never replays a full old mailbox", async () => {
  const { db, rpc, grant, init } = await fixture();
  try {
    const g = await grant();
    await init();
    let admits = 0,
      fetches = 0;
    const api = createTaskEventRuntime({
      rpc,
      getToken: async () => "token",
      checkCurrent: async () => {},
      admit: async () => {
        admits++;
      },
      fetchImpl: async () => {
        fetches++;
        return new Response("", { status: 404 });
      },
    });
    assert.equal(await api.gmail({}, g, crypto.randomUUID(), AbortSignal.timeout(10000)), true);
    assert.equal(
      (await db.query("select state from scheduled_task_gmail_cursors")).rows[0].state,
      "resync_required",
    );
    assert.equal(admits, 0);
    assert.equal(fetches, 1);
  } finally {
    await db.close();
  }
});

test("Slack private C channels need explicit private scopes and revocation stops the next content request", async () => {
  const grant = {
    id: grantId,
    user_id: owner,
    provider: "slack",
    provider_account_id: "T12345678:U12345678",
    required_scopes: ["channels:read", "channels:history"],
    trigger_resource: "C12345678",
  };
  const item = {
    resource: "C12345678",
    scope_key: "T12345678",
    occurred_at: new Date().toISOString(),
    reference: { ts: "1788609600.000001" },
  };
  const calls = [];
  let revoked = false,
    privateChannel = true;
  const api = createTaskEventRuntime({
    rpc: async () => null,
    admit: async () => {},
    getToken: async () => "token",
    checkCurrent: async () => {
      if (revoked) throw new Error("task_connection_unavailable");
    },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("conversations.info"))
        return Response.json({
          ok: true,
          channel: { id: item.resource, is_private: privateChannel },
        });
      return Response.json({
        ok: true,
        messages: [{ ts: item.reference.ts, user: "U12345678", text: "authorized text" }],
      });
    },
  });
  await assert.rejects(api.normalize(item, grant, AbortSignal.timeout(10000)), /access_revoked/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("conversations.info"));
  const full = {
    ...grant,
    required_scopes: [...grant.required_scopes, "groups:read", "groups:history"],
  };
  assert.equal(
    (await api.normalize(item, full, AbortSignal.timeout(10000))).title,
    "authorized text",
  );
  const guarded = createTaskEventRuntime({
    rpc: async () => null,
    admit: async () => {},
    getToken: async () => "token",
    checkCurrent: async () => {
      if (revoked) throw new Error("task_connection_unavailable");
    },
    fetchImpl: async (url) => {
      assert.ok(
        url.includes("conversations.info"),
        "no later private history fetch after revocation",
      );
      revoked = true;
      return Response.json({ ok: true, channel: { id: item.resource, is_private: false } });
    },
  });
  privateChannel = false;
  await assert.rejects(
    guarded.normalize(item, grant, AbortSignal.timeout(10000)),
    /connection_unavailable/,
  );
});
