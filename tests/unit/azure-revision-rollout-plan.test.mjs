import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  documentSha256,
  generateRevisionRolloutPlan,
} from "../../scripts/azure/revision-rollout-plan.mjs";
import { bindCapture, rolloutFixture } from "../helpers/azure-revision-rollout-fixture.mjs";

const now = "2026-10-12T18:00:00.000Z";
const generate = (input) => generateRevisionRolloutPlan(input, { now });
const body = (step) => step.requestBody.properties.parameters.rolloutResource.value;

for (const environment of ["production", "staging"]) {
  test(`${environment}: complete deployable incremental candidate and explicit named traffic plans`, () => {
    const input = rolloutFixture(environment);
    const original = JSON.stringify(input);
    const plan = generate(input);
    assert.equal(JSON.stringify(input), original);
    assert.equal(plan.cloudRequestsMade, 0);
    assert.equal(plan.authorizationGranted, false);
    assert.equal(plan.liveAcceptanceEstablished, false);
    assert.equal(plan.liveCostEntitlementEstablished, false);
    assert.deepEqual(
      plan.steps.map((s) => s.id),
      [
        "prepare-multiple",
        "create-candidate-zero-traffic",
        "pin-initial-traffic",
        "bounded-canary",
        "rollback-traffic",
      ],
    );
    const [prepare, candidate, initial, canary, rollback] = plan.steps;
    assert.equal(body(prepare).properties.template.containers[0].image, input.scope.previousImage);
    assert.equal(
      body(candidate).properties.template.containers[0].image,
      input.scope.candidateImage,
    );
    assert.equal(body(candidate).properties.template.revisionSuffix, "candidate");
    assert.deepEqual(body(candidate).properties.configuration.ingress.traffic, [
      { revisionName: input.scope.previousRevision, weight: 100 },
    ]);
    for (const s of plan.steps) {
      assert.equal(s.requestBody.properties.mode, "Incremental");
      assert.equal(
        s.requestBody.properties.template.parameters.rolloutResource.type,
        "secureObject",
      );
      assert.equal(
        s.requestBody.properties.template.parameters.enableRevisionRollout.defaultValue,
        false,
      );
      assert.equal(s.requestBody.properties.parameters.enableRevisionRollout.value, true);
      assert.equal(s.requestBody.properties.template.resources.length, 1);
      assert.equal(s.requestBody.properties.template.resources[0].name, input.baseline.name);
      assert.ok(
        s.requestBody.properties.template.resources[0].condition.includes(
          s.targetResourceGroupId.toLowerCase(),
        ),
      );
      assert.equal(body(s).properties.configuration.activeRevisionsMode, "Multiple");
      assert.equal(s.retries, 0);
      assert.equal(s.clientTimeoutSeconds, 60);
      assert.equal(s.method, "PUT");
      assert.ok(s.deploymentName.length <= 64);
      assert.equal(new URL(s.url).hostname, "management.azure.com");
      assert.ok(
        s.url.startsWith(
          `https://management.azure.com${s.targetResourceGroupId}/providers/Microsoft.Resources/deployments/`,
        ),
      );
    }
    assert.deepEqual(
      body(initial).properties.configuration.ingress.traffic.map((x) => x.weight),
      [100, 0],
    );
    assert.deepEqual(
      body(canary).properties.configuration.ingress.traffic.map((x) => x.weight),
      [95, 5],
    );
    assert.deepEqual(
      body(rollback).properties.configuration.ingress.traffic.map((x) => x.weight),
      [100, 0],
    );
    assert.deepEqual(plan.initialTraffic, plan.rollbackTraffic);
    for (const weights of [plan.initialTraffic, plan.canaryTraffic, plan.rollbackTraffic]) {
      assert.equal(
        weights.reduce((sum, row) => sum + row.weight, 0),
        100,
      );
      assert.ok(weights.every((row) => row.revisionName && !Object.hasOwn(row, "latestRevision")));
    }
    assert.equal(plan.bounds.rollbackMustStartBy, "2026-10-12T18:09:30.000Z");
    assert.ok(canary.requiresEvidence.some((x) => x.includes("Auth")));
    assert.ok(rollback.requiresEvidence.some((x) => x.includes("previous active/healthy")));
  });
}

test("full writable configuration survives; only enumerated response metadata is excluded", () => {
  const input = rolloutFixture();
  const plan = generate(input);
  const candidate = body(plan.steps[1]);
  const expected = structuredClone(input.baseline.properties);
  for (const name of [
    "provisioningState",
    "runningStatus",
    "latestReadyRevisionName",
    "latestRevisionName",
  ])
    delete expected[name];
  delete expected.configuration.ingress.fqdn;
  expected.configuration.activeRevisionsMode = "Multiple";
  expected.configuration.ingress.traffic = [
    { revisionName: input.scope.previousRevision, weight: 100 },
  ];
  expected.template.containers[0].image = input.scope.candidateImage;
  expected.template.revisionSuffix = input.scope.candidateSuffix;
  assert.deepEqual(candidate.properties, expected);
  assert.deepEqual(candidate.tags, input.baseline.tags);
  assert.deepEqual(
    Object.keys(candidate.identity.userAssignedIdentities),
    Object.keys(input.baseline.identity.userAssignedIdentities),
  );
  assert.deepEqual(Object.values(candidate.identity.userAssignedIdentities), [{}]);
  assert.match(JSON.stringify(candidate), /SYNTHETIC_PRIVATE_MARKER/u);
  assert.doesNotMatch(
    JSON.stringify(plan.steps[1].requestBody.properties.template),
    /SYNTHETIC_PRIVATE_MARKER|literal-not-an-ARM-expression/u,
  );
  const allowedChanges = new Set(["configuration", "template"]);
  for (const key of Object.keys(candidate.properties).filter((k) => !allowedChanges.has(k)))
    assert.deepEqual(candidate.properties[key], input.baseline.properties[key]);
  const initial = body(plan.steps[2]);
  const trafficOnly = structuredClone(initial);
  trafficOnly.properties.configuration.ingress.traffic = plan.canaryTraffic;
  assert.deepEqual(body(plan.steps[3]), trafficOnly);
  assert.deepEqual(body(plan.steps[4]), initial);
});

test("inline secrets and unknown nested properties stay private parameter data", () => {
  const input = rolloutFixture();
  input.baseline.properties.configuration.secrets.push({
    name: "inline",
    value: "SYNTHETIC_PRIVATE_MARKER",
  });
  bindCapture(input);
  const plan = generate(input);
  assert.equal(
    body(plan.steps[1]).properties.configuration.secrets.at(-1).value,
    "SYNTHETIC_PRIVATE_MARKER",
  );
  assert.doesNotMatch(
    JSON.stringify(plan.steps[1].requestBody.properties.template),
    /SYNTHETIC_PRIVATE_MARKER/u,
  );
});

test("independent production guard cannot be redirected to staging by a scope flag", () => {
  const input = rolloutFixture();
  input.scope.environment = "staging";
  input.scope.stagingRolloutOptIn = true;
  assert.throws(() => generate(input), /revision_preservation_target_invalid/u);
});

for (const [name, mutate, code, rebind = true] of [
  [
    "no explicit opt in",
    (v) => {
      v.scope.rolloutOptIn = false;
    },
    "explicit_opt_in_required",
  ],
  [
    "no staging opt in",
    (v) => {
      v.scope.stagingRolloutOptIn = false;
    },
    "staging_opt_in_required",
  ],
  [
    "incomplete capture",
    (v) => {
      v.inventory.complete = false;
    },
    "capture_binding_required",
  ],
  [
    "changed bound capture",
    (v) => {
      v.baseline.tags.tampered = true;
    },
    "capture_hash_mismatch",
    false,
  ],
  [
    "missing previous evidence",
    (v) => {
      delete v.previousRevision;
    },
    "capture_required",
    false,
  ],
  [
    "unhealthy previous",
    (v) => {
      v.previousRevision.properties.healthState = "Unhealthy";
    },
    "previous_revision_unverified",
  ],
  [
    "inactive previous",
    (v) => {
      v.previousRevision.properties.active = false;
    },
    "previous_revision_unverified",
  ],
  [
    "no serving replica",
    (v) => {
      v.previousRevision.properties.replicas = 0;
    },
    "healthy_previous_replica_required",
  ],
  [
    "stopped app",
    (v) => {
      v.baseline.properties.runningStatus = "Stopped";
    },
    "serving_baseline_required",
  ],
  [
    "mutable candidate image",
    (v) => {
      v.scope.candidateImage = "example.invalid/web:latest";
    },
    "image_binding_invalid",
  ],
  [
    "mutable previous image",
    (v) => {
      v.scope.previousImage = "example.invalid/web:latest";
    },
    "image_binding_invalid",
  ],
  [
    "previous template mismatch",
    (v) => {
      v.previousRevision.properties.template.containers[0].env = [];
    },
    "previous_revision_unverified",
  ],
  [
    "ambiguous traffic",
    (v) => {
      v.baseline.properties.configuration.ingress.traffic.push({
        revisionName: "other",
        weight: 0,
      });
    },
    "unambiguous_baseline_traffic_required",
  ],
  [
    "wrong previous image",
    (v) => {
      v.scope.previousImage = v.scope.candidateImage;
    },
    "image_binding_invalid",
  ],
  [
    "candidate name collision",
    (v) => {
      v.scope.candidateSuffix = "previous";
    },
    "revision_binding_invalid",
  ],
  [
    "unsafe suffix",
    (v) => {
      v.scope.candidateSuffix = "candidate;bad";
    },
    "suffix_invalid",
  ],
  [
    "missing env",
    (v) => {
      delete v.baseline.properties.template.containers[0].env;
    },
    "complete_container_resources_required",
  ],
  [
    "missing probes",
    (v) => {
      delete v.baseline.properties.template.containers[0].probes;
    },
    "health_probes_required",
  ],
  [
    "missing identity",
    (v) => {
      v.baseline.identity = {};
    },
    "complete_resource_required",
  ],
  [
    "incomplete origin capture",
    (v) => {
      delete v.baseline.properties.configuration.ingress.ipSecurityRestrictions;
    },
    "complete_origin_controls_required",
  ],
  [
    "redacted secret",
    (v) => {
      v.baseline.properties.configuration.secrets = [{ name: "synthetic-auth" }];
    },
    "secret_inventory_incomplete",
  ],
  [
    "unresolved secret",
    (v) => {
      v.baseline.properties.configuration.secrets = [];
    },
    "unresolved_secret_reference",
  ],
  [
    "missing registry",
    (v) => {
      v.baseline.properties.configuration.registries = [];
    },
    "registry_binding_required",
  ],
  [
    "stale snapshot",
    (v) => {
      v.inventory.observedAt = "2026-10-12T17:00:00.000Z";
    },
    "fresh_capture_required",
  ],
  [
    "expired window",
    (v) => {
      v.canary.windowStart = "2026-10-12T17:59:59.000Z";
    },
    "bounded_window_required",
  ],
  [
    "unbounded window",
    (v) => {
      v.canary.windowEnd = "2026-10-12T20:00:00.000Z";
    },
    "bounded_window_required",
  ],
  [
    "snapshot expires before start",
    (v) => {
      v.canary.windowStart = "2026-10-12T18:06:00.000Z";
    },
    "capture_expires_before_window",
  ],
  [
    "full cutover is not canary",
    (v) => {
      v.canary.maximumCandidateWeight = 100;
      v.canary.candidateWeight = 100;
    },
    "canary_weight_invalid",
  ],
  [
    "weight beyond bound",
    (v) => {
      v.canary.candidateWeight = 6;
    },
    "canary_weight_invalid",
  ],
  [
    "missing rollback reserve",
    (v) => {
      v.canary.maximumRecoveryMs = 0;
    },
    "recovery_bound_required",
  ],
  [
    "unapproved top-level override",
    (v) => {
      v.override = {};
    },
    "input_contract_invalid",
  ],
  [
    "unrecognized resource field",
    (v) => {
      v.baseline.copy = {};
    },
    "unsupported_resource_field",
  ],
]) {
  test(`fails closed: ${name}`, () => {
    const input = rolloutFixture(name.includes("staging") ? "staging" : "production");
    mutate(input);
    if (rebind) bindCapture(input);
    assert.throws(
      () => generate(input),
      new RegExp(`revision_(?:rollout|preservation)_${code}$`, "u"),
    );
  });
}

test("caller-supplied desired configuration cannot weaken probes, origin, scale or env", () => {
  for (const path of ["env", "probes", "scale", "origin", "unknown"]) {
    const input = rolloutFixture();
    const desired = structuredClone(input.baseline);
    desired.properties.configuration.activeRevisionsMode = "Multiple";
    desired.properties.configuration.ingress.traffic = [
      { revisionName: input.scope.previousRevision, weight: 100 },
    ];
    desired.properties.template.revisionSuffix = "candidate";
    desired.properties.template.containers[0].image = input.scope.candidateImage;
    if (path === "env" || path === "probes") desired.properties.template.containers[0][path] = [];
    if (path === "scale") desired.properties.template.scale.maxReplicas = 9;
    if (path === "origin") desired.properties.configuration.ingress.allowInsecure = true;
    if (path === "unknown") desired.properties.futureProperty = {};
    input.desired = desired;
    assert.throws(() => generate(input), /revision_preservation_unapproved_property_change/u);
  }
});

test("generation has no cloud or process-execution dependency", () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("NETWORK_FORBIDDEN");
  };
  try {
    assert.equal(generate(rolloutFixture()).cloudRequestsMade, 0);
  } finally {
    globalThis.fetch = original;
  }
  const source = readFileSync("scripts/azure/revision-rollout-plan.mjs", "utf8");
  assert.doesNotMatch(source, /node:(?:child_process|https?|net)|\bfetch\s*\(/u);
});

test("private CLI writes a new 0600 plan, never logs values, overwrites or follows symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "kova-rollout-test-"));
  const file = join(dir, "input.json"),
    output = join(dir, "plan.json");
  const script = fileURLToPath(
    new URL("../../scripts/azure/revision-rollout-plan.mjs", import.meta.url),
  );
  const run = (source = file, destination = output) =>
    spawnSync(process.execPath, [script, source, destination], { encoding: "utf8", timeout: 5000 });
  try {
    writeFileSync(file, JSON.stringify(rolloutFixture("production", new Date().toISOString())), {
      mode: 0o600,
    });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /SYNTHETIC_PRIVATE_MARKER|vault.azure.net|KOVA_AUTH_SECRET/u,
    );
    const saved = documentSha256(JSON.parse(readFileSync(output, "utf8")));
    result = run();
    assert.equal(result.status, 1);
    assert.equal(documentSha256(JSON.parse(readFileSync(output, "utf8"))), saved);
    const link = join(dir, "link.json");
    symlinkSync(file, link);
    assert.equal(run(link, join(dir, "other.json")).status, 1);
    assert.equal(run(file, link).status, 1);
    chmodSync(dir, 0o755);
    assert.match(run(file, join(dir, "other.json")).stderr, /private_output_directory_required/u);
    chmodSync(dir, 0o700);
    const fifo = join(dir, "fifo");
    assert.equal(spawnSync("mkfifo", [fifo], { timeout: 5000 }).status, 0);
    assert.match(run(fifo).stderr, /private_input_required/u);
    chmodSync(file, 0o644);
    assert.match(run().stderr, /private_input_required/u);
    chmodSync(file, 0o600);
    writeFileSync(file, '{"SYNTHETIC_PRIVATE_MARKER":');
    result = run();
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_MARKER/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing staging defaults and production no-ingress migration template remain unchanged", () => {
  const staging = readFileSync("infra/azure/staging/main.bicep", "utf8");
  const production = readFileSync("infra/azure/production/main.bicep", "utf8");
  assert.match(staging, /activeRevisionsMode: 'Single'/u);
  assert.match(staging, /latestRevision: true\s+weight: 100/u);
  assert.match(production, /activeRevisionsMode: 'Single'/u);
  assert.doesNotMatch(production, /^\s*ingress:/mu);
  const rollout = readFileSync("infra/azure/staging/rollout.bicep", "utf8");
  assert.match(rollout, /param enableRevisionRollout bool = false/u);
  assert.match(rollout, /@secure\(\)\s+param rolloutResource object/u);
  assert.doesNotMatch(rollout, /listKeys|reference\(|Microsoft.Authorization|roleAssignments/u);
});

test(
  "installed Bicep compiles opt-in staging with the same secure resource projection",
  { skip: !process.env.KOVA_BICEP_PATH },
  () => {
    const result = spawnSync(
      process.env.KOVA_BICEP_PATH,
      ["build", "infra/azure/staging/rollout.bicep", "--no-restore", "--stdout"],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const compiled = JSON.parse(result.stdout);
    const generated = generate(rolloutFixture("staging")).steps[1].requestBody.properties.template;
    const withoutDescriptions = Object.fromEntries(
      Object.entries(compiled.parameters).map(([key, value]) => {
        const { metadata, ...contract } = value;
        assert.equal(typeof metadata.description, "string");
        return [key, contract];
      }),
    );
    assert.deepEqual(withoutDescriptions, generated.parameters);
    assert.deepEqual(compiled.resources, generated.resources);
    assert.deepEqual(
      Object.keys(compiled.resources[0]).sort(),
      Object.keys(generated.resources[0]).sort(),
    );
  },
);
