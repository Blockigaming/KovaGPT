import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260905023630_pwa_push_subscription_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  configId = "a".repeat(64),
  deviceHash = "b".repeat(64);
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;grant usage on schema kova_private to service_role;
 create table auth.users(id uuid primary key,deleted_at timestamptz,email_confirmed_at timestamptz default now(),is_anonymous boolean default false,banned_until timestamptz);
 insert into auth.users(id) values('${owner}'),('${other}');
 create table public.account_deletion_fences(user_id uuid);create table public.banned_users(user_id uuid);create table public.user_preferences(user_id uuid primary key,settings jsonb);
 create table public.notification_preferences(user_id uuid primary key,in_app_enabled boolean,categories jsonb);
 create table public.app_notifications(id uuid primary key default gen_random_uuid(),owner_id uuid references auth.users on delete cascade,type text default 'task_result',delivery_state text default 'delivered',created_at timestamptz default now(),read_at timestamptz,expires_at timestamptz);
 create table public.agent_notifications(id uuid primary key default gen_random_uuid(),owner_id uuid references auth.users on delete cascade,created_at timestamptz default now(),read_at timestamptz,expires_at timestamptz default now()+interval '1 day');
 grant all on all tables in schema public to service_role;`);
  await db.exec(migration);
  const rpc = async (op, data = {}, user = owner) => {
    await db.exec("set role service_role");
    try {
      return (
        await db.query("select public.web_push_rpc($1,$2,$3::jsonb) as value", [
          user,
          op,
          JSON.stringify({ configId, ...data }),
        ])
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const subscribe = async (user = owner, hash = "c".repeat(64)) => {
    const id = crypto.randomUUID();
    await rpc(
      "subscribe",
      {
        id,
        endpointHash: hash,
        sealed: "encrypted-subscription-only",
        deviceSecretHash: deviceHash,
      },
      user,
    );
    return id;
  };
  const event = async (user = owner, source = "application") => {
    const table = source === "application" ? "app_notifications" : "agent_notifications";
    return (await db.query(`insert into public.${table}(owner_id)values($1)returning id`, [user]))
      .rows[0].id;
  };
  const due = () =>
    db.exec("update public.web_push_subscriptions set next_attempt_at=now()-interval '1 second'");
  return { db, rpc, subscribe, event, due };
}
test("push requires configured runtime and current consent; credentials and RPC are service-only", async () => {
  const { db, rpc, subscribe } = await fixture();
  try {
    assert.equal((await rpc("status")).ready, false);
    await assert.rejects(subscribe(), /runtime_unavailable/);
    await rpc("heartbeat");
    const id = await subscribe();
    const status = await rpc("status");
    assert.equal(status.ready, true);
    assert.equal(status.devices[0].id, id);
    assert.equal((await rpc("status", {}, other)).devices.length, 0);
    assert.doesNotMatch(JSON.stringify(status), /encrypted-subscription|endpoint|deviceSecret/);
    await assert.rejects(subscribe(other), /duplicate key/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from web_push_subscriptions"), /permission denied/);
    await assert.rejects(
      db.query("select web_push_rpc(null,'heartbeat','{}')"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(rpc("status"), /account_unavailable/);
    await assert.rejects(subscribe(owner, "d".repeat(64)), /account_unavailable/);
    await rpc("revoke", { id, expectedRevision: 1 });
    assert.equal(
      (await db.query("select sealed_subscription from web_push_subscriptions")).rows[0]
        .sealed_subscription,
      null,
    );
  } finally {
    await db.close();
  }
});
test("leases deliver only current unread owner events and preserve cursor on retry before ordered settlement", async () => {
  const { db, rpc, subscribe, event, due } = await fixture();
  try {
    await rpc("heartbeat");
    const beforeConsent = await event();
    const id = await subscribe();
    await event(other);
    const first = await event();
    const second = await event(owner, "agent");
    // Database clocks can tie under the parallel aggregate. Pin the intended
    // chronology explicitly; insertion order is not the delivery contract.
    const clock = new Date().toISOString();
    await db.query(
      "update web_push_subscriptions set consented_at=$2::timestamptz-interval '3 seconds',cursor_at=$2::timestamptz-interval '3 seconds' where id=$1",
      [id, clock],
    );
    await db.query(
      "update app_notifications set created_at=$2::timestamptz-interval '4 seconds' where id=$1",
      [beforeConsent, clock],
    );
    await db.query(
      "update app_notifications set created_at=$2::timestamptz-interval '2 seconds' where id=$1",
      [first, clock],
    );
    await db.query(
      "update agent_notifications set created_at=$2::timestamptz-interval '1 second' where id=$1",
      [second, clock],
    );
    const workerId = crypto.randomUUID(),
      claimed = await rpc("claim", { workerId });
    assert.equal(claimed.id, id);
    const args = { id, workerId, revision: 1 };
    assert.equal(await rpc("claim", { workerId: crypto.randomUUID() }), null);
    assert.equal((await rpc("check", args)).eligible, true);
    assert.equal(
      (await db.query("select event_id from web_push_subscriptions")).rows[0].event_id,
      first,
    );
    await assert.rejects(
      rpc("settle", { ...args, workerId: crypto.randomUUID(), result: "sent" }),
      /subscription_changed/,
    );
    await rpc("settle", { ...args, result: "retry" });
    await due();
    await rpc("claim", { workerId });
    assert.equal(
      (await db.query("select event_id from web_push_subscriptions")).rows[0].event_id,
      first,
    );
    await db.query("update app_notifications set read_at=now() where id=$1", [first]);
    assert.equal((await rpc("check", args)).eligible, false);
    await rpc("settle", { ...args, result: "skip" });
    await due();
    await rpc("claim", { workerId });
    assert.equal(
      (await db.query("select event_id from web_push_subscriptions")).rows[0].event_id,
      second,
    );
    await rpc("settle", { ...args, result: "sent" });
    await due();
    assert.deepEqual(await rpc("claim", { workerId }), { skipped: true });
  } finally {
    await db.close();
  }
});
test("revocation, account deletion and Lockdown invalidate an already claimed delivery", async () => {
  const { db, rpc, subscribe, event, due } = await fixture();
  try {
    await rpc("heartbeat");
    const id = await subscribe();
    await event();
    const workerId = crypto.randomUUID();
    await rpc("claim", { workerId });
    const args = { id, workerId, revision: 1 };
    await db.query("insert into user_preferences values($1,$2)", [owner, { lockdown_mode: true }]);
    await assert.rejects(rpc("check", args), /account_unavailable/);
    assert.equal((await rpc("status")).devices.length, 1);
    await db.query("update user_preferences set settings=$2 where user_id=$1", [
      owner,
      { lockdown_mode: "malformed" },
    ]);
    await assert.rejects(rpc("check", args), /account_unavailable/);
    await db.query("delete from user_preferences where user_id=$1", [owner]);
    await rpc("revoke_device", { id, deviceSecretHash: "e".repeat(64) }, null);
    assert.equal((await rpc("check", args)).eligible, true);
    await rpc("revoke_device", { id, deviceSecretHash: deviceHash }, null);
    await assert.rejects(rpc("check", args), /subscription_changed/);
    await assert.rejects(rpc("revoke", { id, expectedRevision: 1 }), /subscription_changed/);
    const next = await subscribe();
    await event();
    await due();
    await rpc("claim", { workerId });
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(rpc("check", { ...args, id: next }), /account_unavailable/);
    await db.query("delete from auth.users where id=$1", [owner]);
    assert.equal(
      (await db.query("select count(*)::int as n from web_push_subscriptions")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("quiet-hour preferences compare revisions, categories recheck before send, and expired endpoints are removed", async () => {
  const { db, rpc, subscribe, event } = await fixture();
  try {
    await rpc("heartbeat");
    const id = await subscribe();
    await event();
    const workerId = crypto.randomUUID();
    await rpc("claim", { workerId });
    const args = { id, workerId, revision: 1 };
    const quietHours = { start: "22:00", end: "07:00", timeZone: "America/New_York" };
    await rpc("preferences", { expectedRevision: 0, quietHours });
    assert.deepEqual((await rpc("check", args)).quietHours, quietHours);
    await assert.rejects(
      rpc("preferences", { expectedRevision: 0, quietHours: null }),
      /preferences_changed/,
    );
    await assert.rejects(
      rpc("preferences", {
        expectedRevision: 1,
        quietHours: { ...quietHours, timeZone: "Invalid/Zone" },
      }),
      /quiet_hours_invalid/,
    );
    await db.query("insert into notification_preferences values($1,true,$2)", [
      owner,
      { tasks: false },
    ]);
    assert.deepEqual(await rpc("check", args), { eligible: false, skip: true });
    await rpc("settle", { ...args, result: "expired" });
    assert.equal((await rpc("status")).devices.length, 0);
    assert.equal(
      (await db.query("select sealed_subscription from web_push_subscriptions")).rows[0]
        .sealed_subscription,
      null,
    );
  } finally {
    await db.close();
  }
});
