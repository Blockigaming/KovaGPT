import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../src/lib/google-account-policy.mjs";

function load(path, dependencies, env = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      process: { env },
      URL,
      URLSearchParams,
      Response,
      Request,
      crypto,
      TextEncoder,
      btoa,
    },
  );
  return exports;
}
const oauth = load(
  "src/lib/google-oauth.server.ts",
  {
    "@/lib/google-oauth-settlement.server.mjs": {},
    "@/lib/lockdown-policy.mjs": {},
    "@supabase/supabase-js": {},
    "@/lib/endpoint-reliability.mjs": {},
    "@/lib/google-account-runtime.server.mjs": {},
    "@/lib/google-account-policy.mjs": policy,
  },
  {
    GOOGLE_OAUTH_CLIENT_ID: "fixture-client",
    GOOGLE_REDIRECT_URI: "https://kova.test/api/google/callback",
  },
);

test("actual OAuth URL requests only the selected Google service plus identity", () => {
  for (const connector of ["gmail", "google-calendar", "google-drive"]) {
    const url = new URL(
      oauth.buildGoogleAuthUrl({
        request: new Request("https://kova.test"),
        connector,
        state: "signed-state",
        codeChallenge: "pkce-challenge",
      }),
    );
    const scopes = url.searchParams.get("scope").split(" ");
    assert.deepEqual(scopes, [
      "openid",
      "email",
      "profile",
      ...policy.GOOGLE_CONNECTOR_SCOPES[connector],
    ]);
    for (const other of Object.keys(policy.GOOGLE_CONNECTOR_SCOPES).filter(
      (key) => key !== connector,
    )) {
      assert.equal(
        policy.GOOGLE_CONNECTOR_SCOPES[other].some((scope) => scopes.includes(scope)),
        false,
      );
    }
    assert.equal(url.searchParams.get("state"), "signed-state");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("access_type"), "offline");
  }
  assert.equal(oauth.GOOGLE_SCOPES, policy.googleConnectorScopes("gmail"));
  assert.throws(() => oauth.buildGoogleAuthUrl({ connector: "all" }), /google_invalid_connector/);
});

test("Gmail-only grants cannot enable Calendar or Drive tools", () => {
  const scopes = policy.googleConnectorScopes("gmail");
  assert.equal(policy.hasGoogleCapability(scopes, "gmail.read"), true);
  assert.equal(policy.hasGoogleCapability(scopes, "gmail.draft"), true);
  for (const capability of ["calendar.read", "calendar.write", "drive.read"])
    assert.equal(policy.hasGoogleCapability(scopes, capability), false);
});

test("actual auth endpoint validates connector before starting an OAuth attempt", async () => {
  const calls = [];
  const handler = load(
    "src/routes/api/google/auth.ts",
    {
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      "@/lib/api-auth.server": {
        requireUser: async () => ({ userId: "owner", supabaseAdmin: {} }),
      },
      "@/lib/google-oauth.server": {
        beginGoogleOAuth: async (...args) => {
          calls.push(args);
          return {};
        },
        buildGoogleAuthUrl: oauth.buildGoogleAuthUrl,
      },
      "@/lib/google-rate-limit.server": { enforceGoogleRateLimit: async () => null },
      "@/lib/lockdown-policy.mjs": { enforceLockdownCapability: async () => null },
      "@/lib/google-account-policy.mjs": policy,
    },
    {
      GOOGLE_OAUTH_CLIENT_ID: "client",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_REDIRECT_URI: "https://kova.test/api/google/callback",
      CONNECTOR_ENCRYPTION_KEY: "fixture",
      SUPABASE_SERVICE_ROLE_KEY: "fixture",
    },
  ).Route.server.handlers.GET;
  const invalid = await handler({
    request: new Request("https://kova.test/api/google/auth?connector=all"),
  });
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);
  for (const connector of ["gmail", "google-calendar", "google-drive"]) {
    const result = await handler({
      request: new Request(`https://kova.test/api/google/auth?connector=${connector}`),
    });
    assert.equal(result.status, 200);
    assert.equal(
      new URL((await result.json()).url).searchParams.get("scope"),
      policy.googleConnectorScopes(connector),
    );
    assert.match(result.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  }
});

test("actual chat Google-tool gate permits signed-in Default while retaining context isolation", () => {
  const source = readFileSync("src/routes/api/chat.ts", "utf8");
  const expression = source.slice(
    source.indexOf("const googleContext =") + "const googleContext =".length,
    source.indexOf("? ((await preflight.run", source.indexOf("const googleContext =")),
  );
  const enabled = (input) =>
    vm.runInNewContext(`Boolean(${expression})`, {
      selectedHostedTool: null,
      auth: { userId: "owner" },
      usesExistingContext: true,
      customKova: null,
      hasAttachments: false,
      m: { id: "instant" },
      lastText: "Find my latest email",
      ...input,
    });
  assert.equal(enabled({}), true);
  for (const input of [
    { auth: null },
    { usesExistingContext: false },
    { hasAttachments: true },
    { selectedHostedTool: "web_search" },
    { customKova: { config: { apps: [] } } },
  ])
    assert.equal(enabled(input), false);
});
