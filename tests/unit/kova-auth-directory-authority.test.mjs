import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { authDatabase, passwordAccount, owner, other } from "../helpers/kova-auth-database.mjs";

const read = (name) =>
  readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const legacy = "30000000-0000-4000-8000-000000000003";
const project = "40000000-0000-4000-8000-000000000004";
const ownerEmail = "owner@example.invalid";
const otherEmail = "recipient@example.invalid";
const shadow = (id) => `shadow+${id}@auth.invalid.kovagpt.com`;
const resolveEmail = async (db, email) =>
  (await db.query("select kova_private.verified_auth_user_for_email($1) id", [email])).rows[0].id;
const displayEmail = async (db, id) =>
  (await db.query("select public.kova_auth_directory_email($1) email", [id])).rows[0].email;

async function fixture() {
  const family = await read("20260702163905_0663df95-a332-4ab8-959a-e802db899983.sql");
  const db = await authDatabase({
    beforeMigrations: `
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade,
        requested_at timestamptz default now(), updated_at timestamptz default now());
      ${await read("20260905001736_private_auth_identity_helpers.sql")}
      create type public.project_role as enum ('owner','editor','viewer');
      create table public.project_invites(id uuid primary key, project_id uuid not null,
        email text not null, role public.project_role not null, status text not null, accepted_at timestamptz);
      create table public.project_members(project_id uuid not null, user_id uuid not null,
        role public.project_role not null, primary key(project_id,user_id));
      create function kova_private.accept_project_invite(_invite_id uuid)
        returns uuid language sql as $$select null::uuid$$;
      create function kova_private.decline_project_invite(_invite_id uuid)
        returns boolean language sql as $$select false$$;
      ${family.slice(family.indexOf("-- 2. Family Sharing tables"))}
      ${await read("20260905001217_family_atomic_membership.sql")}
      ${await read("20260905001454_organization_administration_foundation.sql")}
    `,
  });
  await passwordAccount(db, { id: owner, email: ownerEmail });
  await passwordAccount(db, { id: other, email: otherEmail, token: "other-session" });
  await db.query(`update auth.users set email='shadow+'||id||'@auth.invalid.kovagpt.com',
    raw_app_meta_data='{"provider":"kova_shadow"}', raw_user_meta_data='{"kova_shadow":true}'`);
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'legacy@example.invalid',now())",
    [legacy],
  );
  return db;
}

test("final ordered directory finds verified Kova password and Google identities, never shadow emails", async () => {
  const db = await fixture();
  try {
    assert.equal(await resolveEmail(db, `  ${ownerEmail.toUpperCase()}  `), owner);
    assert.equal(await displayEmail(db, owner), ownerEmail);
    assert.equal(await resolveEmail(db, shadow(owner)), null);
    await db.query(
      "update kova_private.auth_identities set provider='google',provider_subject='google-subject' where account_id=$1",
      [other],
    );
    assert.equal(await resolveEmail(db, otherEmail), other);
    assert.equal(await displayEmail(db, other), otherEmail);
    assert.equal(await resolveEmail(db, "legacy@example.invalid"), legacy);
    assert.equal(await displayEmail(db, legacy), "legacy@example.invalid");
  } finally {
    await db.close();
  }
});

test("an unavailable or changed Kova identity cannot fall back to its old hosted email", async (t) => {
  const db = await fixture();
  try {
    await db.query(
      "update auth.users set email=$2,raw_app_meta_data='{}',raw_user_meta_data='{}' where id=$1",
      [owner, ownerEmail],
    );
    const mutations = [
      [
        "unverified account",
        "update kova_private.auth_accounts set email_verified_at=null where id=$1",
      ],
      [
        "suspended account",
        "update kova_private.auth_accounts set suspended_until=now()+interval '1 hour' where id=$1",
      ],
      ["deleted account", "update kova_private.auth_accounts set deleted_at=now() where id=$1"],
      [
        "disabled identity",
        "update kova_private.auth_identities set disabled_at=now() where account_id=$1",
      ],
      [
        "unverified identity",
        "update kova_private.auth_identities set verified_at=null where account_id=$1",
      ],
      [
        "changed account email",
        "update kova_private.auth_accounts set primary_email='changed@example.invalid' where id=$1",
      ],
      [
        "changed identity email",
        "update kova_private.auth_identities set normalized_email='changed@example.invalid' where account_id=$1",
      ],
    ];
    for (const [name, sql] of mutations)
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          await db.query(sql, [owner]);
          assert.equal(await resolveEmail(db, ownerEmail), null);
          assert.equal(await displayEmail(db, owner), null);
        } finally {
          await db.exec("rollback");
        }
      });
    await db.query(
      "update kova_private.auth_accounts set suspended_until=now()-interval '1 second' where id=$1",
      [owner],
    );
    assert.equal(await resolveEmail(db, ownerEmail), owner);
  } finally {
    await db.close();
  }
});

test("hosted fallback preserves ban, anonymous and verification checks and excludes orphaned compatibility rows", async (t) => {
  const db = await fixture();
  try {
    const mutations = [
      ["ban", "banned_until=now()+interval '1 hour'"],
      ["anonymous", "is_anonymous=true"],
      ["unverified", "email_confirmed_at=null"],
      ["deleted", "deleted_at=now()"],
      ["provider marker", 'raw_app_meta_data=\'{"provider":"kova_shadow"}\''],
      ["user marker", "raw_user_meta_data='{\"kova_shadow\":true}'"],
      ["shadow address", "email='shadow+orphan@auth.invalid.kovagpt.com'"],
    ];
    for (const [name, assignment] of mutations)
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          await db.query(`update auth.users set ${assignment} where id=$1`, [legacy]);
          assert.equal(await displayEmail(db, legacy), null);
          assert.equal(await resolveEmail(db, "legacy@example.invalid"), null);
          assert.equal(await resolveEmail(db, "shadow+orphan@auth.invalid.kovagpt.com"), null);
        } finally {
          await db.exec("rollback");
        }
      });
  } finally {
    await db.close();
  }
});

test("ambiguous owners are rejected, but the same compatibility UUID is never double-counted", async () => {
  const db = await fixture();
  try {
    await db.query("update auth.users set email=$2 where id=$1", [owner, ownerEmail]);
    assert.equal(await resolveEmail(db, ownerEmail), owner);
    await db.query("update auth.users set email=$2 where id=$1", [legacy, ownerEmail]);
    assert.equal(await resolveEmail(db, ownerEmail), null);
    for (const email of [null, "", "  ", "a".repeat(321), "missing@example.invalid"])
      assert.equal(await resolveEmail(db, email), null);
  } finally {
    await db.close();
  }
});

test("actual project acceptance and decline resolve the verified owned email without exposing shadow addresses", async () => {
  const db = await fixture();
  try {
    const accept = randomUUID(),
      decline = randomUUID();
    await db.query(
      `insert into public.project_invites(id,project_id,email,role,status) values
      ($1,$3,$4,'viewer','pending'),($2,$3,$4,'editor','pending')`,
      [accept, decline, project, otherEmail],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await assert.rejects(
      db.query("select kova_private.accept_project_invite($1)", [accept]),
      /invite_recipient_mismatch/u,
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.project_members")).rows[0].n,
      0,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    assert.equal(
      (await db.query("select kova_private.accept_project_invite($1) id", [accept])).rows[0].id,
      project,
    );
    assert.equal(
      (await db.query("select kova_private.decline_project_invite($1) ok", [decline])).rows[0].ok,
      true,
    );
    assert.deepEqual((await db.query("select user_id,role from public.project_members")).rows, [
      { user_id: other, role: "viewer" },
    ]);
    assert.equal(await displayEmail(db, other), otherEmail);
  } finally {
    await db.close();
  }
});

test("actual family invite acceptance uses the owned directory and retains recipient checks", async () => {
  const db = await fixture();
  try {
    const group = (
      await db.query("select public.create_or_repair_family_group($1,'Family') id", [owner])
    ).rows[0].id;
    const token = "d".repeat(48);
    await db.query(
      "insert into public.family_invites(group_id,token,invited_email,created_by) values($1,$2,$3,$4)",
      [group, token, otherEmail, owner],
    );
    await assert.rejects(
      db.query("select public.accept_family_invite_atomic($1,$2)", [legacy, token]),
      /recipient|email/u,
    );
    assert.equal(
      (await db.query("select public.accept_family_invite_atomic($1,$2) id", [other, token]))
        .rows[0].id,
      group,
    );
  } finally {
    await db.close();
  }
});

test("actual organization invitation and acceptance retain the verified owned recipient UUID", async () => {
  const db = await fixture();
  try {
    const organization = randomUUID();
    const mutate = async (actor, revision, action, payload) =>
      (
        await db.query(
          "select public.mutate_organization($1,$2,$3,$4,$5,$6::jsonb,'fixture-v1') result",
          [actor, randomUUID(), organization, revision, action, JSON.stringify(payload)],
        )
      ).rows[0].result;
    await mutate(owner, 0, "create", { name: "Owned directory" });
    const invited = await mutate(owner, 1, "invite", { email: otherEmail, role: "member" });
    assert.ok(invited);
    const invitation = (
      await db.query("select id from public.organization_invitations where organization_id=$1", [
        organization,
      ])
    ).rows[0];
    await mutate(other, 2, "acceptInvite", { invitationId: invitation.id });
    assert.equal(await resolveEmail(db, otherEmail), other);
  } finally {
    await db.close();
  }
});

test("directory functions expose neither raw Auth privileges nor browser-callable identity enumeration", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      for (const signature of [
        "public.kova_auth_directory_email(uuid)",
        "kova_private.verified_auth_user_for_email(text)",
      ])
        assert.equal(
          (
            await db.query("select has_function_privilege($1,$2,'execute') allowed", [
              role,
              signature,
            ])
          ).rows[0].allowed,
          false,
        );
    }
    await db.exec("set role service_role");
    await assert.rejects(db.query("select * from auth.users"), /permission denied/u);
    await assert.rejects(
      db.query("select * from kova_private.auth_accounts"),
      /permission denied/u,
    );
    assert.equal(await displayEmail(db, owner), ownerEmail);
    assert.equal(await resolveEmail(db, otherEmail), other);
  } finally {
    await db.close();
  }
});
