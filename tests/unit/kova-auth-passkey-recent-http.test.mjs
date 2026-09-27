import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { authDatabase, owner } from "../helpers/kova-auth-database.mjs";
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const scalar = new Set([
  "kova_auth_passkey_recent_primary_session",
  "kova_auth_begin_passkey_challenge",
]);

test("a Google-only AAL1 session can start a first passkey until its audited sign-in expires", async () => {
  const db = await authDatabase();
  try {
    const at = new Date().toISOString();
    const expires = new Date(Date.now() + 86400000).toISOString();
    const challengeExpires = new Date(Date.now() + 300000).toISOString();
    const email = "google-only@example.invalid";
    const sessionToken = "g".repeat(43);
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
      owner,
      email,
      at,
    ]);
    await db.query(
      "select * from public.kova_auth_finish_google($1,'google-subject',$2,true,'Owner',$3,$4,$5)",
      [owner, email, digest("handoff"), expires, at],
    );
    const session = (
      await db.query("select * from public.kova_auth_consume_handoff_with_mfa($1,$2,$3,$4,$5,$6)", [
        digest("handoff"),
        digest(sessionToken),
        expires,
        digest("unused-mfa"),
        challengeExpires,
        at,
      ])
    ).rows[0];
    assert.equal(session.assurance_level, "aal1");
    const allowed = new Set([
      "kova_auth_resolve_session",
      "kova_auth_list_passkeys",
      "kova_auth_passkey_recent_primary_session",
      "kova_auth_password_lookup",
      "kova_auth_begin_passkey_challenge",
    ]);
    const harness = authHttp({
      env: { KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test" },
      modules: {
        "@/lib/kova-auth-passkey-crypto.server.mjs": {
          kovaPasskeyRp: (origin) => ({ origin, rpID: "kova.test" }),
          kovaPasskeyRegistrationOptions: async () => ({ challenge: "c".repeat(43) }),
        },
      },
      rpc: async (name, args) => {
        assert.ok(allowed.has(name), name);
        const keys = Object.keys(args);
        try {
          const result = await db.query(
            `select * from public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(",")})`,
            Object.values(args),
          );
          const data = scalar.has(name) ? result.rows[0][name] : result.rows;
          return { data: JSON.parse(JSON.stringify(data)) };
        } catch (error) {
          return { error: { code: error.code, message: error.message } };
        }
      },
    });
    harness.loadModule(
      "@/lib/kova-auth-passkey-store.server",
      "src/lib/kova-auth-passkey-store.server.ts",
    );
    const http = harness.loadModule(
      "@/lib/kova-auth-passkey-http.server",
      "src/lib/kova-auth-passkey-http.server.ts",
    );
    const headers = { "X-Kova-Owner": owner, "X-Kova-Session": session.session_id };
    const request = (body, method = "POST") =>
      authRequest(body, {
        method,
        path: "/api/auth/passkeys",
        token: sessionToken,
        headers,
      });
    const status = await http.handleKovaPasskeyList(request(undefined, "GET"));
    assert.equal(status.status, 200, await status.clone().text());
    const readyStatus = await status.json();
    assert.deepEqual(
      { requiresPassword: readyStatus.requiresPassword, canRegister: readyStatus.canRegister },
      { requiresPassword: false, canRegister: true },
    );
    const start = await http.handleKovaPasskeyRegisterOptions(
      request({ friendlyName: "First device" }),
    );
    assert.equal(start.status, 200, await start.clone().text());
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_passkey_challenges")).rows[0]
        .n,
      1,
    );
    await db.query(
      "update kova_private.auth_audit_events set occurred_at=now()-interval '6 minutes' where session_id=$1 and event_type='oauth_handoff_consumed'",
      [session.session_id],
    );
    const stale = await http.handleKovaPasskeyList(request(undefined, "GET"));
    assert.equal(stale.status, 200);
    const staleStatus = await stale.json();
    assert.equal(staleStatus.requiresPassword, true);
    assert.equal(staleStatus.canRegister, false);
    assert.equal(
      (await http.handleKovaPasskeyRegisterOptions(request({ friendlyName: "Late key" }))).status,
      401,
    );
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_passkey_challenges")).rows[0]
        .n,
      1,
    );
  } finally {
    await db.close();
  }
});
