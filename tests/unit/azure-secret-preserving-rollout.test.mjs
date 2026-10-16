import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  generateRevisionRolloutPlan,
  generateSecretPreservingRevisionRolloutPlan,
  validateSecretPreservingCapture,
} from "../../scripts/azure/revision-rollout-plan.mjs";
import { bindCapture, rolloutFixture } from "../helpers/azure-revision-rollout-fixture.mjs";

const NOW = "2026-10-12T18:00:00.000Z";
const generate = (input) => generateSecretPreservingRevisionRolloutPlan(input, { now: NOW });
function fixture(environment = "production", now = NOW) {
  const input = rolloutFixture(environment, now);
  input.scope.secretPreservingPatchOptIn = true;
  input.baseline.properties.configuration.secrets = [
    { name: "synthetic-auth" },
    {
      name: "synthetic-versionless",
      keyVaultUrl: "https://synthetic.vault.azure.net/secrets/unchanged-versionless",
      identity: "system",
    },
    { name: "synthetic-inline", value: "SYNTHETIC_SECRET_DO_NOT_TRANSMIT" },
  ];
  return bindCapture(input);
}

// Independent RFC7396 application, not the implementation's internal model.
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function applyPatch(target, patch) {
  if (!object(patch)) return structuredClone(patch);
  return Object.fromEntries(
    [...new Set([...Object.keys(object(target) ? target : {}), ...Object.keys(patch)])]
      .filter((key) => !Object.hasOwn(patch, key) || patch[key] !== null)
      .map((key) => [
        key,
        Object.hasOwn(patch, key)
          ? applyPatch(target?.[key], patch[key])
          : structuredClone(target[key]),
      ]),
  );
}

for (const environment of ["production", "staging"]) {
  test(`merge patch ${environment}: ordered plans preserve the complete configuration and rollback traffic`, () => {
    const input = fixture(environment);
    const original = structuredClone(input);
    const plan = generate(input);
    assert.deepEqual(input, original);
    assert.equal(plan.requestTransport, "containerapp-json-merge-patch-2025-01-01");
    assert.equal(plan.cloudRequestsMade, 0);
    assert.equal(plan.executableByThisTool, false);
    assert.equal(plan.authorizationGranted, false);
    assert.equal(plan.liveAcceptanceEstablished, false);
    assert.equal(plan.liveCostEntitlementEstablished, false);
    assert.equal(plan.secretVersionRollbackEstablished, false);
    assert.equal(plan.providerLivePreservationVerified, false);
    let state = structuredClone(input.baseline);
    for (const [index, step] of plan.steps.entries()) {
      assert.equal(step.method, "PATCH");
      assert.equal(
        step.url,
        `https://management.azure.com${input.scope.targetResourceId}?api-version=2025-01-01`,
      );
      assert.equal(step.headers["Content-Type"], "application/json");
      assert.equal(step.clientTimeoutSeconds, 60);
      assert.equal(step.maximumAttempts, 1);
      assert.equal(step.retries, 0);
      assert.equal(step.secretInventoryTransmitted, false);
      assert.equal(step.conditionalWriteSupportEstablished, false);
      assert.equal(step.requiresExclusiveWriter, true);
      assert.ok(!Object.hasOwn(step.requestBody, "identity"));
      assert.ok(!Object.hasOwn(step.requestBody.properties.configuration ?? {}, "secrets"));
      assert.ok(!Object.hasOwn(step.requestBody.properties.configuration ?? {}, "registries"));
      assert.ok(!Object.hasOwn(step.requestBody.properties.template ?? {}, "scale"));
      assert.equal(Object.hasOwn(step.requestBody.properties, "template"), index === 1);
      state = applyPatch(state, step.requestBody);
      const expected = structuredClone(input.baseline);
      expected.properties.configuration.activeRevisionsMode = "Multiple";
      expected.properties.configuration.ingress.traffic =
        index < 2
          ? [{ revisionName: input.scope.previousRevision, weight: 100 }]
          : index === 3
            ? plan.canaryTraffic
            : plan.rollbackTraffic;
      if (index > 0) {
        expected.properties.template.revisionSuffix = input.scope.candidateSuffix;
        expected.properties.template.containers[0].image = input.scope.candidateImage;
      }
      assert.deepEqual(state, expected);
      // Local idempotence is not permission to retry a hosted write.
      assert.deepEqual(applyPatch(state, step.requestBody), state);
    }
    assert.deepEqual(
      plan.canaryTraffic.map((x) => x.weight),
      [95, 5],
    );
    assert.deepEqual(
      plan.rollbackTraffic.map((x) => x.weight),
      [100, 0],
    );
    assert.equal(
      state.properties.template.containers[1].image,
      input.baseline.properties.template.containers[1].image,
    );
    assert.ok(!JSON.stringify(plan).includes("SYNTHETIC_SECRET_DO_NOT_TRANSMIT"));
    assert.ok(!JSON.stringify(plan).includes("unchanged-versionless"));
    assert.ok(!JSON.stringify(plan).includes("SYNTHETIC_PRIVATE_MARKER"));
  });
}

test("merge patch never turns null origin controls into deletion instructions", () => {
  const input = fixture();
  input.baseline.properties.configuration.ingress.ipSecurityRestrictions = null;
  input.baseline.properties.configuration.ingress.clientCertificateMode = null;
  input.baseline.properties.template.containers[1].futureField = null;
  input.previousRevision.properties.template = structuredClone(input.baseline.properties.template);
  bindCapture(input);
  const plan = generate(input);
  let state = input.baseline;
  for (const step of plan.steps) state = applyPatch(state, step.requestBody);
  assert.equal(state.properties.configuration.ingress.ipSecurityRestrictions, null);
  assert.equal(state.properties.configuration.ingress.clientCertificateMode, null);
  assert.equal(state.properties.template.containers[1].futureField, null);
});

test("merge patch is explicit; default full-resource validation still rejects opaque or versionless secrets", () => {
  const input = fixture();
  assert.doesNotThrow(() => validateSecretPreservingCapture(input));
  assert.throws(
    () => generateRevisionRolloutPlan(input, { now: NOW }),
    /secret_inventory_incomplete/,
  );
  delete input.scope.secretPreservingPatchOptIn;
  assert.throws(() => generate(input), /secret_preserving_patch_opt_in_required/);
});

test("both transports omit readOnly ephemeralStorage but preserve writable CPU, memory and unknown fields", () => {
  const input = rolloutFixture();
  input.scope.secretPreservingPatchOptIn = true;
  for (const kind of ["containers", "initContainers"]) {
    for (const container of input.baseline.properties.template[kind]) {
      container.resources.ephemeralStorage = "2Gi";
      container.resources.futureWritable = "unchanged";
    }
  }
  input.previousRevision.properties.template = structuredClone(input.baseline.properties.template);
  bindCapture(input);
  const full = generateRevisionRolloutPlan(input, { now: NOW });
  const partial = generate(input);
  const fullTemplate =
    full.steps[1].requestBody.properties.parameters.rolloutResource.value.properties.template;
  const partialTemplate = partial.steps[1].requestBody.properties.template;
  for (const template of [fullTemplate, partialTemplate]) {
    for (const container of [...template.containers, ...(template.initContainers ?? [])]) {
      assert.ok(!Object.hasOwn(container.resources, "ephemeralStorage"));
      assert.ok(container.resources.cpu > 0);
      assert.ok(container.resources.memory);
      assert.equal(container.resources.futureWritable, "unchanged");
    }
  }
  assert.equal(
    full.steps[1].omittedResponseOnlyPaths.filter((p) => p.endsWith("ephemeralStorage")).length,
    3,
  );
  assert.equal(partial.steps[1].omittedResponseOnlyPaths.length, 2);
  assert.equal(partial.steps[0].omittedResponseOnlyPaths.length, 0);
  assert.ok(!Object.hasOwn(partialTemplate, "initContainers"));
  assert.equal(input.baseline.properties.template.containers[0].resources.ephemeralStorage, "2Gi");
});

const failures = [
  [
    "Activating previous",
    (x) => {
      x.previousRevision.properties.runningState = "Activating";
    },
    /previous_revision_unverified/,
  ],
  [
    "missing previous template field",
    (x) => {
      delete x.previousRevision.properties.template.scale;
    },
    /previous_revision_unverified/,
  ],
  [
    "unhealthy previous",
    (x) => {
      x.previousRevision.properties.healthState = "Unhealthy";
    },
    /previous_revision_unverified/,
  ],
  [
    "zero previous replicas",
    (x) => {
      x.previousRevision.properties.replicas = 0;
    },
    /healthy_previous_replica_required/,
  ],
  [
    "missing secret reference",
    (x) => {
      x.baseline.properties.template.containers[0].env[0].secretRef = "not-in-inventory";
    },
    /unresolved_secret_reference/,
  ],
  [
    "duplicate secret metadata",
    (x) => {
      x.baseline.properties.configuration.secrets.push({ name: "synthetic-auth" });
    },
    /duplicate_secret_reference/,
  ],
  [
    "secret URL with query",
    (x) => {
      x.baseline.properties.configuration.secrets[1].keyVaultUrl += "?token=synthetic";
    },
    /secret_inventory_incomplete/,
  ],
  [
    "secret URL non-TLS",
    (x) => {
      x.baseline.properties.configuration.secrets[1].keyVaultUrl =
        "http://synthetic.vault.azure.net/secrets/a";
    },
    /secret_inventory_incomplete/,
  ],
  [
    "secret URL without identity",
    (x) => {
      delete x.baseline.properties.configuration.secrets[1].identity;
    },
    /secret_inventory_incomplete/,
  ],
  [
    "secret URL with inline value",
    (x) => {
      x.baseline.properties.configuration.secrets[1].value = "synthetic";
    },
    /secret_inventory_incomplete/,
  ],
  [
    "candidate tag",
    (x) => {
      x.scope.candidateImage = "kovagptacr-dte9hugbhjghcyb8.azurecr.io/kovagpt-web:latest";
    },
    /image_binding_invalid/,
  ],
  [
    "different target",
    (x) => {
      x.scope.targetResourceId += "-other";
    },
    /target_invalid/,
  ],
  [
    "100 percent promotion",
    (x) => {
      x.canary.maximumCandidateWeight = 100;
      x.canary.candidateWeight = 100;
    },
    /canary_weight_invalid/,
  ],
  [
    "stale capture",
    (x) => {
      x.inventory.observedAt = "2026-10-12T17:00:00.000Z";
    },
    /fresh_capture_required/,
  ],
  [
    "missing old opt in",
    (x) => {
      x.scope.rolloutOptIn = false;
    },
    /explicit_opt_in_required/,
  ],
];
for (const [name, mutate, code] of failures) {
  test(`merge patch fails closed: ${name}`, () => {
    const input = fixture();
    mutate(input);
    bindCapture(input);
    assert.throws(() => generate(input), code);
  });
}

test("merge patch rejects inventory tamper without accepting a rebinding", () => {
  const input = fixture();
  input.baseline.tags.unapproved = "changed";
  assert.throws(() => generate(input), /capture_hash_mismatch/);
});

test("merge patch rejects requested non-allowlisted configuration changes", () => {
  const input = fixture();
  input.desired = structuredClone(input.baseline);
  input.desired.properties.configuration.activeRevisionsMode = "Multiple";
  input.desired.properties.configuration.ingress.traffic = [
    { revisionName: input.scope.previousRevision, weight: 100 },
  ];
  input.desired.properties.template.revisionSuffix = input.scope.candidateSuffix;
  input.desired.properties.template.containers[0].image = input.scope.candidateImage;
  input.desired.properties.configuration.secrets = [];
  assert.throws(() => generate(input), /unapproved_property_change/);
});

test("merge patch private CLI creates only0600 output, never overwrites, and prints no private content", () => {
  const dir = mkdtempSync(join(tmpdir(), "kova-secret-preserving-test-"));
  try {
    chmodSync(dir, 0o700);
    const source = join(dir, "input.json"),
      output = join(dir, "plan.json");
    writeFileSync(source, JSON.stringify(fixture("production", new Date().toISOString())), {
      mode: 0o600,
    });
    const run = () =>
      spawnSync(
        process.execPath,
        ["scripts/azure/revision-rollout-plan.mjs", "--secret-preserving-patch", source, output],
        { encoding: "utf8", timeout: 5000 },
      );
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(
      first.stdout.trim(),
      "REVISION_ROLLOUT_PLAN=PASS cloudRequests=0 liveAcceptance=false",
    );
    assert.equal(first.stderr, "");
    assert.equal(statSync(output).mode & 0o777, 0o600);
    const bytes = readFileSync(output, "utf8");
    assert.equal(JSON.parse(bytes).requestTransport, "containerapp-json-merge-patch-2025-01-01");
    assert.ok(!bytes.includes("SYNTHETIC_SECRET_DO_NOT_TRANSMIT"));
    assert.equal(run().status, 1);
    assert.equal(readFileSync(output, "utf8"), bytes);
    chmodSync(source, 0o644);
    const denied = run();
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /revision_rollout_private_input_required/);
    assert.ok(!denied.stderr.includes("SYNTHETIC"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
