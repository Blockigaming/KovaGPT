import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { inspectSiteFiles, sha256 } from "../../src/lib/sites-policy.mjs";
const OWNER = "123e4567-e89b-42d3-a456-426614174000",
  VIEWER = "423e4567-e89b-42d3-a456-426614174000",
  STRANGER = "523e4567-e89b-42d3-a456-426614174000";
const SITE_REQUEST = "623e4567-e89b-42d3-a456-426614174000",
  VERSION_REQUEST = "723e4567-e89b-42d3-a456-426614174000";
async function fixture() {
  const db = new PGlite();
  db.siteId = SITE_REQUEST;
  db.versionId = VERSION_REQUEST;
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA kova_private;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean DEFAULT false);
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,not_after timestamptz);
 CREATE TABLE public.account_deletion_fences(user_id uuid PRIMARY KEY);CREATE TABLE public.banned_users(user_id uuid PRIMARY KEY);
 CREATE TABLE public.user_storage(user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,bytes_used bigint DEFAULT 0,updated_at timestamptz);
 CREATE FUNCTION public.try_add_storage_bytes(uuid,bigint,bigint) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO public.user_storage(user_id) VALUES($1) ON CONFLICT DO NOTHING;PERFORM 1 FROM public.user_storage WHERE user_id=$1 FOR UPDATE;
 IF (SELECT bytes_used FROM public.user_storage WHERE user_id=$1)+$2>$3 THEN RETURN false;END IF;
 UPDATE public.user_storage SET bytes_used=bytes_used+$2 WHERE user_id=$1;RETURN true;END;$$;
 CREATE FUNCTION kova_private.verified_auth_user_for_email(text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT id FROM auth.users WHERE lower(email)=lower($1) AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL LIMIT 1$$;
 REVOKE ALL ON FUNCTION kova_private.verified_auth_user_for_email(text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION kova_private.verified_auth_user_for_email(text) TO service_role;
 GRANT USAGE ON SCHEMA kova_private TO service_role;GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
    await db.query(
      "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'owner@example.com',now()),($2,'viewer@example.com',now()),($3,'stranger@example.com',now())",
      [OWNER, VIEWER, STRANGER],
    );
    await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$1),($2,$2),($3,$3)", [
      OWNER,
      VIEWER,
      STRANGER,
    ]);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260905004839_kova_sites_lifecycle.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260905020833_sites_export_and_erasure.sql",
          import.meta.url,
        ),
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
async function mutate(
  db,
  action,
  payload,
  revision,
  { owner = OWNER, mutation = crypto.randomUUID(), limit = 10000000 } = {},
) {
  const result = await rpc(db, "mutate_kova_site", [
    owner,
    db.siteId,
    mutation,
    revision,
    action,
    payload,
    limit,
  ]);
  if (action === "create") db.siteId = result.siteId;
  if (action === "saveVersion") db.versionId = result.versionId;
  return result;
}
async function prepared(db) {
  await mutate(db, "create", { title: "Example", slug: "example" }, 0);
  const inspected = await inspectSiteFiles([
    { path: "index.html", base64: btoa("<h1>Private</h1>") },
    { path: "app.js", base64: btoa("window.loaded=true") },
  ]);
  delete inspected.bytes;
  await mutate(db, "saveVersion", { versionId: db.versionId, ...inspected }, 1);
  return inspected;
}
async function ticket(db, user = VIEWER, preview = null) {
  const token = crypto.randomUUID();
  await rpc(db, "issue_kova_site_ticket", [user, db.siteId, await sha256(token), user, preview]);
  const session = crypto.randomUUID();
  await rpc(db, "redeem_kova_site_ticket", [db.siteId, await sha256(token), await sha256(session)]);
  return sha256(session);
}

test("private Sites require current named viewer grants and unpublished versions stay owner-only", async () => {
  const db = await fixture();
  try {
    await prepared(db);
    assert.equal(
      (await db.query("SELECT has_table_privilege('service_role','auth.users','SELECT') allowed"))
        .rows[0].allowed,
      false,
    );
    assert.equal(
      await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", null]),
      null,
    );
    await assert.rejects(rpc(db, "read_kova_sites", [STRANGER, db.siteId, null]), /not_found/);
    await mutate(db, "publish", { versionId: db.versionId, visibility: "private" }, 2);
    await assert.rejects(ticket(db), /access_denied/);
    await mutate(db, "grantViewer", { email: "viewer@example.com" }, 3);
    assert.equal(
      (await rpc(db, "read_kova_sites", [OWNER, db.siteId, null])).viewers[0].viewer_label,
      "viewer@example.com",
    );
    const session = await ticket(db);
    assert.equal(
      (await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", session])).type,
      "text/html",
    );
    await assert.rejects(ticket(db, VIEWER, db.versionId), /access_denied/);
    await mutate(db, "revokeViewer", { viewerId: VIEWER }, 4);
    assert.equal(
      await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", session]),
      null,
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(db.query("SELECT * FROM public.kova_site_files"), /permission denied/);
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});

test("immutable versions charge exactly once and publication receipts invalidate on unpublish", async () => {
  const db = await fixture();
  try {
    const inspected = await prepared(db);
    const used = (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used;
    const receipt = crypto.randomUUID();
    await mutate(db, "publish", { versionId: db.versionId, visibility: "public" }, 2, {
      mutation: receipt,
    });
    assert.equal(
      await rpc(db, "verify_kova_site_publication", [
        OWNER,
        db.siteId,
        db.versionId,
        receipt,
        inspected.manifestSha256,
      ]),
      true,
    );
    assert.ok(await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", null]));
    await assert.rejects(
      db.query("UPDATE public.kova_site_files SET content_base64='eA=='"),
      /immutable/,
    );
    await assert.rejects(mutate(db, "retireVersion", { versionId: db.versionId }, 3), /published/);
    await mutate(db, "unpublish", {}, 3);
    assert.equal(
      await rpc(db, "verify_kova_site_publication", [
        OWNER,
        db.siteId,
        db.versionId,
        receipt,
        inspected.manifestSha256,
      ]),
      false,
    );
    await mutate(db, "retireVersion", { versionId: db.versionId }, 4);
    assert.equal(
      (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used,
      used,
    );
    assert.equal(await rpc(db, "cleanup_kova_site_versions", [OWNER, 5]), 1);
    assert.equal(await rpc(db, "cleanup_kova_site_versions", [OWNER, 5]), 0);
    assert.equal(
      (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used,
      0,
    );
  } finally {
    await db.close();
  }
});

test("deleted Sites purge personal metadata after bounded retirement and never reuse caller-selected identities", async () => {
  const db = await fixture();
  try {
    const snapshot = await prepared(db);
    for (let i = 0; i < 6; i++)
      await mutate(db, "saveVersion", { versionId: VERSION_REQUEST, ...snapshot }, i + 2);
    await mutate(db, "publish", { versionId: db.versionId, visibility: "public" }, 8);
    await mutate(
      db,
      "rename",
      { title: "Private customer title", slug: "private-customer-alias" },
      9,
    );
    const session = await ticket(db, OWNER);
    const oldSite = db.siteId;
    const mutation = crypto.randomUUID();
    const deleted = await mutate(db, "delete", {}, 10, { mutation });
    assert.equal(
      await rpc(db, "read_kova_site_asset", [oldSite, "example", "index.html", session]),
      null,
    );
    assert.equal(await rpc(db, "cleanup_kova_site_versions", [OWNER, 5]), 5);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM kova_sites WHERE id=$1", [oldSite])).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM kova_site_retirements")).rows[0].n,
      2,
    );
    assert.equal(await rpc(db, "cleanup_kova_site_versions", [OWNER, 5]), 2);
    for (const table of [
      "kova_sites",
      "kova_site_versions",
      "kova_site_files",
      "kova_site_aliases",
      "kova_site_viewers",
      "kova_site_access_sessions",
      "kova_site_retirements",
    ])
      assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0, table);
    assert.equal(
      (await db.query("SELECT bytes_used FROM user_storage WHERE user_id=$1", [OWNER])).rows[0]
        .bytes_used,
      0,
    );
    assert.deepEqual(
      await mutate(db, "delete", {}, 10, { mutation }),
      deleted,
      "receipt replay cannot recreate metadata",
    );
    assert.equal(await rpc(db, "cleanup_kova_site_versions", [OWNER, 5]), 0);
    const recreated = await rpc(db, "mutate_kova_site", [
      STRANGER,
      oldSite,
      crypto.randomUUID(),
      0,
      "create",
      { title: "Another owner", slug: "example" },
      1000000,
    ]);
    assert.notEqual(
      recreated.siteId,
      oldSite,
      "a new caller cannot claim a retired public hostname",
    );
    assert.equal(
      await rpc(db, "read_kova_site_asset", [oldSite, "example", "index.html", session]),
      null,
    );
    await db.exec("UPDATE kova_site_receipts SET created_at=now()-interval '9 days'");
    await rpc(db, "cleanup_kova_site_versions", [null, 5]);
    assert.equal((await db.query("SELECT count(*)::int n FROM kova_site_receipts")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("legacy settled retirements release no quota again and empty deleted Sites are finalized", async () => {
  const db = await fixture();
  try {
    await mutate(db, "create", { title: "Empty private title", slug: "empty-site" }, 0);
    await mutate(db, "delete", {}, 1);
    await db.query("INSERT INTO user_storage(user_id,bytes_used) VALUES($1,500)", [OWNER]);
    await db.query(
      "INSERT INTO kova_site_retirements(version_id,owner_id,size_bytes,settled_at) VALUES($1,$2,100,now())",
      [VERSION_REQUEST, OWNER],
    );
    assert.equal(await rpc(db, "cleanup_kova_site_versions", [OWNER, 5]), 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM kova_sites")).rows[0].n, 0);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM kova_site_retirements")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT bytes_used FROM user_storage WHERE user_id=$1", [OWNER])).rows[0]
        .bytes_used,
      500,
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      db.query("SELECT * FROM kova_site_file_export_metadata"),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});

test("snapshot save receipts survive ambiguous retries and reject changed payload or stale revisions", async () => {
  const db = await fixture();
  try {
    await mutate(db, "create", { title: "Example", slug: "example" }, 0);
    const files = await inspectSiteFiles([{ path: "index.html", base64: btoa("hello") }]);
    delete files.bytes;
    const payload = { versionId: db.versionId, ...files },
      mutation = crypto.randomUUID();
    const first = await mutate(db, "saveVersion", payload, 1, { mutation });
    assert.deepEqual(await mutate(db, "saveVersion", payload, 1, { mutation }), first);
    assert.equal(
      (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used,
      5,
    );
    await assert.rejects(
      mutate(db, "saveVersion", { ...payload, manifestSha256: "b".repeat(64) }, 1, { mutation }),
      /idempotency_conflict/,
    );
    await assert.rejects(
      mutate(db, "rename", { title: "Wrong", slug: "wrong-site" }, 1),
      /revision_conflict/,
    );
    await assert.rejects(
      mutate(db, "rename", { title: "Wrong", slug: "wrong-site" }, 2, { owner: STRANGER }),
      /not_found/,
    );
  } finally {
    await db.close();
  }
});

test("renames preserve accessible redirects and account fences immediately revoke public and private access", async () => {
  const db = await fixture();
  try {
    await prepared(db);
    await mutate(db, "publish", { versionId: db.versionId, visibility: "public" }, 2);
    await mutate(db, "rename", { title: "Renamed", slug: "renamed-site" }, 3);
    assert.deepEqual(
      await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", null]),
      {
        redirectSlug: "renamed-site",
      },
    );
    assert.ok(
      await rpc(db, "read_kova_site_asset", [db.siteId, "renamed-site", "index.html", null]),
    );
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [OWNER]);
    assert.equal(
      await rpc(db, "read_kova_site_asset", [db.siteId, "renamed-site", "index.html", null]),
      null,
    );
    await assert.rejects(
      mutate(
        db,
        "saveVersion",
        {
          versionId: crypto.randomUUID(),
          ...(await inspectSiteFiles([{ path: "index.html", base64: btoa("late") }])),
        },
        4,
      ),
      /account_unavailable/,
    );
    await db.query("DELETE FROM auth.users WHERE id=$1", [OWNER]);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.kova_site_files")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("access tickets redeem once, bind one Site and epoch, and recheck current bans", async () => {
  const db = await fixture();
  try {
    await prepared(db);
    await mutate(db, "publish", { versionId: db.versionId, visibility: "private" }, 2);
    await mutate(db, "grantViewer", { email: "viewer@example.com" }, 3);
    const hash = "a".repeat(64);
    await rpc(db, "issue_kova_site_ticket", [VIEWER, db.siteId, hash, VIEWER, null]);
    assert.equal(
      await rpc(db, "redeem_kova_site_ticket", [crypto.randomUUID(), hash, "b".repeat(64)]),
      null,
    );
    assert.ok(await rpc(db, "redeem_kova_site_ticket", [db.siteId, hash, "b".repeat(64)]));
    assert.equal(await rpc(db, "redeem_kova_site_ticket", [db.siteId, hash, "c".repeat(64)]), null);
    await db.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1", [
      VIEWER,
    ]);
    assert.equal(
      await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", "b".repeat(64)]),
      null,
    );
  } finally {
    await db.close();
  }
});

test("revoking the issuing Auth session denies fresh private reads and ticket redemption", async () => {
  const db = await fixture();
  try {
    await prepared(db);
    await mutate(db, "publish", { versionId: db.versionId, visibility: "private" }, 2);
    await mutate(db, "grantViewer", { email: "viewer@example.com" }, 3);
    const session = await ticket(db),
      pending = "f".repeat(64);
    await rpc(db, "issue_kova_site_ticket", [VIEWER, db.siteId, pending, VIEWER, null]);
    await assert.rejects(
      rpc(db, "issue_kova_site_ticket", [VIEWER, db.siteId, "e".repeat(64), OWNER, null]),
      /access_denied/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('service_role','auth.sessions','SELECT') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await db.query("DELETE FROM auth.sessions WHERE id=$1", [VIEWER]);
    assert.equal(
      await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", session]),
      null,
    );
    assert.equal(
      await rpc(db, "redeem_kova_site_ticket", [db.siteId, pending, "d".repeat(64)]),
      null,
    );
    assert.equal(await rpc(db, "check_kova_site_auth_session", [VIEWER, VIEWER]), false);
  } finally {
    await db.close();
  }
});

test("stale or expired private cookies fall back only to the current public publication", async () => {
  const db = await fixture();
  try {
    await prepared(db);
    await mutate(db, "publish", { versionId: db.versionId, visibility: "private" }, 2);
    await mutate(db, "grantViewer", { email: "viewer@example.com" }, 3);
    const session = await ticket(db);
    await mutate(db, "publish", { versionId: db.versionId, visibility: "public" }, 4);
    assert.equal(
      (await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", session]))
        .versionId,
      db.versionId,
    );
    await db.exec(
      "UPDATE public.kova_site_access_sessions SET expires_at=now()-interval '1 second'",
    );
    assert.equal(
      (await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", session]))
        .versionId,
      db.versionId,
    );
    await mutate(db, "unpublish", {}, 5);
    assert.equal(
      await rpc(db, "read_kova_site_asset", [db.siteId, "example", "index.html", session]),
      null,
    );
  } finally {
    await db.close();
  }
});
