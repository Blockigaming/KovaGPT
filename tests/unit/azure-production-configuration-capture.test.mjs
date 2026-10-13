import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  acquireAzureToken,
  armGet,
  captureProductionConfiguration,
  capturedRolloutInput,
  LIMITS,
  sanitizedFailure,
  TARGET,
} from "../../scripts/azure/capture-production-configuration.mjs";
import { generateRevisionRolloutPlan } from "../../scripts/azure/revision-rollout-plan.mjs";
import { rolloutFixture } from "../helpers/azure-revision-rollout-fixture.mjs";

const NOW = "2026-10-12T18:00:00.000Z";
const SOURCE = "a".repeat(40);
const TOKEN = "SYNTHETIC_ONLY_TOKEN";
const APP_URL = `https://management.azure.com${TARGET}?api-version=2025-01-01`;
function fixture(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), "kova-capture-test-"));
  chmodSync(parent, 0o700);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const input = rolloutFixture("production", NOW);
  const calls = [];
  const options = {
    outputDirectory: join(parent, "capture"),
    sourceSha: SOURCE,
    authorizeRead: true,
  };
  const documents = [input.baseline, input.previousRevision, structuredClone(input.baseline)];
  let tokens = 0;
  const dependencies = {
    now: () => NOW,
    acquireToken: () => {
      tokens += 1;
      return TOKEN;
    },
    get: async (url, token, timeoutMs) => {
      calls.push({ url, token, timeoutMs });
      return structuredClone(documents[calls.length - 1]);
    },
  };
  return { parent, input, options, documents, dependencies, calls, tokens: () => tokens };
}

test("one capture produces three exact GETs and preserves opaque properties privately", async (t) => {
  const f = fixture(t);
  const result = await captureProductionConfiguration(f.options, f.dependencies);
  assert.equal(f.tokens(), 1);
  assert.deepEqual(
    f.calls.map((c) => c.url),
    [
      APP_URL,
      `https://management.azure.com${TARGET}/revisions/${f.input.scope.previousRevision}?api-version=2025-01-01`,
      APP_URL,
    ],
  );
  assert.ok(f.calls.every((c) => c.token === TOKEN && c.timeoutMs > 0 && c.timeoutMs <= 20000));
  assert.deepEqual(result.baseline, f.input.baseline);
  assert.equal(result.receipt.stage, "CAPTURE_COMPLETE_NOT_DEPLOYMENT_ACCEPTANCE");
  assert.equal(result.receipt.authorizationConsumed, true);
  assert.equal(result.receipt.remainingGets, 0);
  assert.equal(result.receipt.productionWrites, 0);
  assert.equal(statSync(f.options.outputDirectory).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(f.options.outputDirectory).sort(), [
    "baseline.json",
    "confirmation.json",
    "previous-revision.json",
    "receipt.json",
  ]);
  for (const file of readdirSync(f.options.outputDirectory)) {
    const path = join(f.options.outputDirectory, file);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readFileSync(path, "utf8").includes(TOKEN), false);
  }
  const receipt = JSON.parse(readFileSync(join(f.options.outputDirectory, "receipt.json")));
  assert.equal(JSON.stringify(receipt).includes("SYNTHETIC_PRIVATE_MARKER"), false);
});

test("captured input feeds unchanged preservation/canary/rollback generator offline", async (t) => {
  const f = fixture(t);
  const capture = await captureProductionConfiguration(f.options, f.dependencies);
  const input = capturedRolloutInput(capture, f.input.scope, f.input.canary, { now: NOW });
  const plan = generateRevisionRolloutPlan(input, { now: NOW });
  assert.equal(plan.cloudRequestsMade, 0);
  assert.equal(plan.liveAcceptanceEstablished, false);
  assert.equal(plan.steps.length, 5);
  assert.deepEqual(
    plan.initialTraffic.map((v) => v.weight),
    [100, 0],
  );
  assert.deepEqual(
    plan.rollbackTraffic.map((v) => v.weight),
    [100, 0],
  );
  assert.equal(
    plan.steps[1].requestBody.properties.parameters.rolloutResource.value.properties.configuration
      .futureConfiguration.preserve,
    "SYNTHETIC_PRIVATE_MARKER",
  );
});

test("unauthorized collection makes no token or API call", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    captureProductionConfiguration({ ...f.options, authorizeRead: false }, f.dependencies),
    /explicit_read_authorization_required/u,
  );
  assert.equal(f.tokens(), 0);
  assert.equal(f.calls.length, 0);
});

test("existing successful or interrupted destination cannot consume another attempt", async (t) => {
  const f = fixture(t);
  await captureProductionConfiguration(f.options, f.dependencies);
  await assert.rejects(
    captureProductionConfiguration(f.options, f.dependencies),
    /output_already_exists_or_unavailable/u,
  );
  assert.equal(f.calls.length, 3);
  assert.equal(f.tokens(), 1);
});

test("shared parent rejected before credential access", async (t) => {
  const f = fixture(t);
  chmodSync(f.parent, 0o755);
  await assert.rejects(
    captureProductionConfiguration(f.options, f.dependencies),
    /private_directory_required/u,
  );
  assert.equal(f.tokens(), 0);
});

test("symlink parent rejected before credential access", async (t) => {
  const f = fixture(t);
  const link = join(f.parent, "link");
  symlinkSync(f.parent, link);
  await assert.rejects(
    captureProductionConfiguration(
      { ...f.options, outputDirectory: join(link, "capture") },
      f.dependencies,
    ),
    /private_directory_required/u,
  );
  assert.equal(f.tokens(), 0);
});

for (const [name, mutate, count, code] of [
  [
    "wrong app",
    (f) => {
      f.documents[0].id = TARGET.replace("kovagpt-prod-web", "ca-kovagpt-staging");
    },
    1,
    "target_mismatch",
  ],
  [
    "revision path injection",
    (f) => {
      f.documents[0].properties.latestReadyRevisionName = "../listSecrets";
    },
    1,
    "app_response_incomplete",
  ],
  [
    "wrong revision",
    (f) => {
      f.documents[1].name = "unrelated";
    },
    2,
    "revision_mismatch",
  ],
  [
    "configuration changed during capture",
    (f) => {
      f.documents[2].properties.configuration.futureConfiguration.preserve = "changed";
    },
    3,
    "configuration_drift",
  ],
]) {
  test(`${name} stops at the failing read without retries`, async (t) => {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(
      captureProductionConfiguration(f.options, f.dependencies),
      new RegExp(code, "u"),
    );
    assert.equal(f.calls.length, count);
    const receipt = JSON.parse(readFileSync(join(f.options.outputDirectory, "receipt.json")));
    assert.equal(receipt.stage, "STOPPED_RECONCILE_SAVED_READS_NO_RETRY");
    assert.equal(receipt.authorizationConsumed, true);
    assert.equal(receipt.remainingGets, 0);
    assert.equal(receipt.errorCode, `configuration_capture_${code}`);
  });
}

test("private transport error is sanitized and unknown outcome is retained", async (t) => {
  const f = fixture(t);
  let gets = 0;
  f.dependencies.get = () => {
    gets += 1;
    throw new Error(`private response ${TOKEN}`);
  };
  await assert.rejects(
    captureProductionConfiguration(f.options, f.dependencies),
    /^Error: configuration_capture_private_operation_failed$/u,
  );
  assert.equal(gets, 1);
  const text = readFileSync(join(f.options.outputDirectory, "receipt.json"), "utf8");
  assert.equal(text.includes(TOKEN), false);
  assert.equal(JSON.parse(text).reads[0].outcome, "DISPATCH_INTENT_OUTCOME_UNKNOWN");
});

for (const [name, mutate, code] of [
  [
    "missing inline secret",
    (c) => {
      delete c.baseline.properties.configuration.secrets[0].keyVaultUrl;
    },
    "secret_inventory_incomplete",
  ],
  [
    "unhealthy previous",
    (c) => {
      c.previousRevision.properties.healthState = "Unhealthy";
    },
    "previous_revision_unverified",
  ],
  [
    "zero previous replicas",
    (c) => {
      c.previousRevision.properties.replicas = 0;
    },
    "healthy_previous_replica_required",
  ],
  [
    "mutable image",
    (c) => {
      c.baseline.properties.template.containers[0].image = "registry.invalid/app:latest";
      c.previousRevision.properties.template = structuredClone(c.baseline.properties.template);
    },
    "previous_image_mismatch",
  ],
]) {
  test(`${name}: capture is evidence, not a rollout PASS`, async (t) => {
    const f = fixture(t);
    const changing = { baseline: f.documents[0], previousRevision: f.documents[1] };
    mutate(changing);
    f.documents[2] = structuredClone(changing.baseline);
    const capture = await captureProductionConfiguration(f.options, f.dependencies);
    assert.throws(
      () => capturedRolloutInput(capture, f.input.scope, f.input.canary, { now: NOW }),
      new RegExp(code, "u"),
    );
    assert.equal(f.calls.length, 3);
    assert.equal(capture.receipt.secretValueEndpointsCalled, 0);
  });
}

test("changed capture, unbound receipt, staging scope and expired capture fail closed", async (t) => {
  const f = fixture(t);
  const capture = await captureProductionConfiguration(f.options, f.dependencies);
  const tampered = structuredClone(capture);
  tampered.baseline.tags.changed = "yes";
  assert.throws(
    () => capturedRolloutInput(tampered, f.input.scope, f.input.canary, { now: NOW }),
    /capture_hash_mismatch/u,
  );
  const incomplete = structuredClone(capture);
  incomplete.receipt.reads.pop();
  assert.throws(
    () => capturedRolloutInput(incomplete, f.input.scope, f.input.canary, { now: NOW }),
    /receipt_incomplete/u,
  );
  const wrongUrl = structuredClone(capture);
  wrongUrl.receipt.reads[1].url = "https://example.invalid";
  assert.throws(
    () => capturedRolloutInput(wrongUrl, f.input.scope, f.input.canary, { now: NOW }),
    /receipt_binding_mismatch/u,
  );
  const wrongHash = structuredClone(capture);
  wrongHash.receipt.reads[1].documentSha256 = "0".repeat(64);
  assert.throws(
    () => capturedRolloutInput(wrongHash, f.input.scope, f.input.canary, { now: NOW }),
    /receipt_binding_mismatch/u,
  );
  assert.throws(
    () =>
      capturedRolloutInput(capture, { ...f.input.scope, environment: "staging" }, f.input.canary, {
        now: NOW,
      }),
    /scope_mismatch/u,
  );
  const expired = new Date(Date.parse(NOW) + 360000).toISOString();
  assert.throws(
    () =>
      capturedRolloutInput(
        capture,
        f.input.scope,
        { ...f.input.canary, windowStart: expired },
        { now: expired },
      ),
    /fresh_capture_required/u,
  );
});

function fakeRequest({ status = 200, body = "{}", error = false, hang = false } = {}) {
  const calls = [];
  const request = (url, options, callback) => {
    calls.push({ url, options });
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () =>
      queueMicrotask(() => {
        if (hang) return;
        if (error) {
          req.emit("error", new Error(TOKEN));
          return;
        }
        const response = new EventEmitter();
        response.statusCode = status;
        response.destroy = () => {};
        callback(response);
        response.emit("data", Buffer.from(body));
        response.emit("end");
      });
    return req;
  };
  return { calls, request };
}

test("HTTPS transport fixes GET, TLS verification and authorization header; no redirects/retry", async () => {
  const f = fakeRequest({ body: '{"ok":true}' });
  assert.deepEqual(await armGet(APP_URL, TOKEN, 20000, f.request), { ok: true });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].options, {
    method: "GET",
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    agent: false,
    rejectUnauthorized: true,
  });
});
for (const status of [301, 401, 403, 404, 429, 500]) {
  test(`HTTP ${status} is sanitized and never retried`, async () => {
    const f = fakeRequest({ status, body: TOKEN });
    await assert.rejects(
      armGet(APP_URL, TOKEN, 20000, f.request),
      new RegExp(`^Error: configuration_capture_http_${status}$`, "u"),
    );
    assert.equal(f.calls.length, 1);
  });
}
for (const [name, config, code] of [
  ["network", { error: true }, "network_failed"],
  ["JSON", { body: TOKEN }, "response_json_invalid"],
  ["oversize", { body: "x".repeat(LIMITS.maximumBytes + 1) }, "response_too_large"],
  ["silent", { hang: true }, "request_timeout"],
]) {
  test(`${name} failure has bounded private handling`, async () => {
    const f = fakeRequest(config);
    await assert.rejects(
      armGet(APP_URL, TOKEN, name === "silent" ? 10 : 20000, f.request),
      new RegExp(`^Error: configuration_capture_${code}$`, "u"),
    );
    assert.equal(f.calls.length, 1);
  });
}
test("transport rejects other hosts, endpoints, versions and token header injection before dispatch", () => {
  const f = fakeRequest();
  for (const url of [
    APP_URL.replace("management.azure.com", "evil.invalid"),
    APP_URL.replace("2025-01-01", "2024-01-01"),
    `${APP_URL}&extra=1`,
    `https://management.azure.com${TARGET}/listSecrets?api-version=2025-01-01`,
  ]) {
    assert.throws(() => armGet(url, TOKEN, 20000, f.request), /url_not_allowed/u);
  }
  assert.throws(() => armGet(APP_URL, "bad\r\nheader", 20000, f.request), /token_invalid/u);
  assert.throws(() => armGet(APP_URL, TOKEN, 20001, f.request), /timeout_invalid/u);
  assert.equal(f.calls.length, 0);
});

test("token acquisition binds subscription and timeout without secrets in argv or stderr", () => {
  let captured;
  const result = {
    status: 0,
    stdout: JSON.stringify({ subscription: TARGET.split("/")[2], accessToken: TOKEN }),
    stderr: TOKEN,
  };
  assert.equal(
    acquireAzureToken((...args) => {
      captured = args;
      return result;
    }),
    TOKEN,
  );
  assert.equal(captured[0], "az");
  assert.equal(JSON.stringify(captured[1]).includes(TOKEN), false);
  assert.equal(captured[2].timeout, 15000);
  assert.deepEqual(captured[2].stdio, ["ignore", "pipe", "ignore"]);
  assert.equal(result.stdout, null);
  assert.equal(result.stderr, null);
});
for (const [name, result, code] of [
  ["CLI failed", { status: 1, stdout: TOKEN, stderr: TOKEN }, "azure_token_unavailable"],
  ["CLI JSON", { status: 0, stdout: TOKEN }, "azure_token_json_invalid"],
  [
    "wrong subscription",
    { status: 0, stdout: JSON.stringify({ subscription: "wrong", accessToken: TOKEN }) },
    "azure_token_binding_invalid",
  ],
]) {
  test(`${name} is specific without printing authentication output`, () => {
    assert.throws(
      () => acquireAzureToken(() => result),
      new RegExp(`^Error: configuration_capture_${code}$`, "u"),
    );
    assert.equal(result.stdout, null);
  });
}
test("CLI without approval stops before token access, with fixed sanitized output", () => {
  const r = spawnSync(
    process.execPath,
    [resolve("scripts/azure/capture-production-configuration.mjs")],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr.trim(), "configuration_capture_explicit_read_authorization_required");
  assert.equal(
    sanitizedFailure(new Error(TOKEN)),
    "configuration_capture_private_operation_failed",
  );
});

test("CLI wrong source fails before credential access or directory creation", (t) => {
  const f = fixture(t);
  const r = spawnSync(
    process.execPath,
    [
      resolve("scripts/azure/capture-production-configuration.mjs"),
      "--execute-approved-read",
      "0".repeat(40),
      f.options.outputDirectory,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr.trim(), "configuration_capture_source_not_clean_or_mismatch");
  assert.deepEqual(readdirSync(f.parent), []);
});

test("unavailable credential releases unused GETs and preserves a nonsecret failure receipt", async (t) => {
  const f = fixture(t);
  f.dependencies.acquireToken = () => {
    throw new Error("configuration_capture_azure_token_unavailable");
  };
  await assert.rejects(
    captureProductionConfiguration(f.options, f.dependencies),
    /azure_token_unavailable/u,
  );
  assert.equal(f.calls.length, 0);
  const receipt = JSON.parse(readFileSync(join(f.options.outputDirectory, "receipt.json")));
  assert.equal(receipt.authorizationConsumed, false);
  assert.equal(receipt.remainingGets, 0);
  assert.equal(receipt.errorCode, "configuration_capture_azure_token_unavailable");
});
