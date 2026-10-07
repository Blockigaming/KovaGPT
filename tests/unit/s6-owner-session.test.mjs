import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, createHash } from "node:crypto";
import { ownerSession } from "../../scripts/release/s6-owner-session.mjs";
import { ORIGIN } from "../../scripts/release/s6-deployed-checks.mjs";
import { authDatabase, passwordAccount } from "../helpers/kova-auth-database.mjs";
import { authHttp } from "../helpers/kova-auth-http.mjs";
import { passkeyFixture } from "../helpers/kova-passkey-fixture.mjs";
import * as passkeyCrypto from "../../src/lib/kova-auth-passkey-crypto.server.mjs";
import { encryptKovaSecret, decryptKovaSecret } from "../../src/lib/kova-auth-crypto.server.mjs";

test("owner harness completes all API assertions against real handlers, SQL and WebAuthn signatures offline", async () => {
  const db = await authDatabase();
  const key = randomBytes(32);
  const encryption = {
    KOVA_AUTH_ENCRYPTION_KEY: key.toString("base64url"),
    KOVA_AUTH_ENCRYPTION_KEY_SHA256: createHash("sha256").update(key).digest("hex"),
  };
  const expectedEmail = "s6-owner-fixture@example.invalid";
  const expectedAccountId = "10000000-0000-4000-8000-000000000001";
  const initial = await passwordAccount(db, {
    id: expectedAccountId,
    email: expectedEmail,
    at: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  await db.query("select public.kova_auth_revoke_session($1)", [initial.digest]);
  const rpcErrors = [];
  const h = authHttp({
    env: {
      KOVA_AUTH_PUBLIC_ORIGIN: ORIGIN,
      KOVA_AUTH_ORIGIN: ORIGIN,
      KOVA_GOOGLE_CLIENT_ID: "offline-client",
      KOVA_GOOGLE_CLIENT_SECRET: "offline-secret",
    },
    modules: { "@/lib/kova-auth-passkey-crypto.server.mjs": passkeyCrypto },
    crypto: {
      encryptKovaSecret: (s) => encryptKovaSecret(s, encryption),
      decryptKovaSecret: (s) => decryptKovaSecret(s, encryption),
      verifyGoogleIdToken: async () => ({
        subject: "offline-google-subject",
        email: expectedEmail,
        displayName: "S6 fixture",
      }),
    },
    fetch: async (url) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      return Response.json({ id_token: "offline-provider-fixture" });
    },
    rpc: async (name, args) => {
      assert.match(name, /^kova_auth_[a-z_]+$/);
      const keys = Object.keys(args);
      assert.ok(keys.every((x) => /^p_[a-z_]+$/.test(x)));
      try {
        const result = await db.query(
          `select * from public.${name}(${keys.map((x, i) => `${x} => $${i + 1}`).join(",")})`,
          Object.values(args),
        );
        const data =
          result.rows.length === 1 &&
          Object.keys(result.rows[0]).length === 1 &&
          Object.hasOwn(result.rows[0], name)
            ? result.rows[0][name]
            : result.rows;
        return { data: JSON.parse(JSON.stringify(data)) };
      } catch (error) {
        rpcErrors.push({ name, code: error.code, message: error.message });
        return { error: { code: error.code, message: error.message } };
      }
    },
  });
  h.loadModule("@/lib/kova-auth-passkey-store.server", "src/lib/kova-auth-passkey-store.server.ts");
  const p = h.loadModule(
    "@/lib/kova-auth-passkey-http.server",
    "src/lib/kova-auth-passkey-http.server.ts",
  );
  const routes = {
    "/api/auth/google/start": h.handleKovaGoogleStart,
    "/api/auth/google/callback": h.handleKovaGoogleCallback,
    "/api/auth/google/exchange": h.handleKovaGoogleExchange,
    "/api/auth/session": h.handleKovaSession,
    "/api/auth/login": h.handleKovaLogin,
    "/api/auth/logout": h.handleKovaLogout,
    "/api/auth/mfa/enroll": h.handleKovaMfaEnroll,
    "/api/auth/mfa/verify": h.handleKovaMfaVerify,
    "/api/auth/mfa/remove": h.handleKovaMfaRemove,
    "/api/auth/passkeys": p.handleKovaPasskeyList,
    "/api/auth/passkeys/register/options": p.handleKovaPasskeyRegisterOptions,
    "/api/auth/passkeys/register/verify": p.handleKovaPasskeyRegisterVerify,
    "/api/auth/passkeys/login/options": p.handleKovaPasskeyLoginOptions,
    "/api/auth/passkeys/login/verify": p.handleKovaPasskeyLoginVerify,
    "/api/auth/passkeys/rename": p.handleKovaPasskeyRename,
    "/api/auth/passkeys/remove": p.handleKovaPasskeyRemove,
  };
  const cookies = new Map();
  const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  let browserUrl = ORIGIN,
    authorize,
    listener,
    device,
    physicalCalls = 0,
    counter = 0;
  const request = {
    async fetch(url, options = {}) {
      assert.equal(new URL(url).origin, ORIGIN);
      const headers = { cookie: jar(), "content-type": "application/json", ...options.headers };
      const handler = routes[new URL(url).pathname];
      assert.ok(handler, url);
      const r = await handler(
        new Request(url, {
          method: options.method ?? "GET",
          headers,
          body: options.data === undefined ? undefined : JSON.stringify(options.data),
        }),
      );
      for (const item of r.headers.getSetCookie()) {
        const pair = item.split(";")[0],
          at = pair.indexOf("=");
        const name = pair.slice(0, at),
          value = pair.slice(at + 1);
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
      return {
        status: () => r.status,
        json: () => r.json(),
        headers: () => Object.fromEntries(r.headers),
      };
    },
    get(url, opts) {
      return this.fetch(url, opts);
    },
  };
  const page = {
    context: () => ({ request }),
    on: (_event, callback) => {
      listener = callback;
    },
    goto: async (url) => {
      browserUrl = url;
    },
    url: () => browserUrl,
    async evaluate(_function, arg) {
      if (typeof arg === "string") {
        const start = await request.fetch(arg, { headers: { "sec-fetch-site": "same-origin" } });
        assert.equal(start.status(), 302);
        authorize = new URL(start.headers().location);
        return;
      }
      physicalCalls++;
      if (arg.kind === "create")
        device = passkeyFixture({
          accountId: Buffer.from(arg.options.user.id, "base64url").toString(),
        });
      const options = { origin: ORIGIN, rpID: new URL(ORIGIN).hostname, counter: ++counter };
      const result =
        arg.kind === "create"
          ? device.registration(arg.options.challenge, options)
          : device.authentication(arg.options.challenge, options);
      if (arg.kind === "create")
        await passkeyCrypto.verifyKovaPasskeyRegistration(result, {
          challenge: arg.options.challenge,
          origin: ORIGIN,
          rpID: new URL(ORIGIN).hostname,
        });
      return result;
    },
    async waitForURL(predicate) {
      const url =
        ORIGIN +
        "/api/auth/google/callback?state=" +
        authorize.searchParams.get("state") +
        "&code=offline-code";
      const cookie = jar();
      listener({ url: () => url, allHeaders: async () => ({ cookie }) });
      const callback = await request.fetch(url);
      assert.equal(callback.status(), 303);
      const exchange = await request.fetch(callback.headers().location);
      assert.equal(exchange.status(), 303);
      browserUrl = exchange.headers().location;
      assert.equal(predicate(new URL(browserUrl)), true);
    },
  };
  try {
    const receipt = await ownerSession({
      page,
      expectedEmail,
      expectedAccountId,
      deadline: Date.now() + 600000,
      sourceSha: "a".repeat(40),
      runId: "abcdef012345",
    });
    assert.deepEqual(
      receipt.map((x) => x.check),
      ["passkey_registration", "passkey_login_and_removal", "google_callback_and_consent"],
    );
    assert.equal(
      physicalCalls,
      3,
      "only registration and the two actual assertions require an authenticator",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.auth_passkeys where disabled_at is null",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.auth_mfa_factors where disabled_at is null",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.auth_sessions where revoked_at is null",
        )
      ).rows[0].n,
      0,
    );
  } catch (error) {
    throw new Error(
      error.message +
        " SQL diagnostics: " +
        JSON.stringify(rpcErrors) +
        " calls: " +
        h.calls.map(([name]) => name).join(","),
      { cause: error },
    );
  } finally {
    await db.close();
  }
});
