import assert from "node:assert/strict";
import test from "node:test";

import {
  KOVA_WORK_EFFORTS,
  KOVA_WORK_FAMILIES,
  KOVA_WORK_ROUTES,
  authorizeKovaWorkSelection,
  kovaWorkOptionsForTier,
  parseKovaWorkSelection,
} from "../../src/lib/kova-work-policy.mjs";

const expectedEfforts = {
  light: { label: "Instant", engine: "kova-core", passes: [0, 1, 0, 0], outputCeiling: 2048 },
  medium: { label: "Medium", engine: "kova-core", passes: [1, 1, 0, 1], outputCeiling: 4096 },
  high: { label: "High", engine: "kova-core", passes: [1, 2, 1, 1], outputCeiling: 8192 },
  "extra-high": {
    label: "Extra High",
    engine: "kova-core",
    passes: [2, 3, 2, 2],
    outputCeiling: 16384,
  },
  max: { label: "Max", engine: "kova-core", passes: [2, 4, 2, 3], outputCeiling: 24576 },
  ultra: { label: "Ultra", engine: "kova-ultra", passes: null, outputCeiling: 32768 },
};

test("Kova Work catalog is exactly three families by six preserved efforts", () => {
  assert.deepEqual(
    KOVA_WORK_FAMILIES.map((family) => family.id),
    ["cosmo", "orion", "nova"],
  );
  assert.equal(KOVA_WORK_EFFORTS.length, 6);
  assert.equal(KOVA_WORK_ROUTES.length, 18);
  assert.equal(new Set(KOVA_WORK_ROUTES.map((route) => route.routeId)).size, 18);

  for (const effort of KOVA_WORK_EFFORTS)
    assert.deepEqual(
      {
        label: effort.label,
        engine: effort.engine,
        passes: effort.passes,
        outputCeiling: effort.outputCeiling,
      },
      expectedEfforts[effort.id],
    );
});

test("Instant is only a display/input alias for existing Light compute", () => {
  assert.deepEqual(parseKovaWorkSelection({ family: "orion", effort: "instant" }), {
    family: "orion",
    effort: "light",
    routeId: "work:orion:light",
  });
  const light = KOVA_WORK_ROUTES.find((route) => route.routeId === "work:orion:light");
  assert.deepEqual(light.passes, [0, 1, 0, 0]);
  assert.equal(light.outputCeiling, 2048);
  assert.equal(light.engine, "kova-core");
});

test("Free has zero Work entitlements while Plus and Pro expose all 18", () => {
  assert.equal(kovaWorkOptionsForTier("free").filter((route) => route.entitled).length, 0);
  assert.equal(kovaWorkOptionsForTier("plus").filter((route) => route.entitled).length, 18);
  assert.equal(kovaWorkOptionsForTier("pro").filter((route) => route.entitled).length, 18);
  assert.ok(
    kovaWorkOptionsForTier("plus").find((route) => route.routeId === "work:nova:ultra")
      .entitled,
  );
});

test("catalog eligibility never claims application runtime integration", () => {
  for (const tier of ["free", "plus", "pro"])
    assert.ok(kovaWorkOptionsForTier(tier).every((route) => route.runtimeVerified === false));
});

test("execution authorization requires exact paid tier, grant and verified runtime route", () => {
  const selection = { family: "nova", effort: "ultra" };
  const routeId = "work:nova:ultra";
  const context = {
    tier: "plus",
    allowedRoutes: new Set([routeId]),
    runtimeRoutes: new Set([routeId]),
  };
  assert.equal(authorizeKovaWorkSelection(selection, context).routeId, routeId);

  for (const change of [
    { tier: "free" },
    { allowedRoutes: new Set() },
    { runtimeRoutes: new Set() },
  ])
    assert.throws(
      () => authorizeKovaWorkSelection(selection, { ...context, ...change }),
      /unavailable/,
    );
});

test("client input cannot alter compute, model, budget or authorization fields", () => {
  for (const value of [
    { family: "cosmo", effort: "light", passes: [9, 9, 9, 9] },
    { family: "cosmo", effort: "light", outputCeiling: 999999 },
    { family: "cosmo", effort: "light", model: "client-model" },
    { family: "cosmo", effort: "light", allowed: true },
    { family: "cosmo", effort: "deep" },
    { family: "unknown", effort: "light" },
  ])
    assert.throws(() => parseKovaWorkSelection(value), /invalid/);
});
