import assert from "node:assert/strict";
import test from "node:test";
import { authDatabase, digest, owner } from "../helpers/kova-auth-database.mjs";
import {
  beginPasskey,
  claimPasskey,
  finishRegistration,
} from "../helpers/kova-passkey-database.mjs";
import { passkeyFixture } from "../helpers/kova-passkey-fixture.mjs";

test("passkey completion rechecks recent Google proof and preserves service-only ACL", async () => {
  const db = await authDatabase();
  const at = new Date().toISOString(),
    expires = new Date(Date.now() + 3600000).toISOString();
  try {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'s6-expiry@example.invalid',$2)",
      [owner, at],
    );
    await db.query(
      "select * from public.kova_auth_finish_google($1,'s6-expiry-subject','s6-expiry@example.invalid',true,'S6',$2,$3,$4)",
      [owner, digest("handoff"), expires, at],
    );
    const session = (
      await db.query("select * from public.kova_auth_consume_handoff_with_mfa($1,$2,$3,$4,$5,$6)", [
        digest("handoff"),
        digest("session"),
        expires,
        digest("unused"),
        expires,
        at,
      ])
    ).rows[0];
    await beginPasskey(db, { at });
    await claimPasskey(db, { at });
    // Starting while recently authenticated does not authorize completion after
    // that proof is stale. Keep the challenge valid to isolate this boundary.
    await db.query(
      "update kova_private.auth_audit_events set occurred_at=$2::timestamptz-interval '6 minutes' where session_id=$1",
      [session.session_id, at],
    );
    await assert.rejects(
      finishRegistration(db, { fixture: passkeyFixture(), at, expiresAt: expires }),
      /reauthentication_required/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_passkeys")).rows[0].n,
      0,
    );
    const acl = (
      await db.query(`select has_function_privilege('anon',p.oid,'execute') as anon,
      has_function_privilege('authenticated',p.oid,'execute') as authenticated,
      has_function_privilege('service_role',p.oid,'execute') as service,
      p.proconfig @> array['search_path=""'] as empty_path
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='kova_auth_finish_passkey_registration'`)
    ).rows[0];
    assert.deepEqual(acl, { anon: false, authenticated: false, service: true, empty_path: true });
  } finally {
    await db.close();
  }
});
