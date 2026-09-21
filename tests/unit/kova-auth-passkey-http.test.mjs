import assert from "node:assert/strict";
import test from "node:test";
import {
  authDatabase,
  passwordAccount,
  digest,
  owner,
  other,
  enableMfa,
} from "../helpers/kova-auth-database.mjs";
import { passkeyFixture } from "../helpers/kova-passkey-fixture.mjs";
import {
  passkeyHttp,
  request,
  cookieValue,
  startRegistration,
  startLogin,
} from "../helpers/kova-passkey-http.mjs";
import { hashKovaPassword } from "../../src/lib/kova-auth-crypto.server.mjs";

const password = "synthetic current password only";
const passwordHash = await hashKovaPassword(password);
async function account(db, id = owner, token = "s".repeat(43)) {
  return passwordAccount(db, { id, token, passwordHash });
}
async function register(db, f, fixture = passkeyFixture()) {
  await account(db);
  const begin = await startRegistration(f, password);
  const response = await f.handleKovaPasskeyRegisterVerify(
    request(
      {
        challengeToken: begin.challengeToken,
        response: fixture.registration(begin.challengeToken),
      },
      { binding: begin.binding },
    ),
  );
  assert.equal(response.status, 200, await response.clone().text());
  return { fixture, response, token: cookieValue(response, "__Host-kova_session") };
}
const count = async (db, table) =>
  Number((await db.query(`select count(*) as n from kova_private.${table}`)).rows[0].n);

test("actual HTTP/store/PostgreSQL and WebAuthn signatures register, discoverably sign in, rename and remove", async () => {
  const db = await authDatabase();
  try {
    const f = passkeyHttp(db);
    const registered = await register(db, f);
    assert.equal((await registered.response.json()).session.assuranceLevel, "aal2");
    assert.notEqual(registered.token, "s".repeat(43));
    assert.equal(
      (await f.handleKovaPasskeyList(request(undefined, { method: "GET" }))).status,
      401,
    );
    const list = await f.handleKovaPasskeyList(
      request(undefined, { method: "GET", token: registered.token }),
    );
    assert.equal(list.headers.get("Cache-Control"), "no-store");
    const body = await list.json();
    assert.equal(body.passkeys.length, 1);
    assert.equal(body.canRegister, true);
    assert.equal(body.canRemove, true);
    assert.equal(body.requiresPassword, false);
    for (const denied of [
      registered.fixture.key.credentialId,
      registered.fixture.key.publicKeyHex,
      registered.fixture.key.userHandle,
    ]) {
      assert.ok(!JSON.stringify(body).includes(denied));
    }
    const begin = await startLogin(f);
    assert.equal(begin.options.allowCredentials.length, 0);
    assert.equal(begin.options.userVerification, "required");
    const assertion = registered.fixture.authentication(begin.challengeToken, { counter: 1 });
    const login = await f.handleKovaPasskeyLoginVerify(
      request(
        { challengeToken: begin.challengeToken, response: assertion },
        { binding: begin.binding, token: "" },
      ),
    );
    assert.equal(login.status, 200, await login.clone().text());
    assert.equal((await login.json()).session.accountId, owner);
    const token = cookieValue(login, "__Host-kova_session");
    for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
      assert.ok(login.headers.get("set-cookie").includes(part));
    assert.equal(cookieValue(login, "__Host-kova_passkey"), "");
    assert.equal(
      (
        await f.handleKovaPasskeyLoginVerify(
          request(
            { challengeToken: begin.challengeToken, response: assertion },
            { binding: begin.binding },
          ),
        )
      ).status,
      401,
    );
    const keyId = body.passkeys[0].id;
    assert.equal(
      (
        await f.handleKovaPasskeyRename(
          request({ passkeyId: keyId, friendlyName: "Renamed device" }, { token }),
        )
      ).status,
      200,
    );
    const removed = await f.handleKovaPasskeyRemove(
      request({ passkeyId: keyId, confirm: true }, { token }),
    );
    assert.equal(removed.status, 200, await removed.clone().text());
    assert.equal((await removed.json()).session.assuranceLevel, "aal1");
    assert.equal(
      (await f.handleKovaPasskeyList(request(undefined, { method: "GET", token }))).status,
      401,
    );
    const next = await startLogin(f);
    const disabledLogin = await f.handleKovaPasskeyLoginVerify(
      request(
        {
          challengeToken: next.challengeToken,
          response: registered.fixture.authentication(next.challengeToken, { counter: 2 }),
        },
        { binding: next.binding, token: "" },
      ),
    );
    assert.equal(disabledLogin.status, 401);
    const serialized = JSON.stringify({ calls: f.calls, limits: f.limits, logs: f.logs });
    assert.ok(!serialized.includes(password));
    assert.ok(!serialized.includes(registered.token));
    assert.equal(f.logs.length, 0);
  } finally {
    await db.close();
  }
});

test("password reauthentication is mandatory for AAL1 registration, while AAL2 uses the verified owner", async () => {
  const db = await authDatabase();
  try {
    await account(db);
    const f = passkeyHttp(db);
    for (const body of [
      {},
      { currentPassword: "wrong" },
      { currentPassword: 100 },
      { currentPassword: "x".repeat(1025) },
    ]) {
      assert.equal((await f.handleKovaPasskeyRegisterOptions(request(body))).status, 401);
    }
    assert.equal(await count(db, "auth_passkey_challenges"), 0);
    const status = await (
      await f.handleKovaPasskeyList(request(undefined, { method: "GET" }))
    ).json();
    assert.equal(status.requiresPassword, true);
    assert.equal(status.canRegister, true);
    await enableMfa(db, "s".repeat(43), "t".repeat(43));
    const begin = await f.handleKovaPasskeyRegisterOptions(
      request({ friendlyName: "Security key" }, { token: "t".repeat(43) }),
    );
    assert.equal(begin.status, 200, await begin.clone().text());
    assert.match(
      begin.headers.get("set-cookie"),
      /^__Host-kova_passkey=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=300; HttpOnly; Secure; SameSite=Strict$/u,
    );
    const args = f.calls.filter(([name]) => name === "kova_auth_begin_passkey_challenge").at(-1)[1];
    assert.equal(args.p_password_credential_id, null);
    assert.equal(args.p_password_revision, null);
    assert.equal(args.p_rp_id, "kova.test");
  } finally {
    await db.close();
  }
});

test("browser binding, actual password revision, and credential ownership survive separated verification requests", async () => {
  const db = await authDatabase();
  try {
    await account(db);
    await account(db, other, "o".repeat(43));
    const f = passkeyHttp(db);
    const begin = await startRegistration(f, password);
    const response = passkeyFixture().registration(begin.challengeToken);
    const body = { challengeToken: begin.challengeToken, response };
    for (const options of [
      {},
      { binding: "b".repeat(43) },
      { binding: begin.binding, token: "o".repeat(43) },
    ]) {
      assert.equal((await f.handleKovaPasskeyRegisterVerify(request(body, options))).status, 401);
    }
    await db.query(
      `update kova_private.auth_credentials set revision=revision+1 where account_id=$1`,
      [owner],
    );
    const stale = await f.handleKovaPasskeyRegisterVerify(
      request(body, { binding: begin.binding }),
    );
    assert.equal(stale.status, 401);
    assert.equal(await count(db, "auth_passkeys"), 0);
    assert.equal(f.logs.length, 0);
  } finally {
    await db.close();
  }
});

test("unknown, malformed, forged, wrong-origin, replayed and expired passkey proofs fail identically without logging", async () => {
  const db = await authDatabase();
  try {
    const f = passkeyHttp(db);
    const registered = await register(db, f);
    let message;
    for (const scenario of [
      "unknown",
      "malformed",
      "signature",
      "origin",
      "uv",
      "expired",
      "handle",
      "claim-replay",
    ]) {
      const begin = await startLogin(f);
      let assertion = registered.fixture.authentication(begin.challengeToken, { counter: 1 });
      if (scenario === "unknown") assertion = passkeyFixture().authentication(begin.challengeToken);
      if (scenario === "malformed") assertion = { id: 42 };
      if (scenario === "signature") assertion.response.signature = "A".repeat(96);
      if (scenario === "origin")
        assertion = registered.fixture.authentication(begin.challengeToken, {
          origin: "https://attacker.invalid",
          counter: 1,
        });
      if (scenario === "uv")
        assertion = registered.fixture.authentication(begin.challengeToken, {
          flags: 1,
          counter: 1,
        });
      if (scenario === "expired")
        await db.query(
          `update kova_private.auth_passkey_challenges set created_at=created_at-interval '10 minutes',expires_at=expires_at-interval '10 minutes' where token_digest=decode($1,'hex')`,
          [digest(begin.challengeToken)],
        );
      if (scenario === "handle") assertion.response.userHandle = "bad-owner";
      if (scenario === "claim-replay") {
        await f.handleKovaPasskeyLoginVerify(
          request(
            { challengeToken: begin.challengeToken, response: {} },
            { binding: begin.binding },
          ),
        );
      }
      const failure = await f.handleKovaPasskeyLoginVerify(
        request(
          { challengeToken: begin.challengeToken, response: assertion },
          { binding: begin.binding },
        ),
      );
      assert.equal(failure.status, 401, scenario);
      const text = await failure.text();
      message ??= text;
      assert.equal(text, message);
      assert.equal(failure.headers.get("Cache-Control"), "no-store");
    }
    assert.equal(await count(db, "auth_sessions"), 2);
    assert.equal(f.logs.length, 0);
  } finally {
    await db.close();
  }
});

test("cross-site, missing origin, wrong methods, invalid media, account selectors and large bodies stop before database writes", async () => {
  const f = passkeyHttp(null, {
    rpc: () => {
      throw new Error("Unexpected database access");
    },
  });
  for (const [body, options, expected] of [
    [{}, { headers: { Origin: "https://attacker.invalid" } }, 403],
    [{}, { headers: { Origin: "" } }, 403],
    [{}, { headers: { "Sec-Fetch-Site": "cross-site" } }, 403],
    [{}, { method: "GET" }, 405],
    [{}, { headers: { "Content-Type": "text/plain" } }, 415],
    [{ accountId: owner }, {}, 400],
    [[], {}, 400],
    [{}, { raw: '{"padding":"' + "x".repeat(17000) + '"}' }, 413],
  ])
    assert.equal((await f.handleKovaPasskeyLoginOptions(request(body, options))).status, expected);
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await passkeyHttp(null, { mode: "supabase" }).handleKovaPasskeyLoginOptions(request({})))
      .status,
    404,
  );
  assert.equal(
    (
      await passkeyHttp(null, {
        env: { KOVA_AUTH_PUBLIC_ORIGIN: "http://kova.test" },
      }).handleKovaPasskeyLoginOptions(request({}))
    ).status,
    503,
  );
});

test("shared throttling fails closed, account throttling uses only the verified account", async () => {
  for (const [status, expected] of [
    ["limited", 429],
    ["unavailable", 503],
  ]) {
    const f = passkeyHttp(null, { limit: () => ({ allowed: false, status, retryAfter: 60 }) });
    const response = await f.handleKovaPasskeyLoginOptions(request({}));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("Retry-After"), "60");
    assert.equal(f.calls.length, 0);
  }
  const db = await authDatabase();
  try {
    await account(db);
    const f = passkeyHttp(db, {
      limit: (input) =>
        input.action.endsWith("_account")
          ? { allowed: false, status: "limited" }
          : { allowed: true },
    });
    assert.equal(
      (await f.handleKovaPasskeyRegisterOptions(request({ currentPassword: password }))).status,
      429,
    );
    assert.equal(f.limits.at(-1).identity, `account:${owner}`);
    assert.equal(await count(db, "auth_passkey_challenges"), 0);
  } finally {
    await db.close();
  }
});

test("state invalidated after real signature verification cannot finish signing in", async () => {
  const db = await authDatabase();
  try {
    const plain = passkeyHttp(db);
    const { fixture } = await register(db, plain);
    const f = passkeyHttp(db, {
      beforeRpc: async (name) => {
        if (name === "kova_auth_finish_passkey_login")
          await db.query(
            `update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1`,
            [owner],
          );
      },
    });
    const begin = await startLogin(f);
    const login = await f.handleKovaPasskeyLoginVerify(
      request(
        {
          challengeToken: begin.challengeToken,
          response: fixture.authentication(begin.challengeToken, { counter: 1 }),
        },
        { binding: begin.binding },
      ),
    );
    assert.equal(login.status, 401);
    assert.ok(f.calls.some(([name]) => name === "kova_auth_finish_passkey_login"));
    assert.equal(
      (await db.query(`select sign_count from kova_private.auth_passkeys`)).rows[0].sign_count,
      0,
    );
  } finally {
    await db.close();
  }
});

test("store wrappers reject malformed authority rows rather than granting sessions", async () => {
  for (const data of [
    null,
    {},
    [null],
    [{ account_id: owner }],
    [{ passkey_id: owner, account_id: owner, revision: Number.MAX_SAFE_INTEGER + 1 }],
  ]) {
    const f = passkeyHttp(null, { rpc: () => ({ data }) });
    await assert.rejects(f.passkeyStore.lookupPasskey("credential"));
  }
});