import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCapabilityTruth,
  publicClaimDecision,
} from "../../scripts/publication/capabilities.mjs";
import { createContentLoader } from "../../scripts/publication/source-loader.mjs";
const truth = buildCapabilityTruth();

test("every registry feature and configured connector has an evidence-backed truth entry", () => {
  const { load } = createContentLoader();
  const registry = load("src/lib/capability-registry.ts").CAPABILITY_REGISTRY;
  for (const id of Object.keys(registry.features))
    assert.ok(truth.capabilities.some((entry) => entry.id === id));
  for (const app of registry.workingApps)
    assert.ok(
      truth.capabilities.some(
        (entry) => entry.label === app && entry.publicStatus === "configuration-dependent",
      ),
    );
  assert.equal(
    new Set(truth.capabilities.map((entry) => entry.id)).size,
    truth.capabilities.length,
  );
  assert.ok(Object.values(truth.evidence).every((hash) => /^[a-f0-9]{64}$/.test(hash)));
});
test("source code, plan copy and screenshots never certify live availability", () => {
  assert.equal(truth.productionVerifiedCount, 0);
  for (const entry of truth.capabilities) {
    assert.equal(entry.productionVerified, false);
    assert.equal(entry.deploymentEvidence, null);
    assert.equal(publicClaimDecision(entry, "use-now"), false);
    assert.equal(publicClaimDecision(entry, "describe"), true);
    for (const path of entry.evidence) assert.ok(readFileSync(path).length > 0);
  }
  assert.ok(truth.plans.every((plan) => plan.liveCheckoutVerified === false));
});
test("Maps, removed products, and unavailable connected health/finances remain unavailable for immediate-use claims", () => {
  const byId = new Map(truth.capabilities.map((entry) => [entry.id, entry]));
  assert.equal(byId.get("maps").publicStatus, "release-gated");
  assert.equal(byId.get("deepResearch").publicStatus, "excluded");
  assert.equal(byId.get("codex").publicStatus, "excluded");
  assert.equal(byId.get("health").publicStatus, "unavailable");
  assert.equal(byId.get("finances").publicStatus, "unavailable");
  assert.notEqual(byId.get("webSearch").publicStatus, "excluded");
});
test("broader platform definitions are retained as declarations, never merged into live-feature claims", () => {
  const expected = createContentLoader().load("src/platform/capabilities.ts").CAPABILITIES;
  assert.deepEqual(
    truth.platformDeclarations.map((entry) => entry.id),
    Array.from(expected, (entry) => entry.id),
  );
  assert.ok(
    truth.platformDeclarations.every((entry) => entry.status === "catalog-declaration-only"),
  );
});
test("unrecognized status and incomplete live evidence fail the immediate-use decision", () => {
  assert.equal(publicClaimDecision(undefined, "use-now"), false);
  assert.equal(
    publicClaimDecision({ productionVerified: true, publicStatus: "release-gated" }, "use-now"),
    false,
  );
  assert.equal(
    publicClaimDecision({ productionVerified: false, publicStatus: "live-verified" }, "use-now"),
    false,
  );
  assert.equal(publicClaimDecision({}, "anything"), false);
});
test("content loader rejects external modules and paths outside its explicit source areas", () => {
  const { load } = createContentLoader();
  assert.throws(() => load("package.json"), /outside approved/);
  assert.throws(() => load("src/routes/index.tsx"), /outside approved/);
  assert.throws(() => load("missing-file"), /missing/);
});
