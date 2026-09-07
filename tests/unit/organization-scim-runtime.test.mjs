import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111",
  member = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333",
  org = "44444444-4444-4444-8444-444444444444",
  provider = "55555555-5555-4555-8555-555555555555",
  token = "a".repeat(64);
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;grant usage on schema auth,kova_private to authenticated,service_role;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
 create table auth.identities(id uuid primary key default gen_random_uuid(),provider_id text,provider text,user_id uuid references auth.users on delete cascade,identity_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.account_deletion_fences(user_id uuid primary key references auth.users on delete cascade);create table public.banned_users(user_id uuid);create table public.user_preferences(user_id uuid primary key,settings jsonb);
 grant all on public.account_deletion_fences,public.banned_users,public.user_preferences to service_role;
 insert into auth.users(id,email)values('${owner}','owner@example.com'),('${member}','member@example.com'),('${other}','member@example.com');`);
  for (const name of [
    "20260905001736_private_auth_identity_helpers.sql",
    "20260905001454_organization_administration_foundation.sql",
    "20260905032524_organization_scim_provisioning.sql",
  ])
    await db.exec(
      await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"),
    );
  await db.exec(`insert into organizations(id,name,created_by,policy_version)values('${org}','Fixture','${owner}','test');insert into organization_members(organization_id,user_id,role)values('${org}','${owner}','owner');
 insert into organization_domains(id,organization_id,domain,state,verified_at,verification_expires_at)values('${provider}','${org}','example.com','verified',now(),now()+interval '1 day');insert into organization_sso_connections(organization_id,domain_id,provider_id,state)values('${org}','${provider}','${provider}','configured');
 revoke all on auth.users,auth.identities from public,anon,authenticated,service_role;`);
  const service = async (sql, args) => {
    await db.exec("set role service_role");
    try {
      return (await db.query(sql, args)).rows[0]?.value;
    } finally {
      await db.exec("reset role");
    }
  };
  const admin = (op, data = {}) =>
    service("select organization_scim_admin_rpc($1,$2,$3,$4::jsonb) value", [
      owner,
      org,
      op,
      JSON.stringify(data),
    ]);
  const rpc = (op, data = {}, hash = token, organization = org) =>
    service("select organization_scim_rpc($1,$2,$3,$4::jsonb) value", [
      organization,
      hash,
      op,
      JSON.stringify(data),
    ]);
  const identity = (uid = member, subject = "subject-1", pid = provider) =>
    db.query(
      "insert into auth.identities(provider_id,provider,user_id,identity_data)values($1,$2,$3,$4)",
      [subject, `sso:${pid}`, uid, { sub: subject, email: "member@example.com" }],
    );
  const create = (externalId = "subject-1", userName = "member@example.com") =>
    rpc("create", {
      kind: "Users",
      resource: { externalId, userName, displayName: "Member", active: true },
    });
  await admin("rotate", { expectedRevision: 0, tokenHash: token });
  return { db, admin, rpc, identity, create, service };
}
test("SCIM credentials and raw Auth remain service private; same email never binds without exact provider and immutable subject", async () => {
  const { db, rpc, identity, create } = await fixture();
  try {
    await identity(other, "different-subject");
    const pending = await create();
    assert.equal(
      (await db.query("select user_id from organization_scim_users where id=$1", [pending.id]))
        .rows[0].user_id,
      null,
    );
    await db.exec("set role service_role");
    await assert.rejects(db.query("select * from auth.identities"), /permission denied/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from organization_scim_configs"), /permission denied/);
    await assert.rejects(
      db.query("select organization_scim_rpc(null,'x','authorize','{}')"),
      /permission denied/,
    );
    await db.exec("reset role");
    await assert.rejects(
      rpc("get", { kind: "Users", id: pending.id }, "b".repeat(64)),
      /unauthorized/,
    );
    await assert.rejects(
      rpc("get", { kind: "Users", id: pending.id }, token, crypto.randomUUID()),
      /unauthorized/,
    );
  } finally {
    await db.close();
  }
});
test("exact SSO subject provisions only a member; conditional offboarding and manual role override never delete the Auth account", async () => {
  const { db, rpc, identity, create } = await fixture();
  try {
    await identity();
    const user = await create();
    let membership = (
      await db.query("select * from organization_members where user_id=$1", [member])
    ).rows[0];
    assert.equal(membership.role, "member");
    assert.equal(membership.scim_user_id, user.id);
    await assert.rejects(
      rpc("replace", {
        kind: "Users",
        id: user.id,
        expectedRevision: 9,
        resource: {
          externalId: "subject-1",
          userName: "member@example.com",
          displayName: "Member",
          active: false,
        },
      }),
      /revision_changed/,
    );
    const updated = await rpc("replace", {
      kind: "Users",
      id: user.id,
      expectedRevision: 1,
      resource: {
        externalId: "subject-1",
        userName: "member@example.com",
        displayName: "Member",
        active: false,
      },
    });
    assert.equal(updated.revision, 2);
    assert.notEqual(
      (await db.query("select revoked_at from organization_members where user_id=$1", [member]))
        .rows[0].revoked_at,
      null,
    );
    assert.equal(
      (await db.query("select count(*)::int n from auth.users where id=$1", [member])).rows[0].n,
      1,
    );
    await db.query(
      "update organization_members set role='admin',revoked_at=null where user_id=$1",
      [member],
    );
    await rpc("delete", { kind: "Users", id: user.id, expectedRevision: 2 });
    membership = (await db.query("select * from organization_members where user_id=$1", [member]))
      .rows[0];
    assert.equal(membership.role, "admin");
    assert.equal(membership.revoked_at, null);
    assert.equal(membership.scim_user_id, null);
  } finally {
    await db.close();
  }
});
test("pending SSO directory membership reconciles from authoritative identities and account deletion scrubs only that person", async () => {
  const { db, create, identity, service } = await fixture();
  try {
    const user = await create();
    await identity();
    assert.equal(
      await service("select reconcile_organization_scim_membership($1) value", [member]),
      1,
    );
    assert.equal(
      (await db.query("select user_id from organization_scim_users where id=$1", [user.id])).rows[0]
        .user_id,
      member,
    );
    await db.query("delete from auth.users where id=$1", [member]);
    const row = (await db.query("select * from organization_scim_users where id=$1", [user.id]))
      .rows[0];
    assert.equal(row.user_id, null);
    assert.equal(row.active, false);
    assert.match(row.external_id, /^deleted:/);
    assert.equal(row.display_name, "");
    assert.ok(row.deleted_at);
    assert.equal(
      (await db.query("select count(*)::int n from auth.users where id=$1", [other])).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("Groups enforce same-tenant references and revision writes; list pagination and filters are bounded", async () => {
  const { db, rpc, create } = await fixture();
  try {
    const first = await create();
    await create("subject-2", "second@example.com");
    const group = await rpc("create", {
      kind: "Groups",
      resource: { externalId: "group-1", displayName: "Team", members: [{ value: first.id }] },
    });
    assert.deepEqual(group.members, [first.id]);
    const list = await rpc("list", { kind: "Users", startIndex: 1, count: 1, filter: null });
    assert.equal(list.total, 2);
    assert.equal(list.rows.length, 1);
    assert.equal(
      (
        await rpc("list", {
          kind: "Users",
          startIndex: 1,
          count: 100,
          filter: { field: "userName", value: "MEMBER@example.com" },
        })
      ).rows[0].id,
      first.id,
    );
    await assert.rejects(
      rpc("replace", {
        kind: "Groups",
        id: group.id,
        expectedRevision: 1,
        resource: {
          externalId: "group-1",
          displayName: "Team",
          members: [{ value: crypto.randomUUID() }],
        },
      }),
      /member_missing/,
    );
    assert.deepEqual((await rpc("get", { kind: "Groups", id: group.id })).members, [first.id]);
    await rpc("delete", { kind: "Groups", id: group.id, expectedRevision: 1 });
    await assert.rejects(
      rpc("replace", {
        kind: "Groups",
        id: group.id,
        expectedRevision: 1,
        resource: { externalId: "group-1", displayName: "Old", members: [] },
      }),
      /missing/,
    );
  } finally {
    await db.close();
  }
});
test("rotated tokens, disabled provisioning, current SSO policy and deletion fences revoke native write authority", async () => {
  const { db, admin, rpc, identity, create } = await fixture();
  try {
    await identity();
    await create();
    await admin("rotate", { expectedRevision: 1, tokenHash: "b".repeat(64) });
    await assert.rejects(rpc("authorize"), /unauthorized/);
    assert.ok(await rpc("authorize", {}, "b".repeat(64)));
    await admin("disable", { expectedRevision: 2 });
    assert.notEqual(
      (await db.query("select revoked_at from organization_members where user_id=$1", [member]))
        .rows[0].revoked_at,
      null,
    );
    await assert.rejects(rpc("authorize", {}, "b".repeat(64)), /unauthorized/);
    await admin("rotate", { expectedRevision: 3, tokenHash: token });
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(rpc("authorize"), /unauthorized/);
  } finally {
    await db.close();
  }
});

test("deleting the sponsoring owner disables credentials without blocking Auth erasure or retaining managed access", async () => {
  const { db, identity, create, rpc } = await fixture();
  try {
    await identity();
    await create();
    await db.query(
      "insert into organization_members(organization_id,user_id,role)values($1,$2,'owner')",
      [org, other],
    );
    await db.query("delete from auth.users where id=$1", [owner]);
    const cfg = (
      await db.query("select enabled,issued_by,token_hash from organization_scim_configs")
    ).rows[0];
    assert.deepEqual(cfg, { enabled: false, issued_by: null, token_hash: null });
    assert.ok(
      (await db.query("select revoked_at from organization_members where user_id=$1", [member]))
        .rows[0].revoked_at,
    );
    await assert.rejects(rpc("authorize"), /unauthorized/);
    assert.equal(
      (await db.query("select count(*)::int n from auth.users where id=$1", [member])).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("deleted resources may be recreated with a new immutable id; old commands and removed SSO identities cannot retain access", async () => {
  const { db, identity, create, rpc, service } = await fixture();
  try {
    await identity();
    const old = await create();
    await rpc("delete", { kind: "Users", id: old.id, expectedRevision: 1 });
    const current = await create();
    assert.notEqual(current.id, old.id);
    assert.equal(
      (await db.query("select scim_user_id from organization_members where user_id=$1", [member]))
        .rows[0].scim_user_id,
      current.id,
    );
    await assert.rejects(
      rpc("delete", { kind: "Users", id: old.id, expectedRevision: 1 }),
      /missing/,
    );
    await db.query("delete from auth.identities where user_id=$1", [member]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [member]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select * from organizations")).rows.length, 0);
    await db.exec("reset role");
    assert.equal(
      await service("select reconcile_organization_scim_membership($1) value", [member]),
      1,
    );
    assert.ok(
      (await db.query("select revoked_at from organization_members where user_id=$1", [member]))
        .rows[0].revoked_at,
    );
    await identity();
    await service("select reconcile_organization_scim_membership($1) value", [member]);
    await db.query("update organization_members set revoked_at=now() where user_id=$1", [member]);
    assert.equal(
      await service("select reconcile_organization_scim_membership($1) value", [member]),
      0,
    );
    assert.ok(
      (await db.query("select revoked_at from organization_members where user_id=$1", [member]))
        .rows[0].revoked_at,
    );
  } finally {
    await db.close();
  }
});

test("deleting a SCIM User removes group references and invalidates the old Group ETag", async () => {
  const { db, create, rpc } = await fixture();
  try {
    const user = await create();
    const group = await rpc("create", {
      kind: "Groups",
      resource: { externalId: "group", displayName: "Group", members: [{ value: user.id }] },
    });
    await rpc("delete", { kind: "Users", id: user.id, expectedRevision: 1 });
    const current = await rpc("get", { kind: "Groups", id: group.id });
    assert.deepEqual(current.members, []);
    assert.equal(current.revision, 2);
    await assert.rejects(
      rpc("delete", { kind: "Groups", id: group.id, expectedRevision: 1 }),
      /revision_changed/,
    );
  } finally {
    await db.close();
  }
});
