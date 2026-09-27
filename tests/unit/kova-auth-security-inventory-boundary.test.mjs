import assert from "node:assert/strict";
import test from "node:test";
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";

function fixture(accountId = owner) {
  return authHttp({
    rpc: async (name) => {
      if (name === "kova_auth_resolve_session")
        return {
          data: [
            {
              account_id: accountId,
              session_id: sessionId,
              email: "fixture@example.invalid",
              email_verified: true,
              assurance_level: "aal2",
            },
          ],
        };
      if (name === "kova_auth_list_totp_factors" || name === "kova_auth_password_lookup")
        return { data: [] };
      throw Error(`Unexpected RPC: ${name}`);
    },
  });
}

function request(path, headers = {}) {
  return authRequest(undefined, {
    path,
    method: "GET",
    headers: { "X-Kova-Owner": owner, "X-Kova-Session": sessionId, ...headers },
  });
}

for (const [path, handler, sensitiveRpc] of [
  ["/api/auth/mfa/factors", "handleKovaMfaFactors", "kova_auth_list_totp_factors"],
  ["/api/auth/password", "handleKovaPasswordStatus", "kova_auth_password_lookup"],
]) {
  test(`${path} returns security metadata only to its captured principal`, async () => {
    const f = fixture();
    const response = await f[handler](request(path));
    assert.equal(response.status, 200);
    assert.ok(f.calls.some(([name]) => name === sensitiveRpc));

    for (const headers of [
      { "X-Kova-Owner": other },
      { "X-Kova-Session": other },
      { "X-Kova-Owner": "", "X-Kova-Session": "" },
    ]) {
      const denied = fixture();
      const result = await denied[handler](request(path, headers));
      assert.equal(result.status, 409);
      assert.ok(!denied.calls.some(([name]) => name === sensitiveRpc));
    }

    const switched = fixture(other);
    assert.equal((await switched[handler](request(path))).status, 409);
    assert.ok(!switched.calls.some(([name]) => name === sensitiveRpc));
  });
}
