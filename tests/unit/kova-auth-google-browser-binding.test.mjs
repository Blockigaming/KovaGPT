import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import test from "node:test";
import { authDatabase } from "../helpers/kova-auth-database.mjs";
import { authHttp, postgresTransport } from "../helpers/kova-auth-http.mjs";
import { encryptKovaSecret, decryptKovaSecret } from "../../src/lib/kova-auth-crypto.server.mjs";
const key = randomBytes(32);
const encryption = {
  KOVA_AUTH_ENCRYPTION_KEY: key.toString("base64url"),
  KOVA_AUTH_ENCRYPTION_KEY_SHA256: createHash("sha256").update(key).digest("hex"),
};
const pub = "https://kova.test";
const cookie = (response, name) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(name + "="))
    ?.split(";")[0];
function harness(db, auth = pub) {
  const rpc = postgresTransport(db, [
    "kova_auth_create_oauth_state",
    "kova_auth_consume_oauth_state",
    "kova_auth_create_compatibility_principal",
    "kova_auth_delete_unused_compatibility_principal",
    "kova_auth_finish_google",
    "kova_auth_consume_handoff_with_mfa",
  ]);
  const providerCalls = [];
  const h = authHttp({
    env: {
      KOVA_AUTH_PUBLIC_ORIGIN: pub,
      KOVA_AUTH_ORIGIN: auth,
      KOVA_GOOGLE_CLIENT_ID: "fixture-client",
      KOVA_GOOGLE_CLIENT_SECRET: "fixture-secret",
    },
    crypto: {
      encryptKovaSecret: (value) => encryptKovaSecret(value, encryption),
      decryptKovaSecret: (value) => decryptKovaSecret(value, encryption),
      verifyGoogleIdToken: async () => ({
        subject: "stable-google-subject",
        email: "owner@example.invalid",
        displayName: "Owner",
      }),
    },
    fetch: async (url, options) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(options.method, "POST");
      providerCalls.push(options);
      return Response.json({ id_token: "fixture-signature-checked-by-existing-crypto-tests" });
    },
    rpc: async (name, args) => {
      const result = await rpc(name, args);
      if (
        [
          "kova_auth_create_oauth_state",
          "kova_auth_create_compatibility_principal",
          "kova_auth_delete_unused_compatibility_principal",
        ].includes(name) &&
        result.data
      )
        return { data: result.data[0][name] };
      return JSON.parse(JSON.stringify(result));
    },
  });
  return { ...h, providerCalls, auth };
}
async function journey(h) {
  let response = await h.handleKovaGoogleStart(
    new Request(`${pub}/api/auth/google/start?return_to=%2Fprojects%2Ffixture`, {
      headers: { "sec-fetch-site": "same-origin" },
    }),
  );
  const browser = cookie(response, "__Host-kova_oauth_browser");
  assert.ok(browser);
  if (h.auth !== pub) {
    assert.equal(new URL(response.headers.get("location")).origin, h.auth);
    assert.equal(cookie(response, "__Host-kova_oauth_state"), undefined);
    response = await h.handleKovaGoogleStart(new Request(response.headers.get("location")));
  }
  assert.equal(response.status, 302);
  const stateCookie = cookie(response, "__Host-kova_oauth_state");
  assert.ok(stateCookie);
  const authorize = new URL(response.headers.get("location"));
  assert.equal(authorize.origin, "https://accounts.google.com");
  const callback = await h.handleKovaGoogleCallback(
    new Request(
      `${h.auth}/api/auth/google/callback?state=${authorize.searchParams.get("state")}&code=fixture-code`,
      { headers: { Cookie: stateCookie } },
    ),
  );
  assert.equal(callback.status, 303);
  const exchange = new URL(callback.headers.get("location"));
  assert.equal(exchange.pathname, "/api/auth/google/exchange", JSON.stringify(h.logs));
  assert.ok(exchange.searchParams.get("binding"));
  return { browser, exchange };
}
const exchange = (h, url, browser) =>
  h.handleKovaGoogleExchange(new Request(url, { headers: browser ? { Cookie: browser } : {} }));
function denied(response) {
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location"), /google_handoff_invalid/);
  assert.ok(
    !response.headers
      .getSetCookie()
      .some((value) => /^__Host-kova_(?:session|google_mfa)=/u.test(value)),
  );
}
test("cross-site Google starts are rejected before OAuth state creation", async () => {
  const db = await authDatabase();
  try {
    const h = harness(db);
    for (const headers of [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-origin", origin: "https://attacker.invalid" },
      {},
    ]) {
      const response = await h.handleKovaGoogleStart(
        new Request(`${pub}/api/auth/google/start`, { headers }),
      );
      assert.equal(response.status, 403);
    }
    assert.equal(
      (await db.query("select count(*)::int as n from kova_private.auth_oauth_states")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
for (const auth of [pub, "https://auth.kova.test"])
  test(`Google handoff is host-only browser-bound across ${auth === pub ? "same" : "distinct"} origins and cannot replay`, async () => {
    const db = await authDatabase();
    try {
      const h = harness(db, auth);
      const flow = await journey(h);
      const before = h.calls.length;
      denied(await exchange(h, flow.exchange));
      denied(
        await exchange(
          h,
          flow.exchange,
          "__Host-kova_oauth_browser=" + randomBytes(32).toString("base64url"),
        ),
      );
      assert.equal(h.calls.length, before, "foreign browser cannot even consume the handoff");
      const tampered = new URL(flow.exchange);
      tampered.searchParams.set("return_to", "https://evil.invalid/");
      const response = await exchange(h, tampered, flow.browser);
      assert.equal(response.headers.get("location"), pub + "/projects/fixture");
      assert.ok(cookie(response, "__Host-kova_session"));
      assert.equal(cookie(response, "__Host-kova_oauth_browser"), "__Host-kova_oauth_browser=");
      denied(await exchange(h, flow.exchange, flow.browser));
      assert.equal(
        (await db.query("select count(*)::int n from kova_private.auth_sessions")).rows[0].n,
        1,
      );
      assert.deepEqual(h.logs, []);
    } finally {
      await db.close();
    }
  });

test("missing, transferred, tampered, expired, wrong-origin, wrong-kind and duplicate handoff proofs are denied before database access", async (t) => {
  const db = await authDatabase();
  try {
    const h = harness(db);
    const flow = await journey(h);
    const before = h.calls.length;
    const binding = JSON.parse(
      decryptKovaSecret(flow.exchange.searchParams.get("binding"), encryption),
    );
    for (const [name, change] of [
      ["no binding", (url) => url.searchParams.delete("binding")],
      [
        "tampered ciphertext",
        (url) => url.searchParams.set("binding", "v1.corrupt.corrupt.corrupt"),
      ],
      [
        "different handoff",
        (url) => url.searchParams.set("handoff", randomBytes(32).toString("base64url")),
      ],
      [
        "duplicate handoff",
        (url) => url.searchParams.append("handoff", url.searchParams.get("handoff")),
      ],
      [
        "duplicate binding",
        (url) => url.searchParams.append("binding", url.searchParams.get("binding")),
      ],
      ...[
        ["expired", { issuedAt: Date.now() - 120000, expiresAt: Date.now() - 1 }],
        ["wrong kind", { kind: "google-init" }],
        ["wrong public host", { publicOrigin: "https://elsewhere.invalid" }],
        ["wrong auth host", { authOrigin: "https://elsewhere.invalid" }],
        ["malformed digest", { browserDigest: "x" }],
        ["future", { issuedAt: Date.now() + 60000, expiresAt: Date.now() + 120000 }],
      ].map(([name, override]) => [
        name,
        (url) =>
          url.searchParams.set(
            "binding",
            encryptKovaSecret(JSON.stringify({ ...binding, ...override }), encryption),
          ),
      ]),
    ])
      await t.test(name, async () => {
        const url = new URL(flow.exchange);
        change(url);
        denied(await exchange(h, url, flow.browser));
        assert.equal(h.calls.length, before);
      });
    const response = await exchange(h, flow.exchange, flow.browser);
    assert.ok(
      cookie(response, "__Host-kova_session"),
      "rejected attacks do not consume valid handoff",
    );
  } finally {
    await db.close();
  }
});

test("browser binding is required before issuing a Google MFA challenge, not just before ordinary login", async () => {
  const db = await authDatabase();
  try {
    const h = harness(db);
    const initial = await journey(h);
    await exchange(h, initial.exchange, initial.browser);
    const account = (await db.query("select id from kova_private.auth_accounts")).rows[0].id;
    await db.query("update kova_private.auth_accounts set mfa_required=true where id=$1", [
      account,
    ]);
    await db.query(
      "insert into kova_private.auth_mfa_factors(account_id,factor_type,state,friendly_name,secret_ciphertext,verified_at) values($1,'totp','active','Test',convert_to('test-only-encrypted-factor','utf8'),now())",
      [account],
    );
    const flow = await journey(h);
    const before = h.calls.length;
    denied(await exchange(h, flow.exchange, initial.browser));
    assert.equal(h.calls.length, before);
    const response = await exchange(h, flow.exchange, flow.browser);
    assert.match(response.headers.get("location"), /google_mfa=1/);
    assert.ok(cookie(response, "__Host-kova_google_mfa"));
    assert.equal(cookie(response, "__Host-kova_session"), undefined);
  } finally {
    await db.close();
  }
});

test("an old unbound OAuth state is refused before Google token exchange and account creation", async () => {
  const h = authHttp({
    env: {
      KOVA_AUTH_PUBLIC_ORIGIN: pub,
      KOVA_AUTH_ORIGIN: pub,
      KOVA_GOOGLE_CLIENT_ID: "client",
      KOVA_GOOGLE_CLIENT_SECRET: "secret",
    },
    crypto: { decryptKovaSecret: () => "v".repeat(64) },
    rpc: async () => ({
      data: [
        {
          nonce_digest_hex: "a".repeat(64),
          pkce_verifier_ciphertext: "old-unbound-state",
          return_to: "/",
        },
      ],
    }),
    fetch: () => assert.fail("unbound state must not contact provider"),
  });
  const state = "s".repeat(43);
  const response = await h.handleKovaGoogleCallback(
    new Request(`${pub}/api/auth/google/callback?state=${state}&code=fixture`, {
      headers: { Cookie: `__Host-kova_oauth_state=${state}` },
    }),
  );
  assert.match(response.headers.get("location"), /google_exchange_failed/);
  assert.equal(h.calls.length, 1);
});
