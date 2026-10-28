import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { authDatabase, digest, now, expiry, owner, other } from "../helpers/kova-auth-database.mjs";

const email = "owner@example.invalid";
const subject = "verified-hosted-google-subject";
const migration = "20261028213000_kova_owned_google_attachment_guard.sql";
const fixture = await readFile(
  new URL("../fixtures/kova-auth-first-release-attachment-20261028.sql", import.meta.url),
  "utf8",
);
const priorGoogle = await readFile(
  new URL("../fixtures/kova-auth-first-release-google-20261028.sql", import.meta.url),
  "utf8",
);
const finish = (db, googleSubject = subject) =>
  db.query("select * from public.kova_auth_finish_google($1,$2,$3,true,'Owner',$4,$5,$6)", [
    other,
    googleSubject,
    email,
    digest("attachment-handoff"),
    expiry,
    now,
  ]);

async function database() {
  return authDatabase({
    async beforeMigration(name, db) {
      if (name === migration) await db.exec(fixture);
    },
  });
}

async function hosted(db, { confirmed = true, banned = false, duplicate = false } = {}) {
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at,banned_until) values($1,$2,$3,$4)",
    [owner, email, confirmed ? now : null, banned ? "infinity" : null],
  );
  await db.query(
    "insert into auth.identities(id,user_id,provider,provider_id,identity_data) values($1,$2,'google',$3,$4)",
    [randomUUID(), owner, subject, { sub: subject }],
  );
  await db.query("insert into auth.users(id,email) values($1,'candidate@example.invalid')", [
    other,
  ]);
  if (duplicate)
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
      randomUUID(),
      email,
      now,
    ]);
}

test("the exact live first-release guard reproduces the approved RPC adoption failure", async () => {
  const db = await authDatabase();
  try {
    await db.exec(fixture);
    await hosted(db);
    await assert.rejects(finish(db), {
      code: "KVA02",
      message: "kova_first_release_hosted_adoption_disabled",
    });
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_accounts")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("same verified Google subject adopts its UUID through the retained live guard", async () => {
  const db = await database();
  try {
    await hosted(db);
    assert.deepEqual((await finish(db)).rows, [{ account_id: owner, candidate_used: false }]);
    assert.deepEqual(
      (await db.query("select id,legacy_supabase_user_id from kova_private.auth_accounts")).rows,
      [{ id: owner, legacy_supabase_user_id: owner }],
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_credentials")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_sessions")).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select tgenabled from pg_trigger where tgname='kova_first_release_owned_attachment'",
        )
      ).rows[0].tgenabled,
      "O",
    );
  } finally {
    await db.close();
  }
});

test("a provisional attachment without the owned verified subject is rolled back at commit", async () => {
  const db = await database();
  try {
    await hosted(db);
    await assert.rejects(
      db.query(
        "insert into kova_private.auth_accounts(id,legacy_supabase_user_id,primary_email,email_verified_at) values($1,$1,$2,$3)",
        [owner, email, now],
      ),
      { code: "KVA02", message: "kova_google_attachment_verified_subject_required" },
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_accounts")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("forged, unverified, disabled or wrong-mailbox owned identities cannot satisfy deferred proof", async (t) => {
  for (const variant of ["wrong-subject", "unverified", "disabled", "wrong-mailbox"]) {
    await t.test(variant, async () => {
      const db = await database();
      try {
        await hosted(db);
        await db.exec("begin");
        await db.query(
          "insert into kova_private.auth_accounts(id,legacy_supabase_user_id,primary_email,email_verified_at) values($1,$1,$2,$3)",
          [owner, email, now],
        );
        await db.query(
          `insert into kova_private.auth_identities(
          account_id,provider,provider_subject,normalized_email,verified_at,disabled_at)
          values($1,'google',$2,$3,$4,$5)`,
          [
            owner,
            variant === "wrong-subject" ? "forged" : subject,
            variant === "wrong-mailbox" ? "other@example.invalid" : email,
            variant === "unverified" ? null : now,
            variant === "disabled" ? now : null,
          ],
        );
        await assert.rejects(db.exec("commit"), { code: "KVA02" });
        await db.exec("rollback");
        assert.equal(
          (await db.query("select count(*)::int n from kova_private.auth_accounts")).rows[0].n,
          0,
        );
      } finally {
        await db.close();
      }
    });
  }
});

test("different subject, unconfirmed mailbox, banned principal and duplicate mailbox stay blocked", async (t) => {
  for (const variant of ["wrong-subject", "unconfirmed", "banned", "duplicate"]) {
    await t.test(variant, async () => {
      const db = await database();
      try {
        await hosted(db, {
          confirmed: variant !== "unconfirmed",
          banned: variant === "banned",
          duplicate: variant === "duplicate",
        });
        await assert.rejects(finish(db, variant === "wrong-subject" ? "other-subject" : subject), {
          code: "KVA02",
        });
        assert.equal(
          (await db.query("select count(*)::int n from kova_private.auth_accounts")).rows[0].n,
          0,
        );
      } finally {
        await db.close();
      }
    });
  }
});

test("helper and deferred trigger functions are not executable by application roles", async () => {
  const db = await database();
  try {
    for (const signature of [
      "kova_private.first_release_google_attachment_matches(uuid,uuid,text,boolean)",
      "kova_private.first_release_check_google_attachment()",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
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
    }
  } finally {
    await db.close();
  }
});

test("an unknown operator guard definition aborts this migration", async () => {
  await assert.rejects(
    authDatabase({
      async beforeMigration(name, db) {
        if (name !== migration) return;
        await db.exec(fixture);
        await db.exec(
          "alter function kova_private.first_release_guard_owned_attachment() set statement_timeout='6s'",
        );
      },
    }),
    { code: "KVA02", message: "kova_google_attachment_guard_baseline_changed" },
  );
});

test("the old mailbox-linking production RPC cannot be paired with the relaxed guard", async () => {
  await assert.rejects(
    authDatabase({
      async beforeMigration(name, db) {
        if (name !== migration) return;
        await db.exec(fixture);
        await db.exec(priorGoogle);
      },
    }),
    { code: "KVA02", message: "kova_google_attachment_subject_rpc_required" },
  );
});

test("inert compatibility candidates retain the fresh Google signup path", async () => {
  const db = await database();
  try {
    const candidate = (
      await db.query("select public.kova_auth_create_compatibility_principal() id")
    ).rows[0].id;
    assert.deepEqual(
      (
        await db.query(
          "select * from public.kova_auth_finish_google($1,'new-google-subject','new@example.invalid',true,'New',$2,$3,$4)",
          [candidate, digest("new-handoff"), expiry, now],
        )
      ).rows,
      [{ account_id: candidate, candidate_used: true }],
    );
  } finally {
    await db.close();
  }
});

test("a password-only attachment cannot consume a hosted Google account", async () => {
  const db = await database();
  try {
    await hosted(db);
    await assert.rejects(
      db.query(
        "select * from public.kova_auth_create_password_account($1,$2,'Owner',$3,$4,$5,'{}'::jsonb,$6)",
        [
          owner,
          email,
          `scrypt-v1$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}`,
          digest("verify"),
          new Date(Date.parse(now) + 30 * 60000).toISOString(),
          now,
        ],
      ),
      { code: "KVA02" },
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_accounts")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_credentials")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("deferred proof observes identity changes through commit and rolls back handoff too", async () => {
  const db = await database();
  try {
    await hosted(db);
    await db.exec("begin");
    await finish(db);
    await db.query(
      "update kova_private.auth_identities set disabled_at=$1 where provider='google'",
      [now],
    );
    await assert.rejects(db.exec("commit"), { code: "KVA02" });
    await db.exec("rollback");
    for (const table of ["auth_accounts", "auth_identities", "auth_session_handoffs"])
      assert.equal(
        (await db.query(`select count(*)::int n from kova_private.${table}`)).rows[0].n,
        0,
      );
  } finally {
    await db.close();
  }
});

test("a second login retains adopted UUID while a fresh subject stays rejected", async () => {
  const db = await database();
  try {
    await hosted(db);
    await finish(db);
    await db.query("delete from kova_private.auth_session_handoffs");
    assert.deepEqual((await finish(db)).rows, [{ account_id: owner, candidate_used: false }]);
    await assert.rejects(finish(db, "unrelated-new-subject"), { code: "KVA02" });
    assert.equal(
      (
        await db.query(
          "select provider_subject from kova_private.auth_identities where provider='google'",
        )
      ).rows[0].provider_subject,
      subject,
    );
  } finally {
    await db.close();
  }
});

test("a caller-supplied future clock cannot bypass a currently banned hosted principal", async () => {
  const db = await database();
  try {
    await hosted(db);
    await db.query("update auth.users set banned_until='2090-01-01' where id=$1", [owner]);
    await assert.rejects(
      db.query(
        "select * from public.kova_auth_finish_google($1,$2,$3,true,'Owner',$4,'2100-01-01','2099-01-01')",
        [other, subject, email, digest("future-clock")],
      ),
      { code: "KVA02" },
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_accounts")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
