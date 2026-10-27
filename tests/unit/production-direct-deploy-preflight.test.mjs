import assert from "node:assert/strict";
import test from "node:test";
import {
  createDirectPreflightRunner,
  identifyArmPrincipalObjectId,
  preflightDirectAzureRelease,
  validateDirectPreflightInput,
} from "../../scripts/azure/production-direct-deploy-preflight.mjs";

const subscription = "ab732127-11c3-46a7-a1cb-6ee8d86594f4";
const group = "rg-kovagpt-prod";
const appName = "kovagpt-prod-web";
const target = `/subscriptions/${subscription}/resourceGroups/${group}/providers/Microsoft.App/containerApps/${appName}`;
const revisionName = `${appName}--reviewed`;
const loginServer = "reviewed.azurecr.io";
const currentImage = `${loginServer}/reviewed-web@sha256:${"b".repeat(64)}`;
const origin = "https://kovagpt-prod-web.reviewed.eastus.azurecontainerapps.io";
const currentSha = "a".repeat(40);
const tenant = "18a67414-b56e-4b79-8dc8-435494fcc9be";
const azureClientId = "11111111-2222-3333-4444-555555555555";
const principalObjectId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const tokenMarker = "never-emit-arm-access-token";
const encodeJwt = (claims) =>
  [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    Buffer.from(tokenMarker).toString("base64url"),
  ].join(".");
const input = {
  repository: "Blockigaming/KovaGPT",
  event: "workflow_dispatch",
  ref: "refs/heads/main",
  workflowSha: "c".repeat(40),
  sourceSha: "c".repeat(40),
  confirmation: "PREFLIGHT_DIRECT_AZURE",
  currentSha,
  currentImage,
  acrLoginServer: loginServer,
  imageRepository: "reviewed-web",
  azureClientId,
  origin,
};
const keyVaultSecret = (name) => ({
  name,
  keyVaultUrl: `https://reviewed.vault.azure.net/secrets/${name}/${"d".repeat(32)}`,
  identity: `${target}/identity`,
});
const app = {
  id: target,
  name: appName,
  type: "Microsoft.App/containerApps",
  runningStatus: "Running",
  mode: "Multiple",
  latestRevisionName: revisionName,
  latestReadyRevisionName: revisionName,
  ingress: {
    fqdn: new URL(origin).hostname,
    external: true,
    allowInsecure: false,
    targetPort: 3000,
    additionalPortMappings: [],
    traffic: [{ revisionName, weight: 100 }],
  },
  containers: [
    {
      name: "web",
      image: currentImage,
      env: [
        { name: "AZURE_ENVIRONMENT", value: "production" },
        { name: "KOVA_PRODUCTION_ORIGIN_MODE", value: "azure-direct" },
        { name: "KOVA_AZURE_PUBLIC_ORIGIN", value: origin },
        { name: "OPENAI_API_KEY", secretRef: "openai-api-key" },
        { name: "ELEVENLABS_API_KEY", secretRef: "elevenlabs-api-key" },
        { name: "UNRELATED_PRIVATE_VALUE", value: "never-emit-private-config" },
      ],
    },
  ],
  secrets: [keyVaultSecret("openai-api-key"), keyVaultSecret("elevenlabs-api-key")],
};
const revision = {
  id: `${target}/revisions/${revisionName}`,
  name: revisionName,
  active: true,
  healthState: "Healthy",
  runningState: "Running",
  containers: [{ name: "web", image: currentImage }],
};
const health = {
  ok: true,
  app: "KovaGPT",
  status: "ok",
  service: "kovagpt-web",
  build: currentSha,
};
const version = { sha: currentSha };

function fixture({
  appValue = app,
  secondApp = appValue,
  revisionValue = revision,
  permission = true,
  publicSha = currentSha,
  accountId = subscription,
  tokenClaims = {},
} = {}) {
  const calls = [];
  let appReads = 0;
  const run = async (args) => {
    calls.push(args);
    if (args[0] === "account" && args[1] === "get-access-token") {
      assert.equal(args[args.indexOf("--subscription") + 1], subscription);
      assert.equal(args[args.indexOf("--tenant") + 1], tenant);
      assert.equal(args[args.indexOf("--resource") + 1], "https://management.azure.com/");
      return {
        ok: true,
        stdout: JSON.stringify({
          tokenType: "Bearer",
          subscription,
          tenant,
          accessToken: encodeJwt({
            oid: principalObjectId,
            tid: tenant,
            appid: azureClientId,
            aud: "https://management.azure.com/",
            idtyp: "app",
            exp: Math.floor(Date.now() / 1000) + 1200,
            ...tokenClaims,
          }),
        }),
      };
    }
    if (args[0] === "account") {
      return {
        ok: true,
        stdout: JSON.stringify({
          id: accountId,
          tenantId: tenant,
        }),
      };
    }
    assert.deepEqual(args.slice(0, 3), ["rest", "--method", "get"]);
    const url = args[args.indexOf("--url") + 1];
    const value = url.includes("/permissions?")
      ? {
          value: permission
            ? [{ actions: ["Microsoft.App/containerApps/write"], notActions: [] }]
            : [{ actions: ["Microsoft.App/containerApps/read"], notActions: [] }],
        }
      : url.includes("/revisions/")
        ? revisionValue
        : appReads++ === 0
          ? appValue
          : secondApp;
    return { ok: true, stdout: JSON.stringify(value) };
  };
  const fetcher = async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "manual");
    return new Response(
      JSON.stringify(
        url.endsWith("/api/health")
          ? { ...health, build: publicSha }
          : { ...version, sha: publicSha },
      ),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-kova-build": publicSha,
        },
      },
    );
  };
  return { calls, run, fetcher };
}

test("exact live rollback target, direct ingress and effective write permission produce only a sanitized readiness receipt", async () => {
  const f = fixture();
  const receipt = await preflightDirectAzureRelease(input, f);
  assert.equal(receipt.status, "READY_FOR_SEPARATE_DEPLOY_REVIEW");
  assert.equal(receipt.rollbackRevision, revisionName);
  assert.equal(receipt.principalObjectId, principalObjectId);
  assert.ok(Object.values(receipt.checks).every(Boolean));
  assert.equal(receipt.azureMutations, 0);
  assert.equal(receipt.providerRequests, 0);
  assert.equal(receipt.liveAuthVerified, false);
  assert.equal(receipt.providerGenerationVerified, false);
  assert.equal(f.calls.length, 6);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /never-emit-private-config|never-emit-arm-access-token|keyVaultUrl|secretRef|private/i,
  );
  assert.ok(f.calls.every((args) => args[0] === "account" || args.includes("get")));
});

test("missing resource-scoped write permission still checks app, rollback and public build", async () => {
  const f = fixture({ permission: false });
  const receipt = await preflightDirectAzureRelease(input, f);
  assert.equal(receipt.failureCode, "direct_preflight_app_write_permission_missing");
  assert.deepEqual(receipt.failureCodes, ["direct_preflight_app_write_permission_missing"]);
  assert.equal(receipt.status, "BLOCKED");
  assert.equal(f.calls.length, 6);
  assert.deepEqual(receipt.checks, {
    account: true,
    principalIdentity: true,
    effectiveWrite: false,
    targetAndConfig: true,
    rollbackRevision: true,
    publicBuild: true,
    stableTarget: true,
  });
  assert.equal(receipt.azureMutations, 0);
  assert.equal(receipt.principalObjectId, principalObjectId);
});

test("a wrong client, tenant, audience or expired token never yields an object ID", async () => {
  for (const tokenClaims of [
    { appid: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
    { tid: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
    { aud: "https://graph.microsoft.com/" },
    { exp: Math.floor(Date.now() / 1000) - 60 },
    { idtyp: "user" },
    { scp: "user_impersonation" },
  ]) {
    const receipt = await preflightDirectAzureRelease(input, fixture({ tokenClaims }));
    assert.equal(receipt.checks.principalIdentity, false);
    assert.equal(receipt.principalObjectId, null);
    assert.equal(receipt.failureCode, "direct_preflight_principal_claims_invalid");
    assert.equal(receipt.checks.targetAndConfig, true);
    assert.doesNotMatch(JSON.stringify(receipt), /never-emit-arm-access-token|accessToken/);
  }
  assert.throws(
    () =>
      identifyArmPrincipalObjectId(
        { tokenType: "Bearer", subscription, tenant, accessToken: tokenMarker },
        azureClientId,
      ),
    /principal_token_invalid/,
  );
});

test("independent checks report role, rollback-mode and public-build blockers together", async () => {
  const single = structuredClone(app);
  single.mode = "Single";
  single.containers[0].env.push({
    name: "UNRELATED_PRIVATE_VALUE",
    value: "never-emit-second-secret",
  });
  const f = fixture({ permission: false, appValue: single, publicSha: "e".repeat(40) });
  const receipt = await preflightDirectAzureRelease(input, f);
  assert.deepEqual(receipt.failureCodes, [
    "direct_preflight_app_write_permission_missing",
    "direct_preflight_rollback_mode_not_multiple",
    "direct_preflight_public_build_mismatch",
  ]);
  assert.equal(receipt.checks.stableTarget, true);
  assert.equal(receipt.checks.rollbackRevision, false);
  assert.doesNotMatch(JSON.stringify(receipt), /never-emit-second-secret/);
  assert.equal(receipt.azureMutations, 0);
  assert.ok(f.calls.every((args) => args[0] === "account" || args.includes("get")));
});

test("wrong Azure account stops all resource reads", async () => {
  const f = fixture({
    accountId:
      "f".repeat(8) +
      "-" +
      "f".repeat(4) +
      "-" +
      "f".repeat(4) +
      "-" +
      "f".repeat(4) +
      "-" +
      "f".repeat(12),
  });
  const receipt = await preflightDirectAzureRelease(input, f);
  assert.deepEqual(receipt.failureCodes, ["direct_preflight_azure_account_mismatch"]);
  assert.equal(f.calls.length, 1);
});

test("single revision, wrong provider references and changed rollback traffic all fail closed", async () => {
  for (const [change, failureCode] of [
    [
      (copy) => {
        copy.mode = "Single";
      },
      "direct_preflight_rollback_mode_not_multiple",
    ],
    [
      (copy) => {
        copy.containers[0].env.find((e) => e.name === "OPENAI_API_KEY").value = "raw-private-key";
      },
      "direct_preflight_provider_reference_mismatch",
    ],
    [
      (copy) => {
        copy.ingress.traffic[0].weight = 99;
      },
      "direct_preflight_rollback_traffic_mismatch",
    ],
  ]) {
    const changed = structuredClone(app);
    change(changed);
    const receipt = await preflightDirectAzureRelease(input, fixture({ appValue: changed }));
    assert.equal(receipt.failureCode, failureCode);
    assert.equal(receipt.azureMutations, 0);
    assert.doesNotMatch(JSON.stringify(receipt), /raw-private-key/);
  }
});

test("public build mismatch and a concurrent app change cannot qualify a release", async () => {
  const wrong = await preflightDirectAzureRelease(input, fixture({ publicSha: "e".repeat(40) }));
  assert.equal(wrong.failureCode, "direct_preflight_public_build_mismatch");
  const changed = structuredClone(app);
  changed.ingress.traffic[0].weight = 0;
  const unstable = await preflightDirectAzureRelease(input, fixture({ secondApp: changed }));
  assert.equal(unstable.failureCode, "direct_preflight_target_changed_during_preflight");
});

test("dispatch/input and CLI runner accept only explicit read-only boundary", async () => {
  assert.throws(
    () => validateDirectPreflightInput({ ...input, sourceSha: "f".repeat(40) }),
    /source_invalid/,
  );
  assert.throws(
    () => validateDirectPreflightInput({ ...input, origin: "https://example.com" }),
    /origin_invalid/,
  );
  assert.throws(
    () =>
      validateDirectPreflightInput({
        ...input,
        currentImage: "reviewed.azurecr.io/reviewed-web:latest",
      }),
    /current_image_invalid/,
  );
  let options;
  const runner = createDirectPreflightRunner({
    execute: (_bin, args, given, callback) => {
      options = { args, given };
      callback(null, "{}");
    },
  });
  assert.deepEqual(await runner(["account", "show"]), { ok: true, stdout: "{}" });
  assert.deepEqual(options.args.slice(-3), ["--only-show-errors", "--output", "json"]);
  assert.equal(options.given.timeout, 20_000);
});
