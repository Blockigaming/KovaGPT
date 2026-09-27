import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  authDatabase,
  passwordAccount,
  pendingFactor,
  codeDigests,
  digest,
  now,
  expiry,
  owner,
} from "../helpers/kova-auth-database.mjs";

const value = async (db, query, args = []) =>
  Object.values((await db.query(query, args)).rows[0])[0];

test("a Google-only account can begin a first passkey only from its recent audited session", async () => {
  const db = await authDatabase();
  try {
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
      owner,
      "google@example.invalid",
      now,
    ]);
    await db.query(
      "select * from public.kova_auth_finish_google($1,'subject',$2,true,'Google Owner',$3,$4,$5)",
      [owner, "google@example.invalid", digest("handoff"), expiry, now],
    );
    const login = (
      await db.query("select * from public.kova_auth_consume_handoff_with_mfa($1,$2,$3,$4,$5,$6)", [
        digest("handoff"),
        digest("google-session"),
        expiry,
        digest("unused-mfa"),
        "2026-09-21T12:05:00Z",
        now,
      ])
    ).rows[0];
    assert.equal(login.assurance_level, "aal1");
    assert.equal(await value(db, "select count(*)::int from kova_private.auth_credentials"), 0);
    assert.equal(
      await value(db, "select public.kova_auth_passkey_recent_primary_session($1,$2)", [
        digest("google-session"),
        now,
      ]),
      true,
    );
    assert.equal(
      await value(
        db,
        "select public.kova_auth_begin_passkey_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          "registration",
          digest("first-key"),
          digest("binding"),
          "kova.test",
          "https://kova.test",
          digest("google-session"),
          null,
          null,
          "First key",
          now,
        ],
      ),
      true,
    );
    const later = "2026-09-21T12:06:00Z";
    assert.equal(
      await value(db, "select public.kova_auth_passkey_recent_primary_session($1,$2)", [
        digest("google-session"),
        later,
      ]),
      false,
    );
    await assert.rejects(
      db.query("select public.kova_auth_begin_passkey_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
        "registration",
        digest("late-key"),
        digest("late-binding"),
        "kova.test",
        "https://kova.test",
        digest("google-session"),
        null,
        null,
        "Late key",
        later,
      ]),
      /kova_auth_reauthentication_required/u,
    );
    assert.equal(
      await value(db, "select count(*)::int from kova_private.auth_passkey_challenges"),
      1,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.kova_auth_passkey_recent_primary_session($1)", [
        digest("google-session"),
      ]),
      /permission denied/u,
    );
  } finally {
    await db.close();
  }
});

test("owned MFA activation retires hosted sessions atomically; retired hosted factors cannot strand factor removal", async () => {
  const db = await authDatabase();
  try {
    await passwordAccount(db);
    await db.query("delete from kova_private.auth_legacy_retirements where account_id=$1", [owner]);
    await db.query("update auth.users set encrypted_password='hosted-password' where id=$1", [
      owner,
    ]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [randomUUID(), owner]);
    const factor = await pendingFactor(db);
    const activate = (next) =>
      db.query("select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)", [
        digest("session"),
        factor,
        codeDigests(),
        digest(next),
        expiry,
        now,
      ]);
    await assert.rejects(activate("session"), /kova_auth_invalid_session/u);
    assert.equal(
      await value(db, "select public.kova_auth_legacy_session_allowed($1)", [owner]),
      true,
    );
    assert.equal(
      await value(db, "select count(*)::int from auth.sessions where user_id=$1", [owner]),
      1,
    );
    const active = (await activate("mfa-session")).rows[0];
    assert.equal(active.assurance_level, "aal2");
    assert.equal(
      await value(db, "select public.kova_auth_legacy_session_allowed($1)", [owner]),
      false,
    );
    assert.equal(
      await value(db, "select count(*)::int from auth.sessions where user_id=$1", [owner]),
      0,
    );
    await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [
      randomUUID(),
      owner,
    ]);
    const removed = (
      await db.query("select * from public.kova_auth_remove_totp_with_session($1,$2,$3,$4,$5)", [
        digest("mfa-session"),
        factor,
        digest("after-removal"),
        expiry,
        now,
      ])
    ).rows[0];
    assert.equal(removed.assurance_level, "aal1");
    assert.equal(
      await value(db, "select mfa_required from kova_private.auth_accounts where id=$1", [owner]),
      false,
    );
    assert.equal(await value(db, "select kova_private.legacy_mfa_required($1)", [owner]), false);
    assert.equal(
      (
        await db.query("select * from public.kova_auth_resolve_session($1,$2)", [
          digest("after-removal"),
          now,
        ])
      ).rows[0].account_id,
      owner,
    );
    assert.equal(await value(db, "select public.kova_auth_legacy_mfa_gap_count($1)", [now]), 0);
  } finally {
    await db.close();
  }
});

test("the forward migration retires hosted authority for already active owned MFA", async () => {
  let prepared = false;
  const db = await authDatabase({
    beforeMigration: async (name, current) => {
      if (name !== "20260927163950_kova_owned_auth_remaining_review_fixes.sql") return;
      await passwordAccount(current);
      await current.query("delete from kova_private.auth_legacy_retirements where account_id=$1", [
        owner,
      ]);
      await current.query(
        "update auth.users set encrypted_password='hosted-password' where id=$1",
        [owner],
      );
      await current.query("insert into auth.sessions(id,user_id) values($1,$2)", [
        randomUUID(),
        owner,
      ]);
      const factor = await pendingFactor(current);
      await current.query(
        "select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)",
        [digest("session"), factor, codeDigests(), digest("mfa-session"), expiry, now],
      );
      assert.equal(
        await value(current, "select public.kova_auth_legacy_session_allowed($1)", [owner]),
        true,
      );
      prepared = true;
    },
  });
  try {
    assert.equal(prepared, true);
    assert.equal(
      await value(db, "select public.kova_auth_legacy_session_allowed($1)", [owner]),
      false,
    );
    assert.equal(
      await value(db, "select count(*)::int from auth.sessions where user_id=$1", [owner]),
      0,
    );
    assert.equal(
      await value(db, "select encrypted_password from auth.users where id=$1", [owner]),
      null,
    );
    assert.equal(
      (
        await db.query("select * from public.kova_auth_resolve_session($1,$2)", [
          digest("mfa-session"),
          now,
        ])
      ).rows[0].account_id,
      owner,
    );
  } finally {
    await db.close();
  }
});
