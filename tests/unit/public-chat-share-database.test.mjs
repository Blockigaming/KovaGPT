import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("public-share lookup respects expiration, revocation, account deletion and database role boundaries", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;grant usage on schema public,kova_private to service_role;create table auth.users(id uuid primary key);create table public.account_deletion_fences(user_id uuid primary key);create function kova_private.auth_user_exists(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from auth.users where id=$1)$$;grant execute on function kova_private.auth_user_exists(uuid) to service_role;grant select on public.account_deletion_fences to service_role;",
    );
    await db.exec(
      "create table public.chat_share_links(id uuid primary key,user_id uuid,chat_id text,token_hash text); insert into public.chat_share_links values(gen_random_uuid(),null,'legacy','legacy-digest'); create function kova_private.account_export_direct_row_bytes(uuid,bigint) returns bigint language plpgsql as $$begin perform * from (values ('chat_share_links', 'user_id')) x(a,b);return 0;end$$;",
    );
    await db.exec(
      readFileSync(
        new URL(
          "../../supabase/migrations/20261031014500_public_chat_share_links.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.chat_share_links")).rows[0].n,
      1,
    );
    assert.match(
      (
        await db.query(
          "select pg_get_functiondef('kova_private.account_export_direct_row_bytes(uuid,bigint)'::regprocedure) body",
        )
      ).rows[0].body,
      /chat_public_shares/,
    );
    const owner = "11111111-1111-4111-8111-111111111111",
      token = "a".repeat(64);
    await db.query("insert into auth.users values($1)", [owner]);
    await db.query(
      'insert into public.chat_public_shares(owner_id,token_hash,title,snapshot) values($1,$2,\'Review\',\'{"messages":[{"role":"user","content":"Visible"}]}\')',
      [owner, token],
    );
    const read = async () => {
      await db.exec("set role service_role");
      try {
        return (await db.query("select public.read_public_chat_share($1) as result", [token]))
          .rows[0].result;
      } finally {
        await db.exec("reset role");
      }
    };
    assert.equal((await read()).title, "Review");
    assert.equal((await read()).owner_id, undefined);
    await db.query("update public.chat_public_shares set revoked_at=now() where token_hash=$1", [
      token,
    ]);
    assert.equal(await read(), null);
    await db.exec("delete from public.chat_public_shares");
    const insert = async (expires, digest = token, content = "Visible") =>
      db.query(
        "insert into public.chat_public_shares(owner_id,token_hash,title,snapshot,expires_at) values($1,$2,'Review',$3,$4)",
        [owner, digest, JSON.stringify({ messages: [{ role: "user", content }] }), expires],
      );
    await insert(new Date(Date.now() - 60000).toISOString());
    assert.equal(await read(), null);
    await db.exec("delete from public.chat_public_shares");
    await insert(new Date(Date.now() + 86400000).toISOString());
    await assert.rejects(
      db.query("update public.chat_public_shares set title='Changed'"),
      /immutable/,
    );
    for (let i = 1; i < 20; i++)
      await insert(new Date(Date.now() + 86400000).toISOString(), i.toString(16).padStart(64, "0"));
    await assert.rejects(
      insert(new Date(Date.now() + 86400000).toISOString(), "b".repeat(64)),
      /public_share_limit/,
    );
    await db.exec("delete from public.chat_public_shares");
    await insert(new Date(Date.now() + 86400000).toISOString(), token, "x".repeat(400000));
    await insert(new Date(Date.now() + 86400000).toISOString(), "b".repeat(64), "x".repeat(400000));
    await assert.rejects(
      insert(new Date(Date.now() + 86400000).toISOString(), "c".repeat(64), "x".repeat(400000)),
      /public_share_limit/,
    );
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    assert.equal(await read(), null);
    await db.exec("set role anon");
    await assert.rejects(
      () => db.query("select public.read_public_chat_share($1)", [token]),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select * from public.chat_public_shares"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
