import assert from "node:assert/strict";
import test from "node:test";
import { withAlwaysOnGatewayScale } from "../../scripts/azure/activate-gateway-scale.mjs";

const observed = () => ({
  revisionSuffix: "preserved-source",
  containers: [
    {
      name: "web",
      image: "registry.azurecr.io/web@sha256:" + "a".repeat(64),
      env: [
        { name: "KOVA_WORK_RUNNER_TOKEN", secretRef: "runner-token" },
        { name: "KOVA_MODEL_DEFAULT_CHAT", value: "kova-argon-4.6" },
      ],
      resources: { cpu: 1, memory: "2Gi" },
      probes: [{ type: "Readiness", tcpSocket: { port: 3000 } }],
    },
  ],
  scale: {
    minReplicas: 0,
    maxReplicas: 4,
    cooldownPeriod: 120,
    rules: [{ name: "http-existing", http: { metadata: { concurrentRequests: "20" } } }],
  },
});

test("live activation keeps one gateway warm without changing image, credentials, resources or probes", () => {
  const before = observed();
  const snapshot = structuredClone(before);
  const after = withAlwaysOnGatewayScale(before);
  assert.deepEqual(before, snapshot, "observed production state is not mutated");
  assert.deepEqual(after.containers, before.containers);
  assert.equal(after.revisionSuffix, before.revisionSuffix);
  assert.equal(after.scale.minReplicas, 1);
  assert.equal(after.scale.maxReplicas, 4);
  assert.equal(after.scale.cooldownPeriod, 120);
  assert.deepEqual(after.scale.rules, before.scale.rules);
});

test("activation never reduces an existing warm capacity without traffic evidence", () => {
  const before = observed();
  before.scale.minReplicas = 2;
  assert.equal(withAlwaysOnGatewayScale(before).scale.minReplicas, 2);
  before.scale.maxReplicas = 8;
  assert.throws(() => withAlwaysOnGatewayScale(before), /requires_review/);
});

test("activation adds a bounded HTTP rule while preserving unrelated scale rules", () => {
  const before = observed();
  before.scale.rules = [{ name: "queue", custom: { type: "azure-queue", metadata: {} } }];
  const after = withAlwaysOnGatewayScale(before);
  assert.deepEqual(after.scale.rules[0], before.scale.rules[0]);
  assert.deepEqual(after.scale.rules[1].http.metadata, { concurrentRequests: "20" });
});

test("unknown topology and ambiguous scaling are rejected before a live patch", () => {
  for (const mutate of [
    (x) => delete x.scale,
    (x) => (x.scale.minReplicas = -1),
    (x) => (x.scale.maxReplicas = 0),
    (x) => (x.containers[0].name = "different-service"),
    (x) => x.containers.push({ name: "another-service" }),
    (x) => x.scale.rules.push({ name: "second-http", http: {} }),
  ]) {
    const before = observed();
    mutate(before);
    assert.throws(() => withAlwaysOnGatewayScale(before), /requires_review/);
  }
});
