import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "123e4567-e89b-42d3-a456-426614174000",
  B = "223e4567-e89b-42d3-a456-426614174000";
const chat = (id = "chat", content = "hello") => ({
  id,
  title: id,
  mode: "instant",
  createdAt: 1,
  updatedAt: 2,
  messages: [{ id: "m", role: "user", content }],
});
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA kova_private;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean DEFAULT false);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE public.banned_users(user_id uuid PRIMARY KEY);CREATE TABLE public.account_deletion_fences(user_id uuid PRIMARY KEY);
 CREATE TABLE public.user_storage(user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,bytes_used bigint DEFAULT 0,updated_at timestamptz);
 CREATE FUNCTION public.try_add_storage_bytes(uuid,bigint,bigint) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO public.user_storage(user_id) VALUES($1) ON CONFLICT DO NOTHING;PERFORM 1 FROM public.user_storage WHERE user_id=$1 FOR UPDATE;
 IF (SELECT bytes_used FROM public.user_storage WHERE user_id=$1)+$2>$3 THEN RETURN false;END IF;
 UPDATE public.user_storage SET bytes_used=bytes_used+$2 WHERE user_id=$1;RETURN true;END;$$;
 GRANT USAGE ON SCHEMA kova_private,auth TO authenticated,service_role;
 GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
    await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [A, B]);
    await db.exec(
      await readFile(
        new URL("../../supabase/migrations/20260905023609_chat_history_sync.sql", import.meta.url),
        "utf8",
      ),
    );
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}
async function rpc(db, name, args) {
  await db.exec("SET ROLE service_role");
  try {
    return (
      await db.query(
        `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
        args,
      )
    ).rows[0].result;
  } finally {
    await db.exec("RESET ROLE");
  }
}
const pull = (db, owner = A, epoch = null, cursor = 0) =>
  rpc(db, "read_chat_history_changes", [owner, epoch, cursor, 1]);
const put = (
  db,
  epoch,
  payload = chat(),
  revision = 0,
  {
    owner = A,
    id = payload?.id ?? "chat",
    mutation = crypto.randomUUID(),
    archived = false,
    limit = 52428800,
  } = {},
) =>
  rpc(db, "mutate_chat_history", [owner, epoch, id, mutation, revision, payload, archived, limit]);

test("actual service role reads no Auth tables; owner RLS is current, fenced and immutable to callers", async () => {
  const db = await fixture();
  try {
    const epoch = (await pull(db)).epoch;
    await put(db, epoch);
    await db.exec("SET ROLE service_role");
    await assert.rejects(db.query("SELECT * FROM auth.users"), /permission denied/);
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [A]);
    await db.exec("SET ROLE authenticated");
    assert.equal((await db.query("SELECT id FROM public.chat_history_records")).rows.length, 1);
    await assert.rejects(db.query("DELETE FROM public.chat_history_records"), /permission denied/);
    await assert.rejects(
      db.query("SELECT public.read_chat_history_changes($1)", [A]),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [B]);
    await db.exec("SET ROLE authenticated");
    assert.equal((await db.query("SELECT id FROM public.chat_history_records")).rows.length, 0);
    await db.exec("RESET ROLE");
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [A]);
    await assert.rejects(pull(db), /denied/);
    await assert.rejects(put(db, epoch, chat(), 1), /denied/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [A]);
    await db.exec("SET ROLE authenticated");
    assert.equal((await db.query("SELECT id FROM public.chat_history_records")).rows.length, 0);
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
test("revision CAS and immutable retry receipts do not double-charge quota or replace newer content", async () => {
  const db = await fixture();
  try {
    const epoch = (await pull(db)).epoch,
      mutation = crypto.randomUUID();
    const first = await put(db, epoch, chat(), 0, { mutation });
    const bytes = (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used;
    assert.deepEqual(await put(db, epoch, chat(), 0, { mutation }), first);
    assert.equal(
      (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used,
      bytes,
    );
    await assert.rejects(
      put(db, epoch, chat("chat", "changed"), 0, { mutation }),
      /idempotency_conflict/,
    );
    await assert.rejects(put(db, epoch, chat("chat", "stale"), 0), /conflict/);
    await put(db, epoch, chat("chat", "newer"), 1);
    assert.deepEqual(await put(db, epoch, chat(), 0, { mutation }), first);
    assert.equal((await pull(db)).records[0].payload.messages[0].content, "newer");
  } finally {
    await db.close();
  }
});
test("Temporary and over-quota data roll back; archive/delete/recovery quota settles exactly once", async () => {
  const db = await fixture();
  try {
    const epoch = (await pull(db)).epoch;
    await assert.rejects(put(db, epoch, { ...chat(), temporary: true }), /invalid/);
    await assert.rejects(put(db, epoch, chat(), 0, { limit: 1 }), /storage_limit/);
    assert.equal(
      (await db.query("SELECT count(*) n FROM public.chat_history_records")).rows[0].n,
      0,
    );
    const saved = await put(db, epoch);
    await put(db, epoch, chat(), saved.revision, { archived: true });
    const archived = await pull(db);
    assert.equal(archived.records[0].archived, true);
    const mutation = crypto.randomUUID();
    await put(db, epoch, null, 2, { mutation });
    await put(db, epoch, null, 2, { mutation });
    assert.equal(
      (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used,
      0,
    );
    await put(db, epoch, chat(), 3);
    assert.ok(
      (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used > 0,
    );
  } finally {
    await db.close();
  }
});
test("expired deletion tombstones rotate the sync epoch before old clients can recreate the identity", async () => {
  const db = await fixture();
  try {
    const epoch = (await pull(db)).epoch;
    await put(db, epoch);
    await put(db, epoch, null, 1);
    await db.exec("UPDATE public.chat_history_records SET deleted_at=now()-interval '91 days'");
    const reset = await pull(db, A, epoch, 2);
    assert.notEqual(reset.epoch, epoch);
    assert.equal(reset.reset, true);
    assert.deepEqual(reset.records, []);
    await assert.rejects(put(db, epoch, chat(), 0), /epoch_changed/);
    assert.equal(
      (await db.query("SELECT count(*) n FROM public.chat_history_records")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("bounded pull includes one body per page; account deletion removes all history, receipts and counters", async () => {
  const db = await fixture();
  try {
    const epoch = (await pull(db)).epoch;
    await put(db, epoch, chat("one", "x".repeat(1000000)));
    await put(db, epoch, chat("two", "y".repeat(1000000)));
    const first = await pull(db);
    assert.equal(first.records.length, 1);
    assert.equal(first.hasMore, true);
    const second = await pull(db, A, epoch, first.nextCursor);
    assert.equal(second.records.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(second.records[0].id, "two");
    await db.query("DELETE FROM auth.users WHERE id=$1", [A]);
    for (const table of ["chat_history_records", "chat_history_mutations", "chat_history_counters"])
      assert.equal((await db.query(`SELECT count(*) n FROM public.${table}`)).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("both mutating and read-initialization paths take the account fence lock before chat locks and checks", async () => {
  const db = await fixture();
  try {
    for (const name of ["read_chat_history_changes", "mutate_chat_history"]) {
      const source = (await db.query("SELECT prosrc FROM pg_proc WHERE proname=$1", [name])).rows[0]
        .prosrc;
      const account = source.indexOf("hashtextextended(p_owner::text,20260903204500)"),
        chatLock = source.indexOf("hashtextextended(p_owner::text,411)"),
        check = source.indexOf("IF NOT kova_private.chat_history_principal_current");
      assert.ok(account >= 0 && account < chatLock && chatLock < check, name);
    }
    await db.exec("BEGIN");
    const epoch = (await pull(db)).epoch;
    await put(db, epoch);
    const held = await db.query(
      "SELECT count(*) n FROM pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND classid=((hashtextextended($1,20260903204500)>>32)&4294967295)::oid AND objid=(hashtextextended($1,20260903204500)&4294967295)::oid",
      [A],
    );
    assert.equal(held.rows[0].n, 1);
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});
