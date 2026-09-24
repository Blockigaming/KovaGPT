import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/lib/kova-auth-passkey-browser.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const challenge = "c".repeat(43);
function fixture(options = {}) {
  const calls = [];
  const response = { id: "device-credential", response: { proof: "synthetic browser response" } };
  const modules = {
    "@simplewebauthn/browser": Object.fromEntries(
      ["startRegistration", "startAuthentication"].map((method) => [
        method,
        async (input) => {
          calls.push([method, JSON.parse(JSON.stringify(input))]);
          if (options.cancel) throw new Error("sensitive browser error");
          return response;
        },
      ]),
    ),
    "@/lib/kova-auth-browser": {
      clearKovaAuthCache: () => calls.push(["clear-cache"]),
      getCachedKovaSession: async () => ({ accountId: "owner", sessionId: "session" }),
      kovaAuthJson: async (path, body) => {
        calls.push(["POST", path, JSON.parse(JSON.stringify(body))]);
        if (path.endsWith("options"))
          return Response.json({
            challengeToken: challenge,
            options: { challenge: options.badChallenge ? "mismatch" : challenge },
          });
        if (options.throw) throw Error("sensitive server error");
        return Response.json(
          options.invalidSession
            ? {}
            : { session: { accountId: "owner", assuranceLevel: "aal2" }, renamed: true },
          { status: options.failure ? 401 : 200 },
        );
      },
      kovaPublicAuthJson: async (path, body) =>
        modules["@/lib/kova-auth-browser"].kovaAuthJson(path, body),
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    Error,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return { ...exports, calls, response };
}

test("browser registration sends password only to start, invokes WebAuthn, verifies challenge and invalidates caches", async () => {
  const f = fixture();
  await f.registerKovaPasskey({ friendlyName: "Device", currentPassword: "only at start" });
  assert.deepEqual(f.calls, [
    [
      "POST",
      "/api/auth/passkeys/register/options",
      { friendlyName: "Device", currentPassword: "only at start" },
    ],
    ["startRegistration", { optionsJSON: { challenge } }],
    [
      "POST",
      "/api/auth/passkeys/register/verify",
      { challengeToken: challenge, response: f.response },
    ],
    ["clear-cache"],
  ]);
});
test("browser discovery sends no email or account selector and never falls back to hosted auth", async () => {
  const f = fixture();
  await f.signInWithKovaPasskey();
  assert.deepEqual(f.calls[0], ["POST", "/api/auth/passkeys/login/options", {}]);
  assert.deepEqual(f.calls[1], ["startAuthentication", { optionsJSON: { challenge } }]);
  assert.deepEqual(f.calls[2], [
    "POST",
    "/api/auth/passkeys/login/verify",
    { challengeToken: challenge, response: f.response },
  ]);
  assert.deepEqual(f.calls[3], ["clear-cache"]);
});
test("cancellation and malformed option payloads cannot submit an unverified browser result", async () => {
  for (const options of [{ cancel: true }, { badChallenge: true }]) {
    const f = fixture(options);
    await assert.rejects(f.signInWithKovaPasskey());
    assert.equal(f.calls.filter(([type]) => type === "POST").length, 1);
    if (options.badChallenge) assert.equal(f.calls.length, 1);
  }
});
test("uncertain, rejected or malformed success responses invalidate cache without claiming success", async () => {
  for (const options of [{ throw: true }, { failure: true }, { invalidSession: true }]) {
    const f = fixture(options);
    await assert.rejects(f.signInWithKovaPasskey());
    assert.deepEqual(f.calls.at(-1), ["clear-cache"]);
  }
});
test("rename and explicit removal carry only key metadata and clear cache across session rotation", async () => {
  const f = fixture();
  await f.renameKovaPasskey("key", "New name");
  await f.removeKovaPasskey("key");
  assert.deepEqual(f.calls, [
    ["POST", "/api/auth/passkeys/rename", { passkeyId: "key", friendlyName: "New name" }],
    ["POST", "/api/auth/passkeys/remove", { passkeyId: "key", confirm: true }],
    ["clear-cache"],
  ]);
});
