import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { reviewRevisionPreservation } from "../../scripts/azure/revision-preservation.mjs";

const target =
  "/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-prod/providers/Microsoft.App/containerApps/kovagpt-prod-web";
const image = (suffix) =>
  `kovagptacr-dte9hugbhjghcyb8.azurecr.io/kovagpt-web@sha256:${suffix.repeat(64)}`;
function fixture() {
  const scope = {
    schemaVersion: 1,
    sourceSha: "a".repeat(40),
    targetResourceId: target,
    containerName: "web",
    previousRevision: "kovagpt-prod-web--previous",
    previousImage: image("b"),
    candidateImage: image("c"),
    candidateSuffix: "candidate",
  };
  const baseline = {
    id: target,
    name: "kovagpt-prod-web",
    type: "Microsoft.App/containerApps",
    identity: { type: "UserAssigned", userAssignedIdentities: { synthetic: {} } },
    properties: {
      environmentId: "synthetic-existing-environment",
      runningStatus: "Running",
      latestReadyRevisionName: scope.previousRevision,
      configuration: {
        activeRevisionsMode: "Single",
        secrets: [
          {
            name: "owned-auth",
            keyVaultUrl: "https://synthetic.vault.azure.net/secrets/owned-auth/version1",
            identity: "synthetic",
          },
        ],
        ingress: {
          external: true,
          targetPort: 3000,
          allowInsecure: false,
          clientCertificateMode: "require",
          ipSecurityRestrictions: [
            { name: "synthetic-origin", action: "Allow", ipAddressRange: "192.0.2.0/24" },
          ],
          traffic: [{ latestRevision: true, weight: 100 }],
        },
        registries: [{ server: "kovagptacr-dte9hugbhjghcyb8.azurecr.io", identity: "synthetic" }],
      },
      template: {
        revisionSuffix: "previous",
        scale: { minReplicas: 0, maxReplicas: 4 },
        containers: [
          {
            name: "web",
            image: scope.previousImage,
            resources: { cpu: 0.5, memory: "1Gi" },
            env: [
              { name: "KOVA_AUTH_SECRET", secretRef: "owned-auth" },
              { name: "AI_GENERATION_ENABLED", value: "false" },
            ],
            probes: [{ type: "Readiness", httpGet: { path: "/api/readyz", port: 3000 } }],
          },
        ],
      },
    },
  };
  const desired = structuredClone(baseline);
  desired.properties.configuration.activeRevisionsMode = "Multiple";
  desired.properties.configuration.ingress.traffic = [
    { revisionName: scope.previousRevision, weight: 100 },
  ];
  desired.properties.template.containers[0].image = scope.candidateImage;
  desired.properties.template.revisionSuffix = scope.candidateSuffix;
  const previousRevision = {
    id: `${target}/revisions/${scope.previousRevision}`,
    name: scope.previousRevision,
    properties: {
      active: true,
      healthState: "Healthy",
      runningState: "Running",
      template: structuredClone(baseline.properties.template),
    },
  };
  return { baseline, desired, scope, previousRevision };
}

test("offline candidate preserves all configuration and pins initial traffic to prior revision", () => {
  const value = fixture();
  const before = JSON.stringify(value);
  const result = reviewRevisionPreservation(value);
  assert.equal(result.result, "PASS");
  assert.equal(result.initialCandidateTrafficPercent, 0);
  assert.equal(result.previousTrafficPercent, 100);
  assert.equal(result.deploymentReady, false);
  assert.equal(result.authorizationGranted, false);
  assert.equal(result.rollbackExercised, false);
  assert.equal(result.incrementalCandidateCostEstablished, false);
  assert.equal(JSON.stringify(value), before);
  assert.doesNotMatch(
    JSON.stringify(result),
    /KOVA_AUTH_SECRET|owned-auth|vault.azure.net|192.0.2/u,
  );
});

test("retained ARM id casing and managedEnvironmentId stay compatible without changing target", () => {
  const value = fixture();
  value.scope.targetResourceId = target.toLowerCase();
  for (const document of [value.baseline, value.desired]) {
    document.id = target.toLowerCase();
    document.properties.managedEnvironmentId = document.properties.environmentId;
    delete document.properties.environmentId;
  }
  value.previousRevision.id = value.previousRevision.id.toLowerCase();
  assert.equal(reviewRevisionPreservation(value).result, "PASS");
  value.scope.targetResourceId += "-other";
  assert.throws(() => reviewRevisionPreservation(value), /revision_preservation_target_invalid/u);
});

for (const [name, mutate, gate] of [
  [
    "untrusted revision text",
    (v) => {
      v.scope.previousRevision = "kovagpt-prod-web--old\nSYNTHETIC_PRIVATE";
    },
    "revision_binding_invalid",
  ],
  [
    "rehearsal app",
    (v) => {
      v.desired.id += "-auth-rehearsal";
    },
    "resource_binding_invalid",
  ],
  [
    "stopped baseline",
    (v) => {
      v.baseline.properties.runningStatus = "Stopped";
    },
    "serving_baseline_required",
  ],
  [
    "old revision unavailable",
    (v) => {
      v.previousRevision.properties.active = false;
    },
    "previous_revision_unverified",
  ],
  [
    "old revision not healthy",
    (v) => {
      v.previousRevision.properties.healthState = "Unhealthy";
    },
    "previous_revision_unverified",
  ],
  [
    "old revision configuration mismatch",
    (v) => {
      v.previousRevision.properties.template.containers[0].env = [];
    },
    "previous_revision_unverified",
  ],
  [
    "mutable image",
    (v) => {
      v.scope.candidateImage = v.scope.candidateImage.split("@")[0] + ":latest";
    },
    "image_binding_invalid",
  ],
  [
    "replica increase",
    (v) => {
      v.desired.properties.template.scale.maxReplicas = 5;
    },
    "unapproved_property_change",
  ],
  [
    "cost-frozen zero replicas",
    (v) => {
      v.desired.properties.template.scale.maxReplicas = 0;
    },
    "unapproved_property_change",
  ],
  [
    "cost-frozen missing ingress",
    (v) => {
      v.desired.properties.configuration.ingress = null;
    },
    "unapproved_property_change",
  ],
  [
    "dropped environment",
    (v) => {
      v.desired.properties.template.containers[0].env = [];
    },
    "unapproved_property_change",
  ],
  [
    "secret reference changed",
    (v) => {
      v.desired.properties.configuration.secrets[0].keyVaultUrl += "changed";
    },
    "unapproved_property_change",
  ],
  [
    "identity changed",
    (v) => {
      v.desired.identity = { type: "SystemAssigned" };
    },
    "unapproved_property_change",
  ],
  [
    "origin protection relaxed",
    (v) => {
      v.desired.properties.configuration.ingress.clientCertificateMode = "ignore";
    },
    "unapproved_property_change",
  ],
  [
    "readiness probe removed",
    (v) => {
      v.desired.properties.template.containers[0].probes = [];
    },
    "unapproved_property_change",
  ],
  [
    "provider enabled",
    (v) => {
      v.desired.properties.template.containers[0].env[1].value = "true";
    },
    "unapproved_property_change",
  ],
  [
    "latest revision traffic",
    (v) => {
      v.desired.properties.configuration.ingress.traffic = [{ latestRevision: true, weight: 100 }];
    },
    "unapproved_property_change",
  ],
  [
    "early canary traffic",
    (v) => {
      v.desired.properties.configuration.ingress.traffic = [
        { revisionName: v.scope.previousRevision, weight: 95 },
        { revisionName: "kovagpt-prod-web--candidate", weight: 5 },
      ];
    },
    "unapproved_property_change",
  ],
  [
    "unreviewed new property",
    (v) => {
      v.desired.properties.template.newPlatformSetting = true;
    },
    "unapproved_property_change",
  ],
  [
    "uncaptured environment array",
    (v) => {
      delete v.baseline.properties.template.containers[0].env;
    },
    "complete_containers_required",
  ],
  [
    "partial secret inventory",
    (v) => {
      delete v.baseline.properties.configuration.secrets;
    },
    "full_configuration_required",
  ],
]) {
  test(`fails closed for ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.throws(
      () => reviewRevisionPreservation(value),
      new RegExp(`^Error: revision_preservation_${gate}$`, "u"),
    );
  });
}

test("CLI uses private bounded files and never leaks malformed input or changed values", () => {
  const dir = mkdtempSync(join(tmpdir(), "kova-offline-preservation-"));
  const file = join(dir, "input.json");
  const script = fileURLToPath(
    new URL("../../scripts/azure/revision-preservation.mjs", import.meta.url),
  );
  const run = () =>
    spawnSync(process.execPath, [script, file], { encoding: "utf8", timeout: 5000 });
  try {
    writeFileSync(file, JSON.stringify(fixture()), { mode: 0o600 });
    assert.equal(run().status, 0);
    chmodSync(file, 0o644);
    assert.match(run().stderr, /revision_preservation_private_input_required/u);
    chmodSync(file, 0o600);
    writeFileSync(file, '{"SYNTHETIC_NEVER_ECHO":');
    let result = run();
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_NEVER_ECHO/u);
    const v = fixture();
    v.desired.properties.template.containers[0].env[0].value = "SYNTHETIC_NEVER_ECHO";
    writeFileSync(file, JSON.stringify(v));
    result = run();
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_NEVER_ECHO/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
