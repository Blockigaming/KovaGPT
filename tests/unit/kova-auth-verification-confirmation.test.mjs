import assert from "node:assert/strict";
import test from "node:test";
import { authHttp } from "../helpers/kova-auth-http.mjs";
import { digestKovaToken } from "../../src/lib/kova-auth-crypto.server.mjs";

const origin = "https://kova.test";
const token = "v".repeat(43);
const reply = [
  {
    account_id: "10000000-0000-4000-8000-000000000001",
    session_id: "20000000-0000-4000-8000-000000000002",
    email: "fixture@example.invalid",
    email_verified: true,
    assurance_level: "aal1",
  },
];

function fixture() {
  return authHttp({
    env: { KOVA_AUTH_PUBLIC_ORIGIN: origin },
    rpc: async (name, args) => {
      if (name === "kova_auth_consume_verification") {
        assert.equal(args.p_verification_digest_hex, digestKovaToken(token));
        return { data: reply };
      }
      assert.equal(name, "kova_auth_revoke_session");
      return { data: true };
    },
  });
}

function request(method = "GET", body, headers = {}) {
  return new Request(`${origin}/api/auth/verify?token=${token}`, {
    method,
    headers: {
      ...(body !== undefined
        ? { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  });
}

test("mail scanner GET and repeat GET never consume or verify a signup", async () => {
  const h = fixture();
  for (let index = 0; index < 2; index++) {
    const response = await h.handleKovaVerification(request());
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/html/u);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy"), /form-action 'self'/u);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(await response.text(), /method="post" action="\/api\/auth\/verify"/u);
  }
  assert.deepEqual(h.calls, []);
});

test("explicit same-origin form POST consumes proof once and requires password login", async () => {
  const h = fixture();
  const response = await h.handleKovaVerification(request("POST", `token=${token}`));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${origin}/?verified=1&sign-in=1`);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(
    h.calls.map(([name]) => name),
    ["kova_auth_consume_verification", "kova_auth_revoke_session"],
  );
});

test("cross-origin and malformed submissions never consume the mailbox proof", async () => {
  const h = fixture();
  for (const body of [`token=${token}&token=${token}`, `token=${token}&extra=1`, "token=short"]) {
    const response = await h.handleKovaVerification(request("POST", body));
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location"), /auth_error=invalid_verification/u);
  }
  const crossSite = await h.handleKovaVerification(
    request("POST", `token=${token}`, { Origin: "https://other.example.invalid" }),
  );
  assert.equal(crossSite.status, 403);
  const unproven = await h.handleKovaVerification(
    request("POST", `token=${token}`, { Origin: "" }),
  );
  assert.equal(unproven.status, 403);
  assert.deepEqual(h.calls, []);
});
