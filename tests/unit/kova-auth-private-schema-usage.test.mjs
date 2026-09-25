import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260925143706_kova_restore_legacy_private_helper_usage.sql",
    import.meta.url,
  ),
  "utf8",
);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema kova_private;
    create function kova_private.family_owner_of(p_user uuid) returns uuid
      language plpgsql stable security definer set search_path = '' as $$
      begin
        if current_setting('request.jwt.claim.sub',true)::uuid is distinct from p_user then
          raise exception 'forbidden_user_scope' using errcode = '42501';
        end if;
        return p_user;
      end $$;
    revoke all on function kova_private.family_owner_of(uuid) from public, anon;
    grant execute on function kova_private.family_owner_of(uuid) to authenticated;
    create function public.family_owner_of(p_user uuid) returns uuid
      language sql stable security invoker set search_path = pg_catalog as
      $$ select kova_private.family_owner_of(p_user) $$;
    revoke all on function public.family_owner_of(uuid) from public, anon;
    grant execute on function public.family_owner_of(uuid) to authenticated;
    create table kova_private.auth_credentials (id uuid);
    create function kova_private.require_digest(p_digest text) returns text
      language sql security definer set search_path = '' as $$ select p_digest $$;
    revoke all on function kova_private.require_digest(text) from public, anon, authenticated;
    revoke all on schema kova_private from public, anon, authenticated;
    grant usage on schema kova_private to service_role;
  `);
  return db;
}

test("restore scoped legacy helper without exposing owned Auth routines or tables", async () => {
  const db = await fixture();
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(migration);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    assert.equal(
      (await db.query("select public.family_owner_of($1) result", [owner])).rows[0].result,
      owner,
    );
    await assert.rejects(db.query("select public.family_owner_of($1)", [other]), {
      code: "42501",
    });
    await assert.rejects(db.query("select kova_private.require_digest('secret')"), {
      code: "42501",
    });
    await assert.rejects(db.query("select * from kova_private.auth_credentials"), {
      code: "42501",
    });
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select kova_private.family_owner_of($1)", [owner]), {
      code: "42501",
    });
  } finally {
    await db.close();
  }
});

test("migration stops if an owned Auth function has an authenticated grant", async () => {
  const db = await fixture();
  try {
    await db.exec("grant execute on function kova_private.require_digest(text) to authenticated");
    await assert.rejects(db.exec(migration), /owned_auth_private_client_grant/u);
    assert.equal(
      (await db.query("select has_schema_privilege('authenticated','kova_private','USAGE') ok"))
        .rows[0].ok,
      false,
    );
  } finally {
    await db.close();
  }
});
