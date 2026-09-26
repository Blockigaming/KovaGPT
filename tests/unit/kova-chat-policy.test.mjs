import assert from "node:assert/strict";
import test from "node:test";

import {
  KOVA_CHAT_EFFORTS,
  KOVA_CHAT_FAMILIES,
  KOVA_CHAT_ROUTES,
  authorizeKovaChatSelection,
  kovaChatOptionsForTier,
  kovaModelsChatSelection,
  parseKovaChatSelection,
} from "../../src/lib/kova-chat-policy.mjs";
import { KOVA_WORK_EFFORTS } from "../../src/lib/kova-work-policy.mjs";

test("Chat has only Cosmo and Orion, with shared per-family effort settings", () => {
  assert.deepEqual(
    KOVA_CHAT_FAMILIES.map((family) => family.id),
    ["cosmo", "orion"],
  );
  assert.equal(KOVA_CHAT_EFFORTS, KOVA_WORK_EFFORTS);
  assert.equal(KOVA_CHAT_ROUTES.length, 12);
  assert.equal(new Set(KOVA_CHAT_ROUTES.map((route) => route.routeId)).size, 12);
  assert.ok(KOVA_CHAT_ROUTES.every((route) => route.familyId !== "nova"));
  assert.ok(KOVA_CHAT_ROUTES.every((route) => !Object.hasOwn(route, "model")));
});

test("guest and Free see one Chat choice; Plus six and Pro twelve", () => {
  for (const [tier, routes] of Object.entries({
    guest: ["chat:cosmo:light"],
    free: ["chat:cosmo:light"],
    plus: [
      "chat:cosmo:light",
      "chat:cosmo:medium",
      "chat:cosmo:high",
      "chat:orion:light",
      "chat:orion:medium",
      "chat:orion:high",
    ],
    pro: KOVA_CHAT_ROUTES.map((route) => route.routeId),
  })) {
    const options = kovaChatOptionsForTier(tier);
    assert.deepEqual(
      options.filter((route) => route.entitled).map((route) => route.routeId),
      routes,
    );
    assert.ok(options.every((route) => route.runtimeVerified === false));
    assert.ok(Object.isFrozen(options));
  }
});

test("Lite and Extra High wire labels match the Models v2 selection schema", () => {
  assert.deepEqual(kovaModelsChatSelection({ family: "cosmo", effort: "lite" }), {
    schema_version: "kova-models.v2",
    surface: "chat",
    family: "cosmo",
    effort: "Light",
  });
  assert.deepEqual(kovaModelsChatSelection({ family: "orion", effort: "extra_high" }), {
    schema_version: "kova-models.v2",
    surface: "chat",
    family: "orion",
    effort: "Extra High",
  });
  assert.deepEqual(parseKovaChatSelection({ family: "cosmo", effort: "instant" }), {
    family: "cosmo",
    effort: "light",
    routeId: "chat:cosmo:light",
  });
  for (const route of KOVA_CHAT_ROUTES) {
    const wire = kovaModelsChatSelection({ family: route.familyId, effort: route.effortId });
    assert.equal(wire.schema_version, "kova-models.v2");
    assert.equal(wire.surface, "chat");
    assert.equal(wire.family, route.familyId);
  }
});

test("every Chat selection requires tier policy, exact grant and verified runtime route", () => {
  for (const tier of ["guest", "free", "plus", "pro"]) {
    for (const route of KOVA_CHAT_ROUTES) {
      const input = { family: route.familyId, effort: route.effortId };
      const context = {
        tier,
        allowedRoutes: new Set([route.routeId]),
        runtimeRoutes: new Set([route.routeId]),
      };
      const entitled = kovaChatOptionsForTier(tier).find(
        (option) => option.routeId === route.routeId,
      ).entitled;
      if (entitled) assert.equal(authorizeKovaChatSelection(input, context), route);
      else assert.throws(() => authorizeKovaChatSelection(input, context), /unavailable/);
      assert.throws(
        () => authorizeKovaChatSelection(input, { ...context, allowedRoutes: new Set() }),
        /unavailable/,
      );
      assert.throws(
        () => authorizeKovaChatSelection(input, { ...context, runtimeRoutes: new Set() }),
        /unavailable/,
      );
    }
  }
});

test("client input and JSON-shaped grants cannot set a model, budget, wildcard or Auto route", () => {
  for (const value of [
    { family: "cosmo", effort: "light", model: "client-model" },
    { family: "cosmo", effort: "light", passes: [9, 9, 9, 9] },
    { family: "orion", effort: "ultra", outputCeiling: 999999 },
    { family: "nova", effort: "light" },
    { family: "cosmo", effort: "auto" },
    { family: "cosmo", effort: "thinking" },
  ])
    assert.throws(() => parseKovaChatSelection(value), /invalid/);
  assert.throws(() => kovaChatOptionsForTier("enterprise"), /invalid/);
  const input = { family: "orion", effort: "ultra" };
  const route = "chat:orion:ultra";
  for (const context of [
    { tier: "pro", allowedRoutes: [route], runtimeRoutes: [route] },
    { tier: "pro", allowedRoutes: new Set(["chat:*"]), runtimeRoutes: new Set([route]) },
    {
      tier: "pro",
      allowedRoutes: new Set([route]),
      runtimeRoutes: new Set(["chat:orion:*"]),
    },
    {
      tier: new String("pro"),
      allowedRoutes: new Set([route]),
      runtimeRoutes: new Set([route]),
    },
    {
      tier: "pro",
      allowedRoutes: new Set([route]),
      runtimeRoutes: new Set([route]),
      model: "override",
    },
  ])
    assert.throws(() => authorizeKovaChatSelection(input, context), /unavailable/);
});
