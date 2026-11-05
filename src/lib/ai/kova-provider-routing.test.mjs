import test from "node:test";
import assert from "node:assert/strict";
import { chooseKovaProvider, migrationBucket, normalizeMigrationConfig } from "./kova-provider-routing.mjs";

const eligible = {
  modelId: "kova-argon-5",
  routingKey: "pseudonymous-user-1",
  healthy: true,
  requiredCapabilities: ["chat", "streaming", "tool_calls"],
  verifiedCapabilities: ["chat", "streaming", "tool_calls"],
  config: { enabled: true, rolloutPercent: 100 },
};

test("migration defaults off", () => {
  assert.equal(chooseKovaProvider({ ...eligible, config: {} }).provider, "existing");
});
test("healthy and verified requests can route to self-hosted", () => {
  assert.equal(chooseKovaProvider(eligible).provider, "kova_self_hosted");
});
test("emergency rollback overrides full rollout", () => {
  assert.equal(chooseKovaProvider({
    ...eligible, config: { enabled: true, rolloutPercent: 100, emergencyRollback: true },
  }).provider, "existing");
});
test("unverified tool capability fails closed", () => {
  assert.equal(chooseKovaProvider({
    ...eligible, verifiedCapabilities: ["chat", "streaming"],
  }).provider, "existing");
});
test("unhealthy inference fails closed", () => {
  assert.equal(chooseKovaProvider({ ...eligible, healthy: false }).provider, "existing");
});
test("missing routing key fails closed", () => {
  assert.equal(chooseKovaProvider({ ...eligible, routingKey: "" }).provider, "existing");
});
test("unknown model alias fails closed", () => {
  assert.equal(chooseKovaProvider({ ...eligible, modelId: "random" }).provider, "existing");
});
test("buckets are stable and rollout bounds are safe", () => {
  assert.equal(migrationBucket("stable"), migrationBucket("stable"));
  assert.equal(normalizeMigrationConfig({ rolloutPercent: 200 }).rolloutPercent, 0);
  assert.equal(chooseKovaProvider({
    ...eligible, config: { enabled: true, rolloutPercent: 0 },
  }).provider, "existing");
});
