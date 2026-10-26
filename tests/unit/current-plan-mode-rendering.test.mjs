import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as entitlements from "../../src/lib/mode-entitlements.mjs";
import * as modelIdentity from "../../src/lib/kova-model-identity.mjs";

const nativeRequire = createRequire(import.meta.url);

// Execute the actual repository TypeScript modules with only the external
// account/layout boundaries replaced. No provider, database or browser storage.
function fixture({ signedIn = true, loaded = true, desktop = true, menuOpen = false } = {}) {
  const cache = new Map();
  const allowed = new Map([
    ["@/lib/modes", "src/lib/modes.ts"],
    ["@/lib/mode-display-label", "src/lib/mode-display-label.ts"],
    ["@/lib/billing-plans", "src/lib/billing-plans.ts"],
    ["@/lib/capability-registry", "src/lib/capability-registry.ts"],
    ["@/components/ResponsiveModelSelector", "src/components/ResponsiveModelSelector.tsx"],
    ["@/components/NovaLogo", "src/components/NovaLogo.tsx"],
  ]);
  function load(id) {
    if (id === "@/lib/mode-entitlements.mjs") return entitlements;
    if (id === "@/lib/kova-model-identity.mjs") return modelIdentity;
    if (id === "@/hooks/use-mobile")
      return {
        useLayout: () => ({ isDesktop: desktop, interaction: desktop ? "pointer" : "touch" }),
      };
    if (id === "@/components/auth/ClerkSafe")
      return { useUser: () => ({ isSignedIn: signedIn, isLoaded: loaded }) };
    if (id === "@/components/MobileBottomSheet")
      return { MobileBottomSheet: ({ open, children }) => (open ? children : null) };
    if (id === "@/components/ui/popover")
      return {
        Popover: ({ children }) => children,
        PopoverTrigger: ({ children }) => children,
        PopoverContent: ({ children }) => (menuOpen ? children : null),
      };
    // Render the actual option markup in both layouts without a browser or effects.
    if (id === "react" && menuOpen) return { ...React, useState: () => React.useState(true) };
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
    displayLabel: load("@/lib/mode-display-label").modeDisplayLabel,
    render: (tier, mode, placement = "topbar", compact = false) =>
      renderToStaticMarkup(
        React.createElement(load("@/components/ResponsiveModelSelector").ResponsiveModelSelector, {
          userTier: tier,
          mode,
          placement,
          compact,
          onChange() {
            throw new Error("Rendering must not submit or change a mode");
          },
        }),
      ),
  };
}

for (const desktop of [true, false]) {
  test(`Instant display agrees between Pricing, collapsed trigger and options (${desktop ? "desktop" : "touch"})`, () => {
    const closed = fixture({ desktop });
    const open = fixture({ desktop, menuOpen: true });
    const expected = {
      plus: ["Instant", "Medium", "Thinking"],
      pro: ["Instant", "Medium", "High", "Extra high", "Max", "Ultra"],
    };
    assert.equal(closed.registry.plans.free.features[0], "Instant mode");
    for (const tier of ["plus", "pro"]) {
      for (const placement of ["topbar", "composer"]) {
        for (const compact of [true, false]) {
          const html = closed.render(tier, "instant", placement, compact);
          assert.match(html, /aria-label="Choose model: Kova GPT Instant"/);
          assert.doesNotMatch(html, /\bLite\b|data-testid="model-option-/);
        }
      }
      const openHtml = open.render(tier, "instant", "composer");
      assert.ok(openHtml.includes(`Kova GPT ${modelIdentity.KOVA_MODEL_VERSION}`));
      const options = Array.from(
        openHtml.matchAll(
          /data-testid="model-option-([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g,
        ),
        (match) => [match[1], match[2]],
      );
      assert.deepEqual(
        options.map(([id]) => id),
        entitlements.MODE_IDS_BY_TIER[tier],
      );
      assert.deepEqual(
        options.map(([, label]) => label),
        expected[tier],
      );
      for (const [, label] of options) {
        assert.ok(closed.registry.plans[tier].features[0].includes(label));
      }
    }
    const free = open.render("free", "instant", "composer");
    assert.match(free, /kova-model-static/);
    assert.doesNotMatch(free, /data-testid="model-option-|model-selector-trigger/);
  });

  test(`Plus selected High is displayed as Thinking (${desktop ? "desktop" : "touch"})`, () => {
    const f = fixture({ desktop });
    for (const placement of ["topbar", "composer"]) {
      const html = f.render("plus", "high", placement);
      assert.match(html, /aria-label="Choose model: Kova GPT Thinking"/);
      assert.doesNotMatch(html, /Kova GPT High/);
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
    assert.match(f.render("pro", "high"), /aria-label="Choose model: Kova GPT High"/);
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
    ["Lite"],
  );
  assert.deepEqual(
    Array.from(registry.modesByTier.plus, (mode) => mode.label),
    ["Lite", "Medium", "Thinking"],
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

test("pricing uses public Instant wording with exact tier choices and singular Free mode", () => {
  const { registry, modes } = fixture();
  assert.equal(registry.plans.free.features[0], "Instant mode");
  assert.equal(registry.plans.plus.features[0], "Instant, Medium, and Thinking modes");
  assert.equal(
    registry.plans.pro.features[0],
    "Instant, Medium, High, Extra high, Max, and Ultra modes",
  );
  assert.match(
    registry.plans.plus.description,
    /^Instant, Medium, Thinking, and Adaptive Memory\./,
  );
  assert.match(
    registry.plans.pro.description,
    /^Instant, Medium, High, Extra high, Max, and Ultra\./,
  );
  assert.doesNotMatch(registry.plans.free.features[0], /Thinking/);
  assert.doesNotMatch(registry.plans.plus.features[0], /High/);
  for (const tier of ["free", "plus", "pro"]) {
    assert.deepEqual(
      Array.from(registry.modesByTier[tier], (mode) => mode.id),
      entitlements.MODE_IDS_BY_TIER[tier],
    );
    const publicCopy = [registry.plans[tier].description, ...registry.plans[tier].features].join(
      " ",
    );
    assert.doesNotMatch(publicCopy, /\bLite\b|All six Chat modes/);
    for (const mode of modes.modesForTier(tier)) {
      assert.equal(mode.systemPrompt, modes.getMode(mode.id).systemPrompt);
    }
  }
  assert.equal(modes.getMode("instant").label, "Lite", "compatibility labels remain unchanged");
  assert.equal(modes.getMode("high").label, "High");
});

test("public mode wording leaves prices, billing identifiers and allowance copy unchanged", () => {
  const { registry } = fixture();
  assert.deepEqual(
    ["free", "plus", "pro"].map((tier) => registry.plans[tier].monthlyPriceUsd),
    [0, 16, 80],
  );
  for (const tier of ["plus", "pro"]) {
    assert.equal(registry.plans[tier].lookupKey, `${tier}_monthly`);
    assert.match(registry.plans[tier].features[1], /token and premium-request limits still apply/);
    assert.equal(
      registry.plans[tier].features.at(-1),
      "Adaptive Memory when enabled and available",
    );
  }
  assert.deepEqual(Array.from(registry.plans.free.features.slice(1, 5)), [
    "Small message allowance",
    "3 image generations per day",
    "2 file uploads per day",
    "Small published storage allowance",
  ]);
});

test("display mapping preserves compatibility catalog, provider prompts and 1/3/6 entitlement identities", () => {
  const f = fixture();
  const before = JSON.stringify(f.modes.MODES);
  for (const tier of ["free", "plus", "pro"]) {
    const allowed = f.modes.modesForTier(tier);
    assert.equal(allowed.length, { free: 1, plus: 3, pro: 6 }[tier]);
    assert.deepEqual(
      Array.from(allowed, (mode) => mode.id),
      entitlements.MODE_IDS_BY_TIER[tier],
    );
    for (const mode of allowed) {
      assert.equal(f.displayLabel(mode), mode.id === "instant" ? "Instant" : mode.label);
      assert.equal(mode.systemPrompt, f.modes.getMode(mode.id).systemPrompt);
    }
  }
  assert.equal(JSON.stringify(f.modes.MODES), before);
  assert.equal(f.modes.getMode("instant").label, "Lite");
  assert.match(f.modes.getMode("instant").systemPrompt, /Mode: Lite\./);
  // The compatibility catalog used by /modes and llms.txt is outside this UI-label change.
  assert.equal(f.registry.modesByTier.free[0].label, "Lite");
  assert.match(readFileSync("public/llms.txt", "utf8"), /Free uses Lite/);
  assert.match(readFileSync("src/routes/getting-started.tsx", "utf8"), /Free includes Instant\./);
});
