import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, verify } from "node:crypto";
import test from "node:test";
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";
import {
  signKovaCompatibilityJwt,
  digestKovaToken,
} from "../../src/lib/kova-auth-crypto.server.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const sid = "22222222-2222-4222-8222-222222222222";
const token = "s".repeat(43);
const row = {
  account_id: owner,
  session_id: sid,
  email: "owner@example.test",
  email_verified: true,
  assurance_level: "aal2",
  display_name: "Owner",
  expires_at: new Date(Date.now() + 3600000).toISOString(),
};
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const environment = {
  KOVA_AUTH_JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  KOVA_AUTH_JWT_KEY_ID: "source-only-fixture",
  KOVA_AUTH_ISSUER: "https://auth.example.test/",
  KOVA_AUTH_JWT_PUBLIC_KEY_SHA256: createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex"),
};
function fixture(result = { data: [row], error: null }) {
  let signed = 0;
  const http = authHttp({
    rpc: async (name, args) => {
      assert.equal(name, "kova_auth_resolve_session");
      assert.equal(args.p_token_digest_hex, digestKovaToken(token));
      return result;
    },
    crypto: {
      signKovaCompatibilityJwt: (principal) => {
        signed++;
        return signKovaCompatibilityJwt(principal, environment);
      },
    },
  });
  return {
    http,
    signed: () => signed,
    request: (headers) =>
      authRequest(undefined, { path: "/api/auth/token", method: "GET", token, headers }),
  };
}

test("the actual handler/store signs a token and public principal from one bound session resolution", async () => {
  const f = fixture();
  const response = await f.http.handleKovaToken(
    f.request({ "X-Kova-Owner": owner, "X-Kova-Session": sid }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const body = await response.json();
  const [header, payload, signature] = body.accessToken.split(".");
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(body.session.accountId, claims.sub);
  assert.equal(body.session.sessionId, claims.session_id);
  assert.equal(body.session.accountId, owner);
  assert.equal(body.session.sessionId, sid);
  assert.equal(body.expiresIn, 300);
  assert.equal(f.http.calls.length, 1);
  assert.equal(f.signed(), 1);
  assert.equal(response.headers.get("set-cookie"), null);
});

for (const headers of [
  { "X-Kova-Owner": "another-owner" },
  { "X-Kova-Owner": "" },
  { "X-Kova-Session": "another-session" },
  { "X-Kova-Session": "" },
]) {
  test(`bound token issuance rejects changed authority ${JSON.stringify(headers)} before signing`, async () => {
    const f = fixture();
    const response = await f.http.handleKovaToken(f.request(headers));
    assert.equal(response.status, 409);
    assert.equal(f.signed(), 0);
    assert.equal(response.headers.get("set-cookie"), null);
  });
}

test("existing unbound data-token clients retain the same verified token contract", async () => {
  const f = fixture();
  const response = await f.http.handleKovaToken(f.request({}));
  assert.equal(response.status, 200);
  assert.equal(f.signed(), 1);
});

for (const result of [
  { data: [], error: null },
  { data: null, error: { code: "P0001" } },
  { data: null, error: { code: "network_failure" } },
]) {
  test("revoked, absent or unavailable owned authority can never mint a Realtime token", async () => {
    const f = fixture(result);
    const response = await f.http.handleKovaToken(f.request({ "X-Kova-Owner": owner }));
    assert.ok([401, 503].includes(response.status));
    assert.equal(f.signed(), 0);
    assert.equal(f.http.logs.length <= 1, true);
    assert.doesNotMatch(JSON.stringify(f.http.logs), /network_failure|ssssssssssss/);
  });
}

test("token issuance rejects mutation methods before resolving the session", async () => {
  const f = fixture();
  const response = await f.http.handleKovaToken(
    authRequest({}, { path: "/api/auth/token", token }),
  );
  assert.equal(response.status, 405);
  assert.equal(f.http.calls.length, 0);
  assert.equal(f.signed(), 0);
});
