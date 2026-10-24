import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  authDatabase,
  livePasswordAccount,
  liveEnableMfa,
  owner,
  other,
} from "../helpers/kova-auth-database.mjs";

const migration = await readFile(
  "supabase/migrations/20261020183948_account_email_notifications.sql",
  "utf8",
);
const allEnabledDefaults = await readFile(
  "supabase/migrations/20261020195253_account_email_all_enabled_defaults.sql",
  "utf8",
);
const defaults = {
  password_changed: true,
  security_method_added: true,
  security_method_changed: true,
  security_method_removed: true,
  account_deletion_scheduled: true,
  account_deleted: true,
  new_login: true,
  email_changed: true,
  account_recovered: true,
};
const prior = () => new Date(Date.now() - 60_000).toISOString();
async function fixture({ upgradeDefaults = true } = {}) {
  const db = await authDatabase();
  await db.exec(migration);
  if (upgradeDefaults) await db.exec(allEnabledDefaults);
  await livePasswordAccount(db);
  return db;
}
async function preferences(db, id = owner) {
  return (await db.query("select public.account_email_get_preferences($1) as value", [id])).rows[0]
    .value;
}
async function update(db, patch, id = owner) {
  return (
    await db.query("select public.account_email_update_preferences($1,$2::jsonb) as value", [
      id,
      JSON.stringify(patch),
    ])
  ).rows[0].value;
}
async function audit(db, event = "password_changed", outcome = "success", id = owner) {
  await db.query("select kova_private.audit($1,null,$2,$3,$4::jsonb)", [
    id,
    event,
    outcome,
    JSON.stringify({ neverCopy: "fixture@example.test", password: "must not enter email" }),
  ]);
  return (await db.query("select * from kova_private.account_email_events order by occurred_at,id"))
    .rows;
}
async function claim(db, id, notBefore = prior()) {
  return (
    await db.query("select * from public.account_email_claim_dispatch($1,$2)", [[id], notBefore])
  ).rows;
}
async function prepare(db, row) {
  return (
    await db.query("select public.account_email_prepare_dispatch($1,$2) as value", [
      row.id,
      row.lease_token,
    ])
  ).rows[0].value;
}

test("all-enabled forward defaults preserve saved opt-outs and leave fresh accounts enabled", async () => {
  const db = await fixture({ upgradeDefaults: false });
  try {
    await update(db, { new_login: false, password_changed: false });
    await db.exec(allEnabledDefaults);
    const saved = await preferences(db);
    assert.equal(saved.new_login, false);
    assert.equal(saved.password_changed, false);
    // Removing fixture-only preferences represents a fresh account's fallback.
    await db.query("delete from kova_private.account_email_preferences where account_id=$1", [
      owner,
    ]);
    assert.deepEqual(await preferences(db), defaults);
  } finally {
    await db.close();
  }
});

test("account preferences default exactly, merge independent edits and reject unknown or unverified input", async () => {
  const db = await fixture();
  try {
    assert.deepEqual(await preferences(db), defaults);
    await update(db, { password_changed: false });
    const result = await update(db, { new_login: false });
    assert.equal(result.password_changed, false);
    assert.equal(result.new_login, false);
    assert.equal(result.account_deleted, true);
    for (const patch of [{}, { unknown: true }, { new_login: "true" }, [], null]) {
      await assert.rejects(update(db, patch), /account_email_preferences_invalid/);
    }
    await assert.rejects(preferences(db, other), /account_email_account_unavailable/);
    await db.exec("set role authenticated");
    await assert.rejects(preferences(db), /permission denied/);
    await assert.rejects(
      db.query("select * from kova_private.account_email_preferences"),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.equal(await preferences(db).then((x) => x.password_changed), false);
  } finally {
    await db.close();
  }
});

test("successful real MFA mutation queues a default notice atomically; rejected and disabled events do not", async () => {
  const db = await fixture();
  try {
    await liveEnableMfa(db);
    let rows = (await db.query("select * from kova_private.account_email_events")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, "security_method_added");
    assert.deepEqual(rows[0].metadata, {});
    await update(db, { new_login: false });
    await audit(db, "password_changed", "rejected");
    await audit(db, "password_login");
    rows = (await db.query("select * from kova_private.account_email_events")).rows;
    assert.equal(rows.length, 1);
    await update(db, { password_changed: false, new_login: true });
    await audit(db);
    rows = await audit(db, "password_login");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.find((x) => x.event_type === "new_login").metadata, {});
    const before = rows.length;
    await db.exec("begin");
    await audit(db, "passkey_registered");
    await db.exec("rollback");
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.account_email_events")).rows[0].n,
      before,
    );
  } finally {
    await db.close();
  }
});

test("claim is exact and one-use; prepare rechecks current opt-out and redacts a suppressed recipient", async () => {
  const db = await fixture();
  try {
    const event = (await audit(db))[0];
    const [leased] = await claim(db, event.id);
    assert.equal(leased.id, event.id);
    assert.ok(new Date(leased.lease_expires_at).getTime() > Date.now());
    assert.deepEqual(await claim(db, event.id), []);
    assert.equal(await prepare(db, { ...leased, lease_token: randomUUID() }), false);
    await update(db, { password_changed: false });
    assert.equal(await prepare(db, leased), false);
    const row = (
      await db.query("select * from kova_private.account_email_events where id=$1", [event.id])
    ).rows[0];
    assert.equal(row.status, "suppressed");
    assert.equal(row.recipient, null);
    await assert.rejects(
      claim(db, event.id, new Date(Date.now() - 3600_000).toISOString()),
      /account_email_dispatch_scope_invalid/,
    );
    await assert.rejects(
      db.query("select * from public.account_email_claim_dispatch($1,$2)", [
        Array(6).fill(event.id),
        prior(),
      ]),
      /account_email_dispatch_scope_invalid/,
    );
  } finally {
    await db.close();
  }
});

test("confirmed send is terminal and recipient-free; changed recipient and expired leases never send", async () => {
  const db = await fixture();
  try {
    const [first] = await audit(db);
    const [lease] = await claim(db, first.id);
    assert.equal(await prepare(db, lease), true);
    assert.equal(
      (
        await db.query("select public.account_email_finish_dispatch($1,$2,'sent') as value", [
          lease.id,
          lease.lease_token,
        ])
      ).rows[0].value,
      true,
    );
    assert.deepEqual(await claim(db, first.id), []);
    let row = (
      await db.query("select * from kova_private.account_email_events where id=$1", [first.id])
    ).rows[0];
    assert.equal(row.status, "sent");
    assert.equal(row.recipient, null);
    const second = (await audit(db)).find((x) => x.id !== first.id);
    const [secondLease] = await claim(db, second.id);
    await db.query(
      "update kova_private.auth_accounts set primary_email='changed@example.test' where id=$1",
      [owner],
    );
    assert.equal(await prepare(db, secondLease), false);
    const third = (await audit(db)).find((x) => ![first.id, second.id].includes(x.id));
    const [thirdLease] = await claim(db, third.id);
    await db.query(
      "update kova_private.account_email_events set lease_until=statement_timestamp()-interval '1 second' where id=$1",
      [third.id],
    );
    assert.equal(await prepare(db, thirdLease), false);
    await db.query("select public.account_email_purge_expired(100)");
    row = (
      await db.query("select * from kova_private.account_email_events where id=$1", [third.id])
    ).rows[0];
    assert.equal(row.status, "uncertain");
    assert.equal(row.recipient, null);
    assert.deepEqual(await claim(db, third.id), []);
    const fourth = (await audit(db)).find((x) => ![first.id, second.id, third.id].includes(x.id));
    const [fourthLease] = await claim(db, fourth.id);
    assert.equal(
      (
        await db.query("select public.account_email_finish_dispatch($1,$2,'sent') as value", [
          fourth.id,
          fourthLease.lease_token,
        ])
      ).rows[0].value,
      false,
    );
    assert.equal(
      (
        await db.query("select public.account_email_finish_dispatch($1,$2,'failed') as value", [
          fourth.id,
          fourthLease.lease_token,
        ])
      ).rows[0].value,
      true,
    );
    assert.equal(
      (
        await db.query("select recipient from kova_private.account_email_events where id=$1", [
          fourth.id,
        ])
      ).rows[0].recipient,
      null,
    );
  } finally {
    await db.close();
  }
});

test("explicit lifecycle records are deduped, preference-gated and never accept recipients or fake final deletion", async () => {
  const db = await fixture();
  try {
    const now = new Date().toISOString();
    const until = new Date(Date.now() + 30 * 86400_000).toISOString();
    const args = [
      owner,
      "account_deletion_scheduled",
      "stable-transition",
      now,
      JSON.stringify({ deletion_scheduled_for: until }),
    ];
    const sql = "select public.account_email_record_lifecycle($1,$2,$3,$4,$5::jsonb) as value";
    const a = (await db.query(sql, args)).rows[0].value;
    const b = (await db.query(sql, args)).rows[0].value;
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9-]{36}$/);
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.account_email_events")).rows[0].n,
      1,
    );
    await update(db, { account_recovered: false });
    assert.equal(
      (await db.query(sql, [owner, "account_recovered", "recovered", now, "{}"])).rows[0].value,
      null,
    );
    await assert.rejects(
      db.query(sql, [owner, "account_deleted", "fake", now, "{}"]),
      /account_email_lifecycle_invalid/,
    );
    await assert.rejects(
      db.query(sql, [owner, "account_recovered", "bad", now, '{"recipient":"other@example.test"}']),
      /account_email_lifecycle_invalid/,
    );
  } finally {
    await db.close();
  }
});

test("final deletion requires preparation and actual committed deletion; owned bridges cannot emit final mail", async () => {
  const db = await fixture();
  try {
    assert.equal(
      (
        await db.query("select public.account_email_prepare_account_deletion($1,$2) as value", [
          owner,
          randomUUID(),
        ])
      ).rows[0].value,
      true,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.account_email_events where account_id=$1",
          [owner],
        )
      ).rows[0].n,
      0,
    );
    await update(db, { password_changed: false });
    const [ownedNotice] = await audit(db, "passkey_renamed");
    assert.equal(ownedNotice.status, "pending");
    // Model an owned principal that survives disposal of its now-inert hosted
    // bridge; the historical linked-principal FK otherwise cascades deletion.
    await db.query(
      "update kova_private.auth_accounts set legacy_supabase_user_id=null where id=$1",
      [owner],
    );
    await db.query("delete from auth.users where id=$1", [owner]);
    assert.equal((await preferences(db)).password_changed, false);
    const survivingNotice = (
      await db.query("select * from kova_private.account_email_events where id=$1", [
        ownedNotice.id,
      ])
    ).rows[0];
    assert.equal(survivingNotice.status, "pending");
    assert.equal(survivingNotice.recipient, ownedNotice.recipient);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.account_email_events where account_id=$1 and event_type='account_deleted'",
          [owner],
        )
      ).rows[0].n,
      0,
    );
    const unverified = randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'unverified@example.test')", [
      unverified,
    ]);
    assert.equal(
      (
        await db.query("select public.account_email_prepare_account_deletion($1,$2) as value", [
          unverified,
          randomUUID(),
        ])
      ).rows[0].value,
      true,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.account_email_events where account_id=$1",
          [unverified],
        )
      ).rows[0].n,
      0,
    );
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'hosted@example.test',statement_timestamp())",
      [other],
    );
    assert.equal(
      (
        await db.query("select public.account_email_prepare_account_deletion($1,$2) as value", [
          other,
          randomUUID(),
        ])
      ).rows[0].value,
      true,
    );
    const pending = (
      await db.query("select * from kova_private.account_email_events where account_id=$1", [other])
    ).rows[0];
    assert.equal(pending.status, "awaiting_deletion");
    assert.deepEqual(await claim(db, pending.id), []);
    await db.exec("begin");
    await db.query("delete from auth.users where id=$1", [other]);
    await db.exec("rollback");
    assert.equal(
      (
        await db.query("select status from kova_private.account_email_events where id=$1", [
          pending.id,
        ])
      ).rows[0].status,
      "awaiting_deletion",
    );
    await db.query("delete from auth.users where id=$1", [other]);
    const [leased] = await claim(db, pending.id);
    assert.equal(leased.event_type, "account_deleted");
    assert.equal(await prepare(db, leased), true);
    // Cleanup of an unused hosted UUID has no prepared finalization marker.
    const unused = randomUUID();
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'unused@example.test',statement_timestamp())",
      [unused],
    );
    await db.query("delete from auth.users where id=$1", [unused]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.account_email_events where account_id=$1",
          [unused],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("disabling every optional event leaves the requested recovery action on its existing queue", async () => {
  const db = await fixture();
  try {
    await update(db, Object.fromEntries(Object.keys(defaults).map((key) => [key, false])));
    const email = `${owner}@example.invalid`;
    const payload = { label: "kova-auth-recovery", marker: "requested-action-fixture" };
    const created = await db.query(
      "select public.kova_auth_create_recovery($1,$2,$3,$4::jsonb) as value",
      [
        email,
        "a".repeat(64),
        new Date(Date.now() + 3600_000).toISOString(),
        JSON.stringify(payload),
      ],
    );
    assert.equal(created.rows[0].value, true);
    const messages = await db.query(
      "select payload from public.test_email_queue where payload->>'marker'='requested-action-fixture'",
    );
    assert.deepEqual(
      messages.rows.map((row) => row.payload),
      [payload],
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.account_email_events")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
