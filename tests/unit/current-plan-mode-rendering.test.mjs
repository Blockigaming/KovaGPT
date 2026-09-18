import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as entitlements from "../../src/lib/mode-entitlements.mjs";

const nativeRequire = createRequire(import.meta.url);

// Execute the actual repository TypeScript modules with only the external
// account/layout boundaries replaced. No provider, database or browser storage.
function fixture({ signedIn = true, loaded = true, desktop = true } = {}) {
  const cache = new Map();
  const allowed = new Map([
    ["@/lib/modes", "src/lib/modes.ts"],
    ["@/lib/billing-plans", "src/lib/billing-plans.ts"],
    ["@/lib/capability-registry", "src/lib/capability-registry.ts"],
    ["@/components/ResponsiveModelSelector", "src/components/ResponsiveModelSelector.tsx"],
  ]);
  function load(id) {
    if (id === "@/lib/mode-entitlements.mjs") return entitlements;
    if (id === "@/hooks/use-mobile")
      return {
        useLayout: () => ({ isDesktop: desktop, interaction: desktop ? "pointer" : "touch" }),
      };
    if (id === "@/components/auth/ClerkSafe")
      return { useUser: () => ({ isSignedIn: signedIn, isLoaded: loaded }) };
    if (id === "@/components/MobileBottomSheet") return { MobileBottomSheet: () => null };
    if (["react", "react/jsx-runtime", "lucide-react"].includes(id)) return nativeRequire(id);
    if (!allowed.has(id)) throw new Error(`Unexpected test dependency: ${id}`);
    if (cache.has(id)) return cache.get(id);
    const path = allowed.get(id);
    const output = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const module = { exports: {} };
    cache.set(id, module.exports);
    vm.runInNewContext(output, { exports: module.exports, require: load }, { filename: path });
    return module.exports;
  }
  return {
    modes: load("@/lib/modes"),
    registry: load("@/lib/capability-registry").CAPABILITY_REGISTRY,
    render: (tier, mode, placement = "topbar") =>
      renderToStaticMarkup(
        React.createElement(load("@/components/ResponsiveModelSelector").ResponsiveModelSelector, {
          userTier: tier,
          mode,
          placement,
          onChange() {
            throw new Error("Rendering must not submit or change a mode");
          },
        }),
      ),
  };
}

for (const desktop of [true, false]) {
  test(`Plus selected High is displayed as Thinking (${desktop ? "desktop" : "touch"})`, () => {
    const f = fixture({ desktop });
    for (const placement of ["topbar", "composer"]) {
      const html = f.render("plus", "high", placement);
      assert.match(html, /aria-label="Choose model: KovaGPT Thinking"/);
      assert.doesNotMatch(html, /KovaGPT High/);
    }
    assert.equal(f.modes.getMode("high").id, "high");
    assert.equal(f.modes.getMode("high").label, "High");
    assert.equal(f.modes.modesForTier("plus")[2].id, "high");
    assert.equal(
      f.modes.modesForTier("plus")[2].systemPrompt,
      f.modes.getMode("high").systemPrompt,
    );
  });
  test(`Pro keeps High and all six authorized modes (${desktop ? "desktop" : "touch"})`, () => {
    const f = fixture({ desktop });
    assert.deepEqual(
      Array.from(f.modes.modesForTier("pro"), (mode) => mode.id),
      ["instant", "medium", "high", "extra_high", "max", "ultra"],
    );
    assert.match(f.render("pro", "high"), /aria-label="Choose model: KovaGPT High"/);
  });
}

for (const identity of [
  { signedIn: false, loaded: true, tier: "pro" },
  { signedIn: true, loaded: true, tier: "free" },
  { signedIn: true, loaded: false, tier: "pro" },
]) {
  test(`no switchable picker for identity ${JSON.stringify(identity)}`, () => {
    const html = fixture(identity).render(identity.tier, "high");
    assert.doesNotMatch(html, /data-testid="model-selector-trigger"/);
    assert.match(html, /kova-model-static/);
  });
}

test("public modes contain no retired orphan mode and retain the exact per-tier labels", () => {
  const { registry } = fixture();
  assert.deepEqual(
    Array.from(registry.modes, (mode) => mode.id),
    ["instant", "medium", "high", "extra_high", "max", "ultra"],
  );
  for (const mode of registry.modes) {
    const tiers = ["free", "plus", "pro"].filter((tier) =>
      registry.modesByTier[tier].some((entry) => entry.id === mode.id),
    );
    assert.ok(tiers.length > 0);
    assert.equal(mode.minimumTier, tiers[0]);
  }
  assert.deepEqual(
    Array.from(registry.modesByTier.free, (mode) => mode.label),
    ["Instant"],
  );
  assert.deepEqual(
    Array.from(registry.modesByTier.plus, (mode) => mode.label),
    ["Instant", "Medium", "Thinking"],
  );
  assert.equal(registry.modesByTier.pro.find((mode) => mode.id === "high").label, "High");
});

test("published Chat copy does not disguise remaining aggregate limits as unlimited", () => {
  const { registry } = fixture();
  for (const tier of ["plus", "pro"]) {
    const copy = [registry.plans[tier].description, ...registry.plans[tier].features].join(" ");
    assert.match(copy, /No paid Chat message-count quota/);
    assert.match(copy, /token and premium-request limits still apply/);
    assert.doesNotMatch(copy, /unlimited/i);
  }
});
