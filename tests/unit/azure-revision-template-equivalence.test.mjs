import assert from "node:assert/strict";
import test from "node:test";
import { rolloutFixture, bindCapture } from "../helpers/azure-revision-rollout-fixture.mjs";
import {
  compareRevisionTemplates,
  TEMPLATE_COMPARISON_POLICY,
} from "../../scripts/azure/revision-template-equivalence.mjs";
import { generateSecretPreservingRevisionRolloutPlan } from "../../scripts/azure/revision-rollout-plan.mjs";

const now = "2026-10-12T18:00:00.000Z";
function fixture() {
  const v = rolloutFixture();
  v.scope.secretPreservingPatchOptIn = true;
  v.scope.templateComparisonPolicy = TEMPLATE_COMPARISON_POLICY;
  const a = v.baseline.properties.template;
  const b = v.previousRevision.properties.template;
  a.revisionSuffix = "";
  b.revisionSuffix = null;
  a.scale.cooldownPeriod = 300;
  a.scale.pollingInterval = 30;
  b.scale.cooldownPeriod = null;
  b.scale.pollingInterval = null;
  a.containers[0].resources.ephemeralStorage = "1Gi";
  for (let i = 0; i < 5; i += 1) {
    a.containers[0].env.push({ name: `SYNTHETIC_${i}`, secretRef: "synthetic-auth", value: "" });
    b.containers[0].env.push({ name: `SYNTHETIC_${i}`, secretRef: "synthetic-auth" });
  }
  return bindCapture(v);
}
const compare = (v) => compareRevisionTemplates({ ...v, apiVersion: v.inventory.apiVersion });

test("all nine retained representation shapes compare without changing raw inputs", () => {
  const v = fixture();
  const raw = JSON.stringify(v);
  const result = compare(v);
  assert.equal(result.result, "PASS");
  assert.equal(result.normalizedPaths.length, 9);
  assert.equal(result.liveAcceptanceEstablished, false);
  assert.equal(JSON.stringify(v), raw);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_|synthetic-auth|1Gi/u);
});

test("explicit policy permits offline PATCH generation but transmits unchanged secretRef entries", () => {
  const v = fixture();
  const plan = generateSecretPreservingRevisionRolloutPlan(v, { now });
  assert.equal(plan.preservation.templateComparison.normalizedPaths.length, 9);
  assert.equal(plan.cloudRequestsMade, 0);
  assert.equal(plan.liveAcceptanceEstablished, false);
  const transmitted = plan.steps[1].requestBody.properties.template.containers[0];
  assert.deepEqual(transmitted.env, v.baseline.properties.template.containers[0].env);
  assert.equal(Object.hasOwn(transmitted.resources, "ephemeralStorage"), false);
  assert.equal(Object.hasOwn(plan.steps[1].requestBody.properties.template, "scale"), false);
});

test("default raw-exact policy is unchanged", () => {
  const v = fixture();
  delete v.scope.templateComparisonPolicy;
  assert.throws(
    () => generateSecretPreservingRevisionRolloutPlan(v, { now }),
    /previous_revision_unverified/u,
  );
});

for (const [name, mutate] of [
  [
    "changed secret reference",
    (v) => {
      v.previousRevision.properties.template.containers[0].env.at(-1).secretRef = "other";
    },
  ],
  [
    "nonempty competing value",
    (v) => {
      v.previousRevision.properties.template.containers[0].env.at(-1).value = "SYNTHETIC_PRIVATE";
    },
  ],
  [
    "null competing value",
    (v) => {
      v.previousRevision.properties.template.containers[0].env.at(-1).value = null;
    },
  ],
  [
    "literal empty versus absent without secretRef",
    (v) => {
      delete v.baseline.properties.template.containers[0].env.at(-1).secretRef;
      delete v.previousRevision.properties.template.containers[0].env.at(-1).secretRef;
    },
  ],
  [
    "nondefault cooldown",
    (v) => {
      v.baseline.properties.template.scale.cooldownPeriod = 301;
    },
  ],
  [
    "nondefault polling",
    (v) => {
      v.baseline.properties.template.scale.pollingInterval = 31;
    },
  ],
  [
    "contradictory observed storage",
    (v) => {
      v.previousRevision.properties.template.containers[0].resources.ephemeralStorage = "2Gi";
    },
  ],
  [
    "changed memory",
    (v) => {
      v.previousRevision.properties.template.containers[0].resources.memory = "2Gi";
    },
  ],
  [
    "changed image",
    (v) => {
      v.previousRevision.properties.template.containers[0].image += "other";
    },
  ],
  [
    "unknown property dropped",
    (v) => {
      delete v.previousRevision.properties.template.futureTemplate;
    },
  ],
  [
    "reordered containers",
    (v) => {
      v.previousRevision.properties.template.containers.reverse();
    },
  ],
  [
    "probe changed",
    (v) => {
      v.previousRevision.properties.template.containers[0].probes[0].tcpSocket.port = 8080;
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const v = fixture();
    mutate(v);
    assert.equal(compare(v).result, "FAIL");
    bindCapture(v);
    assert.throws(
      () => generateSecretPreservingRevisionRolloutPlan(v, { now }),
      /previous_revision_unverified/u,
    );
  });
}

for (const [name, mutate] of [
  [
    "different API",
    (v) => {
      v.inventory.apiVersion = "2026-01-01";
    },
  ],
  [
    "different revision id",
    (v) => {
      v.previousRevision.id += "other";
    },
  ],
  [
    "different latest-ready binding",
    (v) => {
      v.baseline.properties.latestReadyRevisionName += "other";
    },
  ],
  [
    "nonempty different suffix",
    (v) => {
      v.baseline.properties.template.revisionSuffix = "other";
    },
  ],
  [
    "ambiguous duplicate env",
    (v) => {
      v.previousRevision.properties.template.containers[0].env.push(
        v.previousRevision.properties.template.containers[0].env[0],
      );
    },
  ],
]) {
  test(`fails closed on ${name}`, () => {
    const v = fixture();
    mutate(v);
    assert.throws(() => compare(v), /^Error: revision_preservation_template_evidence_invalid$/u);
  });
}

for (const state of ["Activating", "Scaling", "Stopped"]) {
  test(`template equivalence does not waive ${state} previous health`, () => {
    const v = fixture();
    v.previousRevision.properties.runningState = state;
    bindCapture(v);
    assert.equal(compare(v).result, "PASS");
    assert.throws(
      () => generateSecretPreservingRevisionRolloutPlan(v, { now }),
      /previous_revision_unverified/u,
    );
  });
}

test("capture hash, freshness, unapproved changes and unknown policy still fail", () => {
  const v = fixture();
  v.inventory.baselineSha256 = "0".repeat(64);
  assert.throws(
    () => generateSecretPreservingRevisionRolloutPlan(v, { now }),
    /capture_hash_mismatch/u,
  );
  bindCapture(v);
  assert.throws(
    () => generateSecretPreservingRevisionRolloutPlan(v, { now: "2026-10-12T18:10:00.000Z" }),
    /bounded_window_required|fresh_capture_required/u,
  );
  v.scope.templateComparisonPolicy = "ignore-all-differences";
  assert.throws(
    () => generateSecretPreservingRevisionRolloutPlan(v, { now }),
    /template_policy_invalid/u,
  );
  v.scope.templateComparisonPolicy = TEMPLATE_COMPARISON_POLICY;
  v.desired = structuredClone(v.baseline);
  v.desired.properties.configuration.secrets = [];
  assert.throws(
    () => generateSecretPreservingRevisionRolloutPlan(v, { now }),
    /unapproved_property_change/u,
  );
});
