import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { reserveUploads, uploadFingerprint } from "../../src/lib/upload-quota.server.mjs";
const owner = "11111111-1111-4111-8111-111111111111";
async function database() {
  const db = new PGlite();
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}');CREATE TABLE public.daily_usage(user_id uuid,usage_date date,images int,chats int,uploads int,voice int,updated_at timestamptz,PRIMARY KEY(user_id,usage_date));GRANT ALL ON public.daily_usage TO service_role;`,
  );
  const old = await readFile(
    "supabase/migrations/20260702163905_0663df95-a332-4ab8-959a-e802db899983.sql",
    "utf8",
  );
  await db.exec(old.slice(0, old.indexOf("-- 2. Family")));
  await db.exec(
    await readFile("supabase/migrations/20261018163000_daily_upload_identity.sql", "utf8"),
  );
  await db.exec("SET ROLE service_role");
  return db;
}
test("two distinct Free uploads share atomic UTC counter; repeated autosave and chat charge once", async () => {
  const db = await database();
  try {
    const reserve = async (hashes) =>
      (await db.query("SELECT public.try_reserve_daily_uploads($1,$2,2) allowed", [owner, hashes]))
        .rows[0].allowed;
    const a = "a".repeat(64),
      b = "b".repeat(64),
      c = "c".repeat(64);
    assert.equal(await reserve([a]), true);
    assert.equal(await reserve([a]), true);
    assert.equal(await reserve([a, b]), true);
    assert.equal(await reserve([c]), false);
    assert.equal(
      (
        await db.query(
          "SELECT uploads,usage_date=(now() AT TIME ZONE 'utc')::date today FROM daily_usage",
        )
      ).rows[0].uploads,
      2,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM daily_upload_fingerprints")).rows[0].n,
      2,
    );
    await db.exec("RESET ROLE;SET ROLE authenticated");
    await assert.rejects(
      db.query("SELECT public.try_reserve_daily_uploads($1,$2,2)", [owner, [c]]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("chat and Library extracted text produce the same private hash; referenced Library files do not consume another upload", async () => {
  const attachment = { kind: "text_file", name: "Plan.pdf", content: "Same extracted text" };
  assert.equal(await uploadFingerprint(attachment), await uploadFingerprint({ ...attachment }));
  let called = false;
  const caller = {
    userId: owner,
    supabaseAdmin: {
      rpc() {
        called = true;
        return Promise.resolve({ data: true });
      },
    },
  };
  assert.equal(await reserveUploads(caller, [{ kind: "library_file" }], 2), true);
  assert.equal(called, false);
  assert.equal(await reserveUploads(caller, [attachment], 2), true);
  assert.equal(called, true);
});
test("unavailable or indeterminate upload quota fails closed", async () => {
  for (const result of [{ data: null }, { data: true, error: { message: "offline" } }]) {
    const caller = { userId: owner, supabaseAdmin: { rpc: () => Promise.resolve(result) } };
    await assert.rejects(
      reserveUploads(caller, [{ kind: "text_file", name: "a.txt", content: "hello" }], 2),
      /upload_quota_unavailable/,
    );
  }
});

test("account isolation, prior UTC day and concurrent submitted final slots", async () => {
  const db = await database();
  try {
    const other = "22222222-2222-4222-8222-222222222222";
    await db.exec(`RESET ROLE;INSERT INTO auth.users VALUES('${other}');SET ROLE service_role`);
    const reserve = async (user, hash) =>
      (
        await db.query("SELECT public.try_reserve_daily_uploads($1,$2,2) allowed", [
          user,
          [hash.repeat(64)],
        ])
      ).rows[0].allowed;
    await reserve(owner, "a");
    const outcomes = await Promise.all([reserve(owner, "b"), reserve(owner, "c")]);
    assert.deepEqual(outcomes.sort(), [false, true]);
    assert.equal(await reserve(other, "a"), true);
    await db.exec(
      `RESET ROLE;UPDATE daily_usage SET usage_date=usage_date-1 WHERE user_id='${owner}';UPDATE daily_upload_fingerprints SET usage_date=usage_date-1 WHERE user_id='${owner}';SET ROLE service_role;`,
    );
    assert.equal(await reserve(owner, "a"), true);
    assert.equal(
      (
        await db.query(
          `SELECT uploads FROM daily_usage WHERE user_id='${owner}' AND usage_date=(now() AT TIME ZONE 'utc')::date`,
        )
      ).rows[0].uploads,
      1,
    );
  } finally {
    await db.close();
  }
});
