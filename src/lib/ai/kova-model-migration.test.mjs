import test from "node:test";
import assert from "node:assert/strict";
import {
  KOVA_MODEL_CATALOG,
  KOVA_SELF_HOSTED_DEFAULT_ENABLED,
  eligibleForSelfHosted,
  resolveKovaModelAlias,
} from "./kova-model-migration.mjs";

test("stable model names and tiers", () => {
  assert.deepEqual(
    Object.values(KOVA_MODEL_CATALOG).map(({ name }) => name),
    ["Kova Xenon 1", "Kova Neon 1", "Kova Argon 1"],
  );
  assert.equal(resolveKovaModelAlias("kova-neon-1")?.tier, "balanced");
  assert.equal(resolveKovaModelAlias("unknown"), null);
});

test("self-hosted migration defaults off and fails closed", () => {
  assert.equal(KOVA_SELF_HOSTED_DEFAULT_ENABLED, false);
  assert.equal(eligibleForSelfHosted(), false);
  assert.equal(eligibleForSelfHosted({ enabled: true, healthy: false }), false);
  assert.equal(eligibleForSelfHosted({
    enabled: true,
    healthy: true,
    requiredCapabilities: ["chat", "tool_calls"],
    verifiedCapabilities: ["chat"],
  }), false);
  assert.equal(eligibleForSelfHosted({
    enabled: true,
    healthy: true,
    requiredCapabilities: ["chat", "tool_calls"],
    verifiedCapabilities: ["chat", "tool_calls"],
  }), true);
});
