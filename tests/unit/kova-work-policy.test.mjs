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
    kovaWorkOptionsForTier("plus").find((route) => route.routeId === "work:nova:ultra").entitled,
  );
});

test("catalog eligibility never claims application runtime integration", () => {
  for (const tier of ["free", "plus", "pro"])
    assert.ok(kovaWorkOptionsForTier(tier).every((route) => route.runtimeVerified === false));
});

test("selection authorization requires exact paid tier, grant and verified runtime route", () => {
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

for (const tier of ["free", "plus", "pro"]) {
  for (const route of KOVA_WORK_ROUTES) {
    test(`${tier} selection grant is exact for ${route.routeId}`, () => {
      const input = { family: route.familyId, effort: route.effortId };
      const context = {
        tier,
        allowedRoutes: new Set([route.routeId]),
        runtimeRoutes: new Set([route.routeId]),
      };
      if (tier === "free") {
        assert.throws(() => authorizeKovaWorkSelection(input, context), /unavailable/);
      } else {
        assert.equal(authorizeKovaWorkSelection(input, context), route);
        assert.throws(
          () => authorizeKovaWorkSelection(input, { ...context, allowedRoutes: new Set() }),
          /unavailable/,
        );
        assert.throws(
          () => authorizeKovaWorkSelection(input, { ...context, runtimeRoutes: new Set() }),
          /unavailable/,
        );
      }
    });
  }
}

test("unknown tiers and JSON-shaped fake runtime grants are not permissions", () => {
  for (const tier of [null, undefined, "", "enterprise", "PLUS", 1]) {
    assert.throws(() => kovaWorkOptionsForTier(tier), /invalid/);
  }
  const input = { family: "cosmo", effort: "light" };
  const route = "work:cosmo:light";
  for (const context of [
    { tier: "plus", allowedRoutes: [route], runtimeRoutes: [route] },
    { tier: "pro", allowedRoutes: new Set(["work:*"]), runtimeRoutes: new Set([route]) },
    { tier: "plus", allowedRoutes: new Set([route]), runtimeRoutes: new Set(["work:cosmo:*"]) },
    {
      tier: "plus",
      allowedRoutes: new Set([route]),
      runtimeRoutes: new Set([route]),
      model: "override",
    },
  ]) {
    assert.throws(() => authorizeKovaWorkSelection(input, context), /unavailable/);
  }
});

test("caller edits cannot mutate the shared catalog or later plan options", () => {
  assert.ok(Object.isFrozen(KOVA_WORK_ROUTES));
  for (const route of KOVA_WORK_ROUTES) {
    assert.ok(Object.isFrozen(route));
    if (route.passes) {
      assert.ok(Object.isFrozen(route.passes));
      assert.throws(() => {
        route.passes[0] = 99;
      }, TypeError);
    }
    assert.throws(() => {
      route.outputCeiling = 1;
    }, TypeError);
  }
  const options = kovaWorkOptionsForTier("plus");
  options.pop();
  assert.equal(kovaWorkOptionsForTier("plus").length, 18);
  assert.ok(kovaWorkOptionsForTier("plus").every((option) => option.runtimeVerified === false));
});

test("all public effort spellings normalize without adding compute routes", () => {
  for (const family of KOVA_WORK_FAMILIES) {
    for (const route of KOVA_WORK_ROUTES.filter((item) => item.familyId === family.id)) {
      const input = JSON.parse(JSON.stringify({ family: family.id, effort: route.effortId }));
      assert.equal(parseKovaWorkSelection(input).routeId, route.routeId);
    }
    assert.equal(parseKovaWorkSelection({ family: family.id, effort: "instant" }).effort, "light");
    assert.equal(
      parseKovaWorkSelection({ family: family.id, effort: "extra_high" }).effort,
      "extra-high",
    );
  }
});
