import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  authDatabase,
  digest,
  livePasswordAccount,
  other,
  owner,
} from "../helpers/kova-auth-database.mjs";

test("email change requires both proofs and preserves the account while revoking old sessions", async () => {
  const db = await authDatabase({
    beforeMigrations: "create table public.account_deletion_fences(user_id uuid primary key)",
  });
  try {
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20261113020000_kova_verified_email_change.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const oldEmail = "before@example.invalid";
    const newEmail = "after@example.invalid";
    const current = await livePasswordAccount(db, { email: oldEmail });
    const otherSession = await livePasswordAccount(db, { id: other, token: "other-session" });
    const proof = [digest("old-code"), digest("new-code")];
    const call = async (session = current.digest, id = owner, proofs = proof, messages = []) =>
      (
        await db.query("select public.kova_auth_change_email($1,$2,$3,$4,$5,$6,$7) as result", [
          session,
          id,
          newEmail,
          ...proofs,
          ...messages,
          ...Array(2 - messages.length).fill(null),
        ])
      ).rows[0].result;
    const account = async () =>
      (
        await db.query(
          "select primary_email,email_verified_at,session_epoch from kova_private.auth_accounts where id=$1",
          [owner],
        )
      ).rows[0];
    const before = await account();
    assert.equal(await call(otherSession.digest, owner), "session");
    const start = [
      JSON.stringify({ to: oldEmail, purpose: "auth" }),
      JSON.stringify({ to: newEmail, purpose: "auth" }),
    ];
    assert.equal(await call(current.digest, owner, proof, start), "sent");
    const emails = (
      await db.query(
        "select payload->>'to' as address from public.test_email_queue where payload->>'purpose' = 'auth' and payload->>'to' in ($1,$2) order by id desc limit 2",
        [oldEmail, newEmail],
      )
    ).rows.map(({ address }) => address);
    assert.deepEqual(emails, [newEmail, oldEmail]);
    assert.equal(await call(current.digest, owner, [proof[0], digest("wrong")]), "invalid");
    assert.deepEqual(await account(), before);
    assert.equal(await call(), "changed");
    const after = await account();
    assert.equal(after.primary_email, newEmail);
    assert.ok(after.email_verified_at);
    assert.equal(Number(after.session_epoch), Number(before.session_epoch) + 1);
    assert.deepEqual(
      (
        await db.query(
          "select account_id, normalized_email from kova_private.auth_identities where account_id=$1 and provider='email'",
          [owner],
        )
      ).rows,
      [{ account_id: owner, normalized_email: newEmail }],
    );
    assert.equal(
      (await db.query("select * from public.kova_auth_resolve_session($1)", [current.digest])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.kova_auth_resolve_session($1)", [otherSession.digest]))
        .rows.length,
      1,
    );
    assert.equal(await call(), "session");
    const permission = (
      await db.query(
        "select has_function_privilege('authenticated', 'public.kova_auth_change_email(text,uuid,text,text,text,jsonb,jsonb)', 'execute') as allowed",
      )
    ).rows[0];
    assert.equal(permission.allowed, false);
  } finally {
    await db.close();
  }
});
