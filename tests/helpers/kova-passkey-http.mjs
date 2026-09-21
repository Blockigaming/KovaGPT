import assert from "node:assert/strict";
import { authHttp, authRequest } from "./kova-auth-http.mjs";
import * as passkeyCrypto from "../../src/lib/kova-auth-passkey-crypto.server.mjs";

const booleanRpcs = new Set(["kova_auth_begin_passkey_challenge", "kova_auth_rename_passkey"]);
const rpcs = new Set([
  ...booleanRpcs,
  "kova_auth_resolve_session",
  "kova_auth_password_lookup",
  "kova_auth_list_passkeys",
  "kova_auth_claim_passkey_challenge",
  "kova_auth_lookup_passkey",
  "kova_auth_finish_passkey_registration",
  "kova_auth_finish_passkey_login",
  "kova_auth_remove_passkey",
]);

export function passkeyHttp(db, options = {}) {
  const harness = authHttp({
    ...options,
    env: { KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test", ...options.env },
    modules: {
      "@/lib/kova-auth-passkey-crypto.server.mjs": { ...passkeyCrypto, ...options.passkeyCrypto },
    },
    rpc: async (name, args) => {
      assert.ok(rpcs.has(name));
      if (options.beforeRpc) await options.beforeRpc(name, args);
      if (options.rpc) return options.rpc(name, args);
      const keys = Object.keys(args);
      assert.ok(keys.every((key) => /^p_[a-z_]+$/u.test(key)));
      try {
        const result = await db.query(
          `select * from public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")})`,
          Object.values(args),
        );
        const data = booleanRpcs.has(name) ? result.rows[0][name] : result.rows;
        // Reproduce the actual PostgREST JSON boundary, including timestamps.
        return { data: JSON.parse(JSON.stringify(data)) };
      } catch (error) {
        return { error: { code: error.code, message: error.message } };
      }
    },
  });
  const store = harness.loadModule(
    "@/lib/kova-auth-passkey-store.server",
    "src/lib/kova-auth-passkey-store.server.ts",
  );
  return {
    ...harness,
    passkeyStore: store,
    ...harness.loadModule(
      "@/lib/kova-auth-passkey-http.server",
      "src/lib/kova-auth-passkey-http.server.ts",
    ),
  };
}

export function request(body, { binding, token = "s".repeat(43), ...options } = {}) {
  const cookies = [
    token ? `__Host-kova_session=${token}` : "",
    binding ? `__Host-kova_passkey=${binding}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return authRequest(body, { ...options, token, headers: { Cookie: cookies, ...options.headers } });
}
export function cookieValue(response, name) {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(";")[0]
    .slice(name.length + 1);
}
export async function startRegistration(f, currentPassword, token = "s".repeat(43)) {
  const response = await f.handleKovaPasskeyRegisterOptions(
    request({ friendlyName: "My device", currentPassword }, { token }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  return { ...(await response.json()), binding: cookieValue(response, "__Host-kova_passkey") };
}
export async function startLogin(f) {
  const response = await f.handleKovaPasskeyLoginOptions(request({}, { token: "" }));
  assert.equal(response.status, 200, await response.clone().text());
  return { ...(await response.json()), binding: cookieValue(response, "__Host-kova_passkey") };
}