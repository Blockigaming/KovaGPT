import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { authDatabase, digest, expiry, now, other } from "../helpers/kova-auth-database.mjs";

const entries = [
  ["20260905032524_organization_scim_provisioning.sql", "organization_scim_actor_current"],
  ["20260905031401_custom_conversational_kovas.sql", "custom_kova_principal_current"],
  ["20260905023630_pwa_push_subscription_lifecycle.sql", "web_push_identity_current"],
  ["20260905023609_chat_history_sync.sql", "chat_history_principal_current"],
  ["20260910210000_workflow_skill_packages.sql", "workflow_skill_principal_current"],
  ["20260905032714_developer_mcp_oauth.sql", "mcp_owner_current"],
  ["20260905004839_kova_sites_lifecycle.sql", "site_principal_current"],
];
async function setup(beforeMigration) {
  const definitions = await Promise.all(
    entries.map(async ([file, name]) => {
      const source = await readFile(`supabase/migrations/${file}`, "utf8");
      const found = source.match(
        new RegExp(
          `create(?: or replace)? function kova_private\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`,
          "iu",
        ),
      );
      assert.ok(found, `Missing actual ${name} source`);
      return `${found[0]}\nrevoke all on function kova_private.${name}(uuid) from public,anon,authenticated; grant execute on function kova_private.${name}(uuid) to service_role;`;
    }),
  );
  return authDatabase({
    beforeMigration,
    beforeMigrations: `create schema kova_private;
    create table public.banned_users(user_id uuid primary key);
    create table public.account_deletion_fences(user_id uuid primary key);
    create table public.user_preferences(user_id uuid primary key,settings jsonb);
    ${definitions.join("\n")}`,
  });
}
async function admitted(db, id) {
  const result = {};
  for (const [, name] of entries)
    result[name] = (
      await db.query(`select kova_private.${name}($1) allowed`, [id])
    ).rows[0].allowed;
  return result;
}
const all = (value) => Object.fromEntries(entries.map(([, name]) => [name, value]));

test("all seven real product admission functions accept verified Kova identity despite an inert hosted bridge", async () => {
  const db = await setup();
  try {
    const id = (await db.query("select public.kova_auth_create_compatibility_principal() id"))
      .rows[0].id;
    assert.deepEqual(await admitted(db, id), all(false));
    await db.query(
      "select * from public.kova_auth_create_password_account($1,'owned@example.invalid','Owned',$2,$3,$4,'{}',$5)",
      [
        id,
        `scrypt-v1$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}`,
        digest("verify-product"),
        expiry,
        now,
      ],
    );
    assert.deepEqual(await admitted(db, id), all(false));
    await db.query("select * from public.kova_auth_consume_verification($1,$2,$3,$4)", [
      digest("verify-product"),
      digest("product-session"),
      expiry,
      now,
    ]);
    await db.exec("set role service_role");
    assert.deepEqual(await admitted(db, id), all(true));
    await db.exec("reset role");
    const raw = (
      await db.query(
        "select encrypted_password is null as no_password,email_confirmed_at is null as unverified,banned_until::text from auth.users where id=$1",
        [id],
      )
    ).rows[0];
    assert.deepEqual(raw, { no_password: true, unverified: true, banned_until: "infinity" });
    for (const sql of [
      "update kova_private.auth_accounts set suspended_until='infinity' where id=$1",
      "update kova_private.auth_accounts set deleted_at=now() where id=$1",
      "update kova_private.auth_identities set disabled_at=now() where account_id=$1",
      "insert into public.banned_users(user_id) values($1)",
      "insert into public.account_deletion_fences(user_id) values($1)",
      "update auth.users set raw_app_meta_data='{}',email='legacy@example.invalid' where id=$1",
    ]) {
      await db.exec("begin");
      try {
        await db.query(sql, [id]);
        assert.deepEqual(await admitted(db, id), all(false));
      } finally {
        await db.exec("rollback");
      }
    }
    await db.query(
      `insert into public.user_preferences(user_id,settings) values($1,'{"lockdown_mode":true}')`,
      [id],
    );
    const expected = {
      ...all(true),
      organization_scim_actor_current: false,
      mcp_owner_current: false,
    };
    assert.deepEqual(await admitted(db, id), expected);
  } finally {
    await db.close();
  }
});

test("hosted-only product rules remain unchanged and source drift cannot overwrite an unreviewed admission policy", async () => {
  const db = await setup();
  try {
    await db.query("insert into auth.users(id,email) values($1,'legacy@example.invalid')", [other]);
    assert.deepEqual(await admitted(db, other), {
      ...all(false),
      chat_history_principal_current: true,
    });
    await db.query("update auth.users set email_confirmed_at=now() where id=$1", [other]);
    assert.deepEqual(await admitted(db, other), all(true));
    await db.query("update auth.users set banned_until='infinity' where id=$1", [other]);
    assert.deepEqual(await admitted(db, other), all(false));
  } finally {
    await db.close();
  }
  await assert.rejects(
    setup(async (name, db) => {
      if (name.endsWith("_kova_owned_directory_authority.sql"))
        await db.exec(
          "create or replace function kova_private.site_principal_current(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$select false$$",
        );
    }),
    /kova_directory_predicate_drift/u,
  );
});
