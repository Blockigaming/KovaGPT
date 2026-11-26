import assert from "node:assert/strict";
import test from "node:test";
import * as recovery from "../../src/lib/kova-recovery-link.mjs";
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";
import { digestKovaToken } from "../../src/lib/kova-auth-crypto.server.mjs";

const token = "t".repeat(43);
const base = "https://kova.test/reset-password";

test("recovery emails use a fragment; the raw bearer is absent from the HTTP target and public response", async () => {
  let payload;
  const h = authHttp({
    env: { KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test", KOVA_EMAIL_QUEUE_ENABLED: "true" },
    rpc: async (name, args) => {
      assert.equal(name, "kova_auth_create_recovery");
      payload = args;
      return { data: true };
    },
  });
  const response = await h.handleKovaRecoveryRequest(
    authRequest({ email: "owner@example.test" }, { path: "/api/auth/recovery/request" }),
  );
  assert.equal(response.status, 202);
  const link = new URL(
    payload.p_email_payload.text.match(/^Reset password: (https:\/\/\S+)$/mu)[1],
  );
  assert.equal(link.origin + link.pathname + link.search, base);
  const value = new URLSearchParams(link.hash.slice(1)).get("token");
  assert.match(value, /^[A-Za-z0-9_-]{43,128}$/u);
  assert.equal(digestKovaToken(value), payload.p_recovery_digest_hex);
  assert.ok(!JSON.stringify([...h.logs, await response.json()]).includes(value));
});

for (const mode of ["kova", "dual"]) {
  test(`${mode}: fragment-only recovery is accepted, while logged or ambiguous credentials are scrubbed and rejected`, () => {
    assert.deepEqual(recovery.readKovaRecoveryLink(`${base}?lang=en#token=${token}`, mode), {
      owned: true,
      token,
      cleanPath: "/reset-password?lang=en",
    });
    for (const suffix of [
      `?token=${token}`,
      `?token=${token}#token=${token}`,
      `#token=${token}&token=${token}`,
      "#token=short",
      `#token=${token}&access_token=other`,
      "#token=",
      `?token=a&token=b`,
    ]) {
      const result = recovery.readKovaRecoveryLink(base + suffix, mode);
      assert.equal(result.owned, true);
      assert.equal(result.token, null);
      assert.equal(result.cleanPath, "/reset-password");
    }
  });
}
test("pure Kova never starts hosted recovery; dual mode without a Kova credential retains legacy recovery", () => {
  assert.equal(recovery.readKovaRecoveryLink(base, "kova").owned, true);
  assert.equal(recovery.readKovaRecoveryLink(`${base}?code=legacy`, "dual").owned, false);
  assert.equal(recovery.readKovaRecoveryLink(`${base}#token=${token}`, "supabase").token, null);
});
