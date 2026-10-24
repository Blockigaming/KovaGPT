import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductionObservationRunner,
  observeProductionRelease,
  productionObservationMain,
  validateProductionObservationPlan,
} from "../../scripts/azure/production-release-observation.mjs";

const now = Date.parse("2026-10-21T00:00:00.000Z");
const plan = {
  version: 1,
  observationId: "11111111-1111-4111-8111-111111111111",
  subscriptionId: "22222222-2222-4222-8222-222222222222",
  resourceGroup: "rg-reviewed-production",
  appName: "reviewed-app",
  containerName: "web",
  revisionName: "reviewed-app--reviewed-sha",
  sourceSha: "a".repeat(40),
  image: `reviewed.azurecr.io/reviewed-web@sha256:${"b".repeat(64)}`,
  origin: "https://reviewed.example",
  createdAt: new Date(now - 1_000).toISOString(),
  expiresAt: new Date(now + 599_000).toISOString(),
};
const target = validateProductionObservationPlan(plan, now).targetId;
const app = {
  id: target,
  name: plan.appName,
  type: "Microsoft.App/containerApps",
  runningStatus: "Running",
  latestRevisionName: plan.revisionName,
  latestReadyRevisionName: plan.revisionName,
  mode: "Single",
  traffic: [{ latestRevision: true, weight: 100 }],
};
const revision = {
  id: `${target}/revisions/${plan.revisionName}`,
  name: plan.revisionName,
  active: true,
  healthState: "Healthy",
  runningState: "Running",
  containers: [{ name: "web", image: plan.image }],
};
const health = {
  ok: true,
  app: "KovaGPT",
  status: "ok",
  service: "kovagpt-web",
  build: plan.sourceSha,
};
const version = { sha: plan.sourceSha, builtAt: new Date(now).toISOString(), version: "1.0.0" };

function json(body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function fixture({
  appValue = app,
  revisionValue = revision,
  publicResponse,
  secondApp = appValue,
} = {}) {
  const calls = [];
  let appReads = 0;
  const run = async (args, options) => {
    calls.push({ kind: "azure", args, options });
    assert.equal(args[2], "get");
    const url = args[args.indexOf("--url") + 1];
    const value = url.includes("/revisions/")
      ? revisionValue
      : appReads++ === 0
        ? appValue
        : secondApp;
    return { ok: true, stdout: JSON.stringify(value) };
  };
  const fetcher = async (url, options) => {
    calls.push({ kind: "public", url, options });
    if (publicResponse) return publicResponse(url, options);
    return url.endsWith("/api/health")
      ? json(health)
      : json(version, { "x-kova-build": plan.sourceSha });
  };
  return { calls, run, fetcher, now: () => now, monotonic: () => 0 };
}

test("exact immutable release is observed without claiming Auth/provider acceptance or changing Azure", async () => {
  const f = fixture();
  const receipt = await observeProductionRelease(plan, f);
  assert.equal(receipt.status, "RELEASE_OBSERVED");
  assert.ok(Object.values(receipt.checks).every(Boolean));
  assert.equal(receipt.sourceSha, plan.sourceSha);
  assert.equal(receipt.image, plan.image);
  assert.equal(receipt.liveAuthVerified, false);
  assert.equal(receipt.providerGenerationVerified, false);
  assert.deepEqual(receipt.operations, {
    azureReadAttempts: 3,
    publicGetAttempts: 2,
    azureMutations: 0,
    providerRequests: 0,
  });
  for (const call of f.calls.filter((entry) => entry.kind === "azure")) {
    const query = call.args[call.args.indexOf("--query") + 1];
    assert.doesNotMatch(query, /secrets|environment|\.env|tokens|keys/iu);
    assert.ok(call.options.timeoutMs > 0 && call.options.timeoutMs <= 20_000);
  }
  const publicCalls = f.calls.filter((entry) => entry.kind === "public");
  assert.deepEqual(
    publicCalls.map((entry) => entry.url),
    ["https://reviewed.example/api/health", "https://reviewed.example/api/version"],
  );
  for (const call of publicCalls) {
    assert.equal(call.options.redirect, "manual");
    assert.equal(call.options.credentials, "omit");
    assert.equal(call.options.method, "GET");
    assert.doesNotMatch(JSON.stringify(call.options.headers), /authorization|cookie|token/iu);
  }
});

test("invalid, expired or credential-bearing plans make no request", async () => {
  for (const change of [
    { origin: "http://reviewed.example" },
    { origin: "https://user:secret@reviewed.example" },
    { origin: "https://reviewed.example/?token=secret" },
    { origin: "https://127.0.0.1" },
    { origin: "https://service.internal" },
    { sourceSha: "unknown" },
    { image: "reviewed.azurecr.io/reviewed-web:latest" },
    { revisionName: "unrelated--revision" },
    { subscriptionId: "wrong" },
    { expiresAt: new Date(now).toISOString() },
    { expiresAt: new Date(now + 601_000).toISOString() },
    { createdAt: new Date(now + 1).toISOString() },
  ]) {
    const f = fixture();
    await assert.rejects(
      observeProductionRelease({ ...plan, ...change }, f),
      /production_observation_/u,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("wrong immutable image fails before public requests", async () => {
  const f = fixture({
    revisionValue: {
      ...revision,
      containers: [
        { name: "web", image: `reviewed.azurecr.io/reviewed-web@sha256:${"c".repeat(64)}` },
      ],
    },
  });
  const receipt = await observeProductionRelease(plan, f);
  assert.equal(receipt.status, "RELEASE_UNVERIFIED");
  assert.equal(receipt.failureCode, "production_observation_revision_or_image_mismatch");
  assert.equal(receipt.operations.publicGetAttempts, 0);
});

test("wrong scope, split traffic and contradictory latest routing fail closed", async () => {
  for (const change of [
    { id: target.replace(plan.subscriptionId, "33333333-3333-4333-8333-333333333333") },
    { mode: "Multiple" },
    { latestReadyRevisionName: "old-revision" },
    { traffic: [{ revisionName: plan.revisionName, weight: 99 }] },
    {
      traffic: [
        { revisionName: plan.revisionName, weight: 50 },
        { latestRevision: true, weight: 50 },
      ],
    },
    { traffic: [{ revisionName: "unrelated--revision", latestRevision: true, weight: 100 }] },
  ]) {
    const f = fixture({ appValue: { ...app, ...change } });
    const receipt = await observeProductionRelease(plan, f);
    assert.equal(receipt.status, "RELEASE_UNVERIFIED");
    assert.equal(receipt.failureCode, "production_observation_target_or_traffic_mismatch");
    assert.equal(receipt.operations.azureReadAttempts, 1);
    assert.equal(receipt.operations.publicGetAttempts, 0);
  }
});

test("a traffic change during public observations invalidates the combined receipt", async () => {
  const f = fixture({ secondApp: { ...app, latestRevisionName: "newer--revision" } });
  const receipt = await observeProductionRelease(plan, f);
  assert.equal(receipt.status, "RELEASE_UNVERIFIED");
  assert.equal(receipt.checks.versionBuild, true);
  assert.equal(receipt.checks.stableTargetAndTraffic, false);
});

test("healthy old server and version/header disagreement cannot certify the new release", async () => {
  for (const response of [
    (url) => (url.endsWith("/api/health") ? json({ ...health, build: "unknown" }) : json(version)),
    (url) =>
      url.endsWith("/api/health")
        ? json(health)
        : json({ ...version, sha: "c".repeat(40) }, { "x-kova-build": plan.sourceSha }),
    (url) =>
      url.endsWith("/api/health") ? json(health) : json(version, { "x-kova-build": "unknown" }),
  ]) {
    const receipt = await observeProductionRelease(plan, fixture({ publicResponse: response }));
    assert.equal(receipt.status, "RELEASE_UNVERIFIED");
    assert.match(receipt.failureCode, /production_observation_(?:health|version)_build_mismatch/u);
  }
});

test("redirects, HTML, cacheable, oversized and malformed public bodies fail without following or exposing them", async () => {
  for (const response of [
    () =>
      new Response("credential-bearing response", {
        status: 302,
        headers: { location: "https://unrelated.example/?token=secret" },
      }),
    () => new Response("credential-bearing response", { headers: { "content-type": "text/html" } }),
    () => json(health, { "cache-control": "public, max-age=60" }),
    () =>
      new Response("secret ".repeat(12_000), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    () =>
      new Response("credential-bearing response", {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
  ]) {
    const f = fixture({ publicResponse: response });
    const receipt = await observeProductionRelease(plan, f);
    assert.equal(receipt.status, "RELEASE_UNVERIFIED");
    assert.equal(receipt.operations.publicGetAttempts, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /credential-bearing|token=secret|secret /u);
  }
});

test("raw Azure errors and malformed control-plane bodies are discarded", async () => {
  for (const run of [
    async () => {
      throw new Error("sensitive provider response secret-value");
    },
    async () => ({ ok: false, stdout: "secret-value" }),
    async () => ({ ok: true, stdout: "secret-value" }),
  ]) {
    const f = fixture();
    const receipt = await observeProductionRelease(plan, { ...f, run });
    assert.equal(receipt.status, "RELEASE_UNVERIFIED");
    assert.doesNotMatch(JSON.stringify(receipt), /sensitive|secret-value/u);
    assert.equal(receipt.operations.publicGetAttempts, 0);
  }
});

test("a backward wall clock cannot renew the original observation budget", async () => {
  const f = fixture();
  let elapsed = 0;
  const run = async (...args) => {
    const result = await f.run(...args);
    elapsed += 31_000;
    return result;
  };
  const receipt = await observeProductionRelease(plan, {
    ...f,
    run,
    now: () => now - elapsed,
    monotonic: () => elapsed,
  });
  assert.equal(receipt.status, "RELEASE_UNVERIFIED");
  assert.equal(receipt.failureCode, "production_observation_deadline_exceeded");
  assert.equal(receipt.operations.azureReadAttempts, 2);
  assert.equal(receipt.operations.publicGetAttempts, 0);
});

test("captured Azure runner uses no shell, bounded termination and suppresses failed output", async () => {
  let options;
  const runner = createProductionObservationRunner({
    execute: (command, args, value, callback) => {
      assert.equal(command, "az");
      assert.deepEqual(args, ["rest", "--method", "get"]);
      options = value;
      callback(new Error("raw secret diagnostic"), "raw secret output");
    },
  });
  assert.deepEqual(await runner(["rest", "--method", "get"], { timeoutMs: 12_345 }), {
    ok: false,
    stdout: "",
  });
  assert.equal(options.timeout, 12_345);
  assert.equal(options.killSignal, "SIGKILL");
  assert.equal(options.shell, undefined);
  assert.equal(options.maxBuffer, 64 * 1024);
});

test("CLI requires explicit observe and an absolute plan path before live entry", async () => {
  for (const args of [
    [],
    ["--execute"],
    ["--observe", "relative.json"],
    ["--observe", "/private/plan", "--stop"],
  ]) {
    await assert.rejects(
      productionObservationMain(args),
      /production_observation_explicit_observation_required/u,
    );
  }
});
