import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { normalizeKovaConfig } from "../../src/lib/custom-kovas-policy.mjs";
const A = "123e4567-e89b-42d3-a456-426614174000",
  B = "223e4567-e89b-42d3-a456-426614174000",
  LIB = "323e4567-e89b-42d3-a456-426614174000";
const config = (changes) =>
  normalizeKovaConfig({
    name: "Writing Kova",
    icon: "✦",
    description: "Clear writing",
    instructions: "Help improve clarity.",
    starters: ["Improve this paragraph"],
    mode: "medium",
    tools: [],
    apps: [],
    knowledge: [],
    allowFork: false,
    ...changes,
  });
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA kova_private;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,email_confirmed_at timestamptz DEFAULT now(),is_anonymous boolean DEFAULT false,banned_until timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE public.banned_users(user_id uuid PRIMARY KEY);CREATE TABLE public.account_deletion_fences(user_id uuid PRIMARY KEY);
 CREATE TABLE public.user_storage(user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,bytes_used bigint DEFAULT 0,updated_at timestamptz);
 CREATE TABLE public.user_library_items(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users ON DELETE CASCADE,title text,content_text text);
 CREATE FUNCTION public.try_add_storage_bytes(uuid,bigint,bigint) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO public.user_storage(user_id) VALUES($1) ON CONFLICT DO NOTHING;PERFORM 1 FROM public.user_storage WHERE user_id=$1 FOR UPDATE;
 IF (SELECT bytes_used FROM public.user_storage WHERE user_id=$1)+$2>$3 THEN RETURN false;END IF;
 UPDATE public.user_storage SET bytes_used=bytes_used+$2 WHERE user_id=$1;RETURN true;END;$$;
 GRANT USAGE ON SCHEMA kova_private,auth TO authenticated,service_role;GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
    await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [A, B]);
    await db.query(
      "INSERT INTO public.user_library_items VALUES($1,$2,'Private notes','Only explicitly shared notes')",
      [LIB, A],
    );
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260905031401_custom_conversational_kovas.sql",
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
const mutate = (
  db,
  action,
  payload = {},
  prior = null,
  {
    actor = A,
    mutation = crypto.randomUUID(),
    limit = 10000000,
    requestedAt = new Date().toISOString(),
  } = {},
) =>
  rpc(db, "mutate_custom_kova", [
    actor,
    prior?.id ?? null,
    mutation,
    prior?.revision ?? 0,
    action,
    payload,
    limit,
    requestedAt,
  ]);
const read = (db, id, actor = A, scope = "read") =>
  rpc(db, "read_custom_kovas", [actor, scope, id, null]);
const context = (db, id, actor = A, version = null) =>
  rpc(db, "resolve_custom_kova", [actor, id, version]);

test("private Kovas have actual owner RLS, immutable versions and no service-role Auth table dependency", async () => {
  const db = await fixture();
  try {
    const created = await mutate(db, "create", { config: config() });
    assert.equal((await read(db, created.id)).config.instructions, "Help improve clarity.");
    await assert.rejects(read(db, created.id, B), /unavailable/);
    await assert.rejects(context(db, created.id, B), /unavailable/);
    await db.exec("SET ROLE service_role");
    await assert.rejects(db.query("SELECT * FROM auth.users"), /permission denied/);
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [B]);
    await db.exec("SET ROLE authenticated");
    assert.equal((await db.query("SELECT * FROM public.custom_kova_versions")).rows.length, 0);
    await assert.rejects(
      db.query("UPDATE public.custom_kovas SET visibility='public'"),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
test("publishing shares the exact reviewed snapshot and owner edits do not silently change a published Kova", async () => {
  const db = await fixture();
  try {
    const created = await mutate(db, "create", {
      config: config({ knowledge: [{ kind: "library", id: LIB }] }),
    });
    await assert.rejects(
      mutate(
        db,
        "publish",
        { visibility: "public", versionId: created.versionId, consent: crypto.randomUUID() },
        created,
      ),
      /publish_denied/,
    );
    const pub = await mutate(
      db,
      "publish",
      { visibility: "public", versionId: created.versionId, consent: created.versionId },
      created,
    );
    assert.equal(
      (await context(db, pub.id, B)).knowledge[0].content,
      "Only explicitly shared notes",
    );
    const saved = await mutate(
      db,
      "save",
      { config: config({ instructions: "New private instructions" }) },
      pub,
    );
    assert.equal((await context(db, saved.id, B)).config.instructions, "Help improve clarity.");
    assert.equal((await context(db, saved.id)).config.instructions, "New private instructions");
    await assert.rejects(context(db, saved.id, B, saved.versionId), /retired/);
    const metadata = await read(db, pub.id, B);
    assert.equal(metadata.config.instructions, undefined);
    assert.equal(metadata.config.knowledge, undefined);
    assert.equal(metadata.knowledge[0].content, undefined);
    await mutate(db, "unpublish", {}, saved);
    await assert.rejects(context(db, saved.id, B), /unavailable/);
  } finally {
    await db.close();
  }
});
test("a link grant is scoped to its verified viewer and publication epoch, not an author app or Library permission", async () => {
  const db = await fixture();
  try {
    const created = await mutate(db, "create", { config: config({ apps: ["gmail"] }) }),
      hash = "a".repeat(64);
    const pub = await mutate(
      db,
      "publish",
      {
        visibility: "link",
        versionId: created.versionId,
        consent: created.versionId,
        linkHash: hash,
      },
      created,
    );
    await assert.rejects(context(db, pub.id, B), /unavailable/);
    await mutate(db, "claimLink", { linkHash: hash }, { id: pub.id, revision: 0 }, { actor: B });
    assert.equal((await context(db, pub.id, B)).config.apps[0], "gmail");
    const edited = await mutate(db, "save", { config: config() }, pub);
    await mutate(db, "claimLink", { linkHash: hash }, { id: pub.id, revision: 0 }, { actor: B });
    await mutate(
      db,
      "publish",
      {
        visibility: "link",
        versionId: edited.versionId,
        consent: edited.versionId,
        linkHash: "b".repeat(64),
      },
      edited,
    );
    await assert.rejects(context(db, pub.id, B), /unavailable/);
  } finally {
    await db.close();
  }
});
test("foreign Library knowledge cannot be copied; allowed forks copy published bytes into a private version without retaining source grants", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      mutate(
        db,
        "create",
        { config: config({ knowledge: [{ kind: "library", id: LIB }] }) },
        null,
        { actor: B },
      ),
      /knowledge_unavailable/,
    );
    const created = await mutate(db, "create", {
      config: config({ allowFork: true, knowledge: [{ kind: "library", id: LIB }] }),
    });
    const pub = await mutate(
      db,
      "publish",
      { visibility: "public", versionId: created.versionId, consent: created.versionId },
      created,
    );
    const copied = await mutate(db, "fork", { consent: created.versionId }, pub, { actor: B });
    assert.equal(copied.visibility, "private");
    const view = await read(db, copied.id, B);
    assert.equal(view.config.knowledge[0].kind, "text");
    assert.equal(view.config.knowledge[0].id, undefined);
    await db.query("DELETE FROM auth.users WHERE id=$1", [A]);
    assert.equal(
      (await context(db, copied.id, B)).knowledge[0].content,
      "Only explicitly shared notes",
    );
  } finally {
    await db.close();
  }
});
test("revision and receipt replay bound quota; delete releases every version and account fencing prevents new writes", async () => {
  const db = await fixture();
  try {
    const mutation = crypto.randomUUID(),
      requestedAt = new Date().toISOString(),
      payload = { config: config() };
    const created = await mutate(db, "create", payload, null, { mutation, requestedAt });
    assert.deepEqual(await mutate(db, "create", payload, null, { mutation, requestedAt }), created);
    assert.equal(
      (await db.query("SELECT count(*) n FROM public.custom_kova_versions")).rows[0].n,
      1,
    );
    await assert.rejects(mutate(db, "save", payload, { ...created, revision: 0 }), /conflict/);
    const saved = await mutate(db, "save", payload, created);
    await mutate(db, "delete", {}, saved);
    assert.equal(
      (await db.query("SELECT bytes_used FROM public.user_storage WHERE user_id=$1", [A])).rows[0]
        .bytes_used,
      0,
    );
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [A]);
    await assert.rejects(mutate(db, "create", payload), /denied/);
  } finally {
    await db.close();
  }
});

test("expired immutable requests cannot recreate deleted Kovas after receipt cleanup", async () => {
  const db = await fixture();
  try {
    const mutation = crypto.randomUUID(),
      requestedAt = new Date().toISOString(),
      payload = { config: config() };
    const created = await mutate(db, "create", payload, null, { mutation, requestedAt });
    await mutate(db, "delete", {}, created);
    await db.query("DELETE FROM public.custom_kova_mutations WHERE owner_id=$1", [A]);
    const expired = new Date(Date.now() - 9 * 86400000).toISOString();
    await assert.rejects(
      mutate(db, "create", payload, null, { mutation, requestedAt: expired }),
      /request_expired/,
    );
    assert.equal((await db.query("SELECT count(*) n FROM public.custom_kovas")).rows[0].n, 0);
    await assert.rejects(
      mutate(db, "create", payload, null, {
        requestedAt: new Date(Date.now() + 3600000).toISOString(),
      }),
      /request_expired/,
    );
  } finally {
    await db.close();
  }
});

test("moderation revokes execution and link grants; report evidence survives deletion of old versions", async () => {
  const db = await fixture();
  try {
    const created = await mutate(db, "create", { config: config() });
    const pub = await mutate(
      db,
      "publish",
      { visibility: "public", versionId: created.versionId, consent: created.versionId },
      created,
    );
    await mutate(db, "report", { reason: "Review this published instruction." }, pub, { actor: B });
    await mutate(db, "report", { reason: "A separate report must remain open." }, pub, {
      actor: B,
    });
    const saved = await mutate(
      db,
      "save",
      { config: config({ name: "Current private name" }) },
      pub,
    );
    const current = await mutate(
      db,
      "publish",
      { visibility: "public", versionId: saved.versionId, consent: saved.versionId },
      saved,
    );
    const removed = await mutate(db, "deleteVersion", { versionId: created.versionId }, current);
    const reports = await rpc(db, "read_custom_kova_reports", [B]);
    assert.equal(reports.rows[0].name, "Writing Kova");
    assert.equal(reports.rows[0].version_id, created.versionId);
    const inspect = await rpc(db, "read_custom_kova_moderation", [B, pub.id]);
    assert.equal(inspect.config.name, "Current private name");
    const blocked = await rpc(db, "moderate_custom_kova", [
      B,
      pub.id,
      removed.revision,
      "block",
      "Reported content removed",
    ]);
    await assert.rejects(context(db, pub.id), /unavailable/);
    assert.equal((await read(db, pub.id)).blocked, true);
    assert.equal((await rpc(db, "read_custom_kova_reports", [B])).rows.length, 2);
    const reviewed = await rpc(db, "moderate_custom_kova", [
      B,
      pub.id,
      blocked.revision,
      "review",
      "Reviewed this exact report",
      reports.rows[0].id,
    ]);
    assert.equal((await rpc(db, "read_custom_kova_reports", [B])).rows.length, 1);
    await assert.rejects(
      rpc(db, "moderate_custom_kova", [B, pub.id, removed.revision, "restore", "Stale decision"]),
      /conflict/,
    );
    await rpc(db, "moderate_custom_kova", [B, pub.id, reviewed.revision, "restore", "Reviewed"]);
    assert.equal((await context(db, pub.id, B)).config.name, "Current private name");
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      db.query("SELECT public.moderate_custom_kova($1,$2,1,'block','forged')", [B, pub.id]),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});

test("private version inspection, restore, capacity and publisher deletion fences stay authoritative", async () => {
  const db = await fixture();
  try {
    const created = await mutate(db, "create", {
      config: config({ instructions: "Original immutable body" }),
    });
    const pub = await mutate(
      db,
      "publish",
      { visibility: "public", versionId: created.versionId, consent: created.versionId },
      created,
    );
    const saved = await mutate(db, "save", { config: config() }, pub);
    const old = await rpc(db, "read_custom_kovas", [
      A,
      "version",
      created.id,
      null,
      created.versionId,
    ]);
    assert.equal(old.config.instructions, "Original immutable body");
    await assert.rejects(
      rpc(db, "read_custom_kovas", [B, "version", created.id, null, created.versionId]),
      /denied/,
    );
    await assert.rejects(
      mutate(db, "deleteVersion", { versionId: created.versionId }, saved),
      /version_in_use/,
    );
    const restored = await mutate(db, "restore", { versionId: created.versionId }, saved);
    assert.notEqual(restored.versionId, created.versionId);
    assert.equal((await context(db, created.id)).config.instructions, "Original immutable body");
    await assert.rejects(
      mutate(db, "save", { config: config() }, restored, { limit: 1 }),
      /storage_limit/,
    );
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [A]);
    await assert.rejects(context(db, created.id, B), /unavailable/);
    assert.equal((await read(db, null, null, "directory")).rows.length, 0);
  } finally {
    await db.close();
  }
});
