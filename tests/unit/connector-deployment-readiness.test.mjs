import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as flows from "../../src/integrations/connection-flows.mjs";
import * as mcp from "../../src/integrations/approved-mcp-servers.server.mjs";
import { OURA_SCOPES } from "../../src/health/oura-metrics.mjs";
import { MASTER_CONNECTORS } from "../../src/lib/connector-master-list.mjs";
import { financeLinkRequest } from "../../src/finances/plaid-request.server.mjs";

function load(path, modules, env) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  new Function("exports", "require", "process", outputText)(
    exports,
    (id) => {
      assert.ok(Object.hasOwn(modules, id), id);
      return modules[id];
    },
    { env },
  );
  return exports;
}

function deployment(env, origin = "https://kovagpt.com") {
  const approvedMcp = {
    approvedMcpServers: () => mcp.approvedMcpServers(env.KOVA_MCP_READ_SERVERS ?? ""),
  };
  const providers = load(
    "src/integrations/oauth-providers.server.ts",
    {
      "./approved-mcp-servers.server.mjs": approvedMcp,
      "./connection-flows.mjs": flows,
      "@/health/oura-metrics.mjs": { OURA_SCOPES },
    },
    env,
  );
  const diagnostics = load(
    "src/integrations/connector-readiness.server.ts",
    {
      "@/lib/connector-master-list.mjs": { MASTER_CONNECTORS },
      "@/lib/google-oauth.server": {
        googleOAuthConfigured: () =>
          [
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "GOOGLE_OAUTH_CLIENT_ID",
            "GOOGLE_OAUTH_CLIENT_SECRET",
            "GOOGLE_REDIRECT_URI",
            "CONNECTOR_ENCRYPTION_KEY",
          ].every((name) => env[name]),
        googleRedirectUri: () => env.GOOGLE_REDIRECT_URI,
      },
      "@/finances/plaid.server": {
        financeConfigured: () => {
          try {
            financeLinkRequest("00000000-0000-4000-8000-000000000001", "US", env);
            return providers.credentialVaultConfigured();
          } catch {
            return false;
          }
        },
      },
      "./oauth-providers.server": providers,
      "./connection-flows.mjs": flows,
      "./approved-mcp-servers.server.mjs": approvedMcp,
    },
    env,
  );
  return diagnostics.connectorDeploymentReadiness(new Request(origin + "/api/admin/diagnostics"));
}

test("connector diagnostics cover the 38 approved entries and identify native and local verification", () => {
  const checks = deployment({});
  assert.deepEqual(
    checks.map(({ id }) => id),
    MASTER_CONNECTORS.map(({ id }) => id),
  );
  assert.equal(checks.length, 38);
  assert.ok(checks.every(({ id }) => id !== "whoop"));
  assert.deepEqual(
    checks
      .filter(({ state }) => state === "native_device_verification_required")
      .map(({ id }) => id),
    ["apple-health", "android-health-connect"],
  );
  assert.equal(checks.find(({ id }) => id === "excalidraw").state, "ready_for_file_verification");
  assert.equal(checks.filter(({ state }) => state === "deployment_setup_required").length, 35);
});

test("provider setup distinguishes a shared Microsoft grant, hosted Tana, API keys and review gates", () => {
  const value = Buffer.alloc(32, 9).toString("base64");
  const env = {
    CONNECTOR_TOKEN_ENCRYPTION_KEY: value,
    MICROSOFT_OAUTH_CLIENT_ID: "microsoft-private-fixture",
    MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret-fixture",
    PLAID_CLIENT_ID: "plaid-private-fixture",
    PLAID_SECRET: "plaid-secret-fixture",
    PLAID_ENV: "sandbox",
    PLAID_WEBHOOK_URL: "https://kovagpt.com/api/finances/webhook",
    AZURE_ENVIRONMENT: "production",
  };
  const checks = deployment(env);
  const get = (id) => checks.find((entry) => entry.id === id);
  for (const id of [
    "outlook",
    "outlook-calendar",
    "ms-teams",
    "onedrive",
    "sharepoint",
    "tana",
    "webull",
    "granola",
    "notion",
  ])
    assert.equal(get(id).state, "ready_for_account_verification");
  assert.deepEqual(get("sp-global").requiredSettings, ["KOVA_SP_GLOBAL_ENABLED"]);
  assert.deepEqual(get("custom-mcp").requiredSettings, ["KOVA_MCP_READ_SERVERS"]);
  assert.ok(get("plaid").requiredSettings.includes("PLAID_ENV"));
  assert.doesNotMatch(JSON.stringify(checks), /private-fixture|secret-fixture|https:\/\//u);
  assert.ok(!JSON.stringify(checks).includes(value));

  const otherOrigin = deployment(env, "https://stage.example.test");
  assert.deepEqual(otherOrigin.find(({ id }) => id === "tana").requiredSettings, [
    "TANA_MCP_CLIENT_ID",
  ]);
});

test("configured Google callbacks must return to the same application origin", () => {
  const env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-role-fixture",
    GOOGLE_OAUTH_CLIENT_ID: "google-client-fixture",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-secret-fixture",
    CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    GOOGLE_REDIRECT_URI: "https://wrong.example.test/api/google/callback",
  };
  const google = (checks) => checks.find(({ id }) => id === "gmail");
  assert.deepEqual(google(deployment(env)).requiredSettings, ["GOOGLE_REDIRECT_URI"]);
  env.GOOGLE_REDIRECT_URI = "https://kovagpt.com/api/google/callback";
  assert.equal(google(deployment(env)).state, "ready_for_account_verification");
  env.GOOGLE_OAUTH_CLIENT_ID = "   ";
  assert.deepEqual(google(deployment(env)).requiredSettings, ["GOOGLE_OAUTH_CLIENT_ID"]);
});
