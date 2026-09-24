import assert from "node:assert/strict";
import test from "node:test";
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";

test("public password, recovery, signup and resend posts reject cross-site and non-JSON traffic before quota or database", async () => {
  const h = authHttp({
    rpc: () => {
      throw Error("Unexpected auth database access");
    },
  });
  for (const [handle, path, body] of [
    [h.handleKovaLogin, "/api/auth/login", { email: "owner@example.test", password: "irrelevant" }],
    [h.handleKovaRecoveryRequest, "/api/auth/recovery/request", { email: "owner@example.test" }],
    [
      h.handleKovaRecoveryReset,
      "/api/auth/recovery/reset",
      { token: "invalid", password: "irrelevant" },
    ],
    [
      h.handleKovaSignup,
      "/api/auth/signup",
      { email: "owner@example.test", password: "irrelevant" },
    ],
    [h.handleKovaVerificationResend, "/api/auth/verify/resend", { email: "owner@example.test" }],
  ]) {
    for (const [headers, expected] of [
      [{ Origin: "https://attacker.invalid" }, 403],
      [{ Origin: "", "Sec-Fetch-Site": "cross-site", "Content-Type": "text/plain" }, 403],
      [
        {
          Origin: "",
          "Sec-Fetch-Site": "same-site",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        403,
      ],
      [{ "Content-Type": "text/plain" }, 415],
      [{ "Content-Type": "application/x-www-form-urlencoded" }, 415],
    ]) {
      assert.equal((await handle(authRequest(body, { path, headers }))).status, expected, path);
    }
  }
  assert.equal(h.limits.length, 0);
  assert.equal(h.calls.length, 0);
  await h.handleKovaLogin(authRequest({}, { path: "/api/auth/login" }));
  assert.equal(h.limits[0]?.action, "kova_auth_login");
});
