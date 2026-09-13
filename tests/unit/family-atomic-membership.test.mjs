import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const token = "a".repeat(48);
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, is_anonymous boolean default false);
    create table public.account_deletion_fences(user_id uuid primary key);
    insert into auth.users(id,email,email_confirmed_at) values ('${owner}','owner@example.test',now()),('${member}','member@example.test',now()),('${outsider}','outsider@example.test',now());
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
  const old = await readFile(
    new URL(
      "../../supabase/migrations/20260702163905_0663df95-a332-4ab8-959a-e802db899983.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(old.slice(old.indexOf("-- 2. Family Sharing tables")));
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260905001217_family_atomic_membership.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    "grant usage on schema auth to service_role; grant select on public.account_deletion_fences to service_role",
  );
  return db;
}
const create = async (db, user = owner) =>
  (await db.query("select public.create_or_repair_family_group($1,'Family') id", [user])).rows[0]
    .id;
const accept = async (db, user = member) =>
  (await db.query("select public.accept_family_invite_atomic($1,$2) id", [user, token])).rows[0].id;
async function invite(db, group, email = null) {
  await db.query(
    "insert into family_invites(group_id,token,invited_email,created_by) values($1,$2,$3,$4)",
    [group, token, email, owner],
  );
}

test("family creation is atomic, idempotent, and repairs an existing owner membership", async () => {
  const db = await fixture();
  try {
    const group = await create(db);
    assert.equal(await create(db), group);
    await db.query("delete from family_members where user_id=$1", [owner]);
    assert.equal(await create(db), group);
    assert.deepEqual((await db.query("select group_id,user_id,role from family_members")).rows, [
      { group_id: group, user_id: owner, role: "owner" },
    ]);
  } finally {
    await db.close();
  }
});
test("failed owner membership rolls back the new group and a retry succeeds", async () => {
  const db = await fixture();
  try {
    await db.exec(
      "create function reject_family_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture_membership_failure'; end; $$; create trigger reject_family_fixture before insert on family_members for each row execute function reject_family_fixture()",
    );
    await assert.rejects(() => create(db), /fixture_membership_failure/u);
    assert.equal((await db.query("select count(*)::int n from family_groups")).rows[0].n, 0);
    await db.exec("drop trigger reject_family_fixture on family_members");
    assert.equal(typeof (await create(db)), "string");
  } finally {
    await db.close();
  }
});
test("an existing foreign membership cannot create an owner group", async () => {
  const db = await fixture();
  try {
    const group = await create(db);
    await invite(db, group);
    await accept(db);
    await assert.rejects(() => create(db, member), /already_in_family/u);
    assert.equal((await db.query("select count(*)::int n from family_groups")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
test("invite redemption is atomic when its final receipt update fails", async () => {
  const db = await fixture();
  try {
    const group = await create(db);
    await invite(db, group);
    await db.exec(
      "create function reject_invite_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture_receipt_failure'; end; $$; create trigger reject_invite_fixture before update on family_invites for each row execute function reject_invite_fixture()",
    );
    await assert.rejects(() => accept(db), /fixture_receipt_failure/u);
    assert.equal((await db.query("select count(*)::int n from family_members")).rows[0].n, 1);
    assert.equal(
      (await db.query("select accepted_at from family_invites")).rows[0].accepted_at,
      null,
    );
    await db.exec("drop trigger reject_invite_fixture on family_invites");
    assert.equal(await accept(db), group);
    assert.equal(await accept(db), group);
    await assert.rejects(() => accept(db, outsider), /family_invite_used/u);
  } finally {
    await db.close();
  }
});
test("targeted invitations require the exact verified email and survive a rejected attempt", async () => {
  const db = await fixture();
  try {
    const group = await create(db);
    await invite(db, group, " Member@example.test ");
    await assert.rejects(() => accept(db, outsider), /family_invite_recipient_mismatch/u);
    await db.query("update auth.users set email_confirmed_at=null where id=$1", [member]);
    await assert.rejects(() => accept(db), /family_invite_recipient_mismatch/u);
    await db.query("update auth.users set email_confirmed_at=now() where id=$1", [member]);
    assert.equal(await accept(db), group);
  } finally {
    await db.close();
  }
});
test("cap rejection preserves the unconsumed invitation and a later vacancy can retry", async () => {
  const db = await fixture();
  try {
    const group = await create(db);
    await invite(db, group);
    for (let i = 4; i < 9; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      await db.query("insert into auth.users(id) values($1)", [id]);
      await db.query("insert into family_members(group_id,user_id,role) values($1,$2,'member')", [
        group,
        id,
      ]);
    }
    await assert.rejects(() => accept(db), /family_group_full/u);
    assert.equal(
      (await db.query("select accepted_at from family_invites")).rows[0].accepted_at,
      null,
    );
    await db.exec(
      "delete from family_members where user_id='00000000-0000-4000-8000-000000000004'",
    );
    assert.equal(await accept(db), group);
  } finally {
    await db.close();
  }
});
test("account deletion fences block both family creation and invitation acceptance", async () => {
  const db = await fixture();
  try {
    const group = await create(db);
    await invite(db, group);
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(() => create(db), /account_deletion_pending/u);
    await assert.rejects(() => accept(db), /account_deletion_pending/u);
  } finally {
    await db.close();
  }
});
test("client roles cannot bypass atomic membership or call service-only mutation RPCs", async () => {
  const db = await fixture();
  try {
    const group = await create(db);
    await invite(db, group);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${member}',false)`,
    );
    await assert.rejects(() => accept(db), /permission denied/u);
    await assert.rejects(() => create(db, member), /permission denied/u);
    await assert.rejects(
      () =>
        db.query("insert into family_members(group_id,user_id,role) values($1,$2,'member')", [
          group,
          member,
        ]),
      /permission denied/u,
    );
    await db.exec("reset role; set role service_role");
    assert.equal(await accept(db), group);
  } finally {
    await db.close();
  }
});
test("expired and revoked invites cannot be redeemed", async () => {
  const db = await fixture();
  try {
    const group = await create(db);
    await invite(db, group);
    await db.exec("update family_invites set expires_at=now()-interval '1 second'");
    await assert.rejects(() => accept(db), /family_invite_expired/u);
    await db.exec("delete from family_invites");
    await assert.rejects(() => accept(db), /invalid_family_invite/u);
  } finally {
    await db.close();
  }
});

test("private identity helpers expose no Auth grant and reject unverified or inactive recipients", async () => {
  const db = await fixture();
  try {
    const lookup = () =>
      db.query("select kova_private.verified_auth_user_for_email('member@example.test') id");
    await db.exec("set role service_role");
    assert.equal(
      (await db.query("select has_table_privilege(current_user,'auth.users','SELECT') allowed"))
        .rows[0].allowed,
      false,
    );
    assert.equal((await lookup()).rows[0].id, member);
    await db.exec("reset role");
    for (const field of [
      "banned_until=now()+interval '1 day'",
      "deleted_at=now()",
      "is_anonymous=true",
      "email_confirmed_at=null",
    ]) {
      await db.query(
        "update auth.users set banned_until=null,deleted_at=null,is_anonymous=false,email_confirmed_at=now() where id=$1",
        [member],
      );
      await db.query(`update auth.users set ${field} where id=$1`, [member]);
      assert.equal((await lookup()).rows[0].id, null);
    }
    await db.exec("set role authenticated");
    await assert.rejects(() => lookup(), /permission denied/u);
  } finally {
    await db.close();
  }
});
