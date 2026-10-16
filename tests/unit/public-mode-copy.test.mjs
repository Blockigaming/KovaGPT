import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createContentLoader } from "../../scripts/publication/source-loader.mjs";
const base = "22d356b89e40b55e71091114da7afb1b786c4bf3";
const { load } = createContentLoader();
const copy = load("src/lib/public-mode-copy.ts"),
  registry = load("src/lib/capability-registry.ts").CAPABILITY_REGISTRY;
const modes = load("src/lib/modes.ts"),
  policy = load("src/lib/mode-entitlements.mjs");
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
function renderRoute(path) {
  const module = { exports: {} };
  vm.runInNewContext(compile(readFileSync(path, "utf8")), {
    module,
    exports: module.exports,
    require(id) {
      if (id === "react/jsx-runtime") return runtime;
      if (id === "@tanstack/react-router")
        return {
          createFileRoute: () => (o) => o,
          Link: ({ to, hash, children, ...props }) =>
            runtime.jsx("a", { ...props, href: to + (hash ? "#" + hash : ""), children }),
        };
      if (id === "@/components/public/PublicShell")
        return { PublicShell: ({ children }) => runtime.jsx("div", { children }) };
      if (id === "@/components/LegalArticle")
        return { LegalArticle: ({ children }) => runtime.jsx("main", { children }) };
      if (id.startsWith("@/lib/")) return load(id);
      throw Error(id);
    },
  });
  return renderToStaticMarkup(runtime.jsx(module.exports.Route.component, {}));
}
test("Public summary and mode titles derive exact IDs and per-tier labels without adding entitlements", () => {
  for (const tier of ["free", "plus", "pro"]) {
    assert.deepEqual(
      Array.from(registry.modesByTier[tier], (m) => m.id),
      Array.from(policy.MODE_IDS_BY_TIER[tier]),
    );
    assert.deepEqual(
      Array.from(registry.modesByTier[tier], (m) => m.label),
      Array.from(modes.modesForTier(tier), (m) => m.label),
    );
    assert.ok(
      copy.PUBLIC_MODE_PLAN_SUMMARY.includes(
        `${registry.plans[tier].name} includes ${registry.modesByTier[tier].map((m) => m.label).join(", ")}.`,
      ),
    );
  }
  assert.equal(
    copy.PUBLIC_MODE_PLAN_SUMMARY,
    "Free includes Lite. Plus includes Lite, Medium, Thinking. Pro includes Lite, Medium, High, Extra high, Max, Ultra.",
  );
  assert.equal(copy.publicModeLabel("high"), "Thinking (Plus) / High (Pro)");
  assert.equal(copy.publicModeLabel("instant"), "Lite");
  assert.equal(copy.publicModeLabel("thinking"), "Not included in current plans");
});
test("Rendered onboarding and mode cards use canonical plan labels and retain provider limits", () => {
  const onboarding = renderRoute("src/routes/getting-started.tsx"),
    modes = renderRoute("src/routes/modes.tsx");
  assert.ok(onboarding.includes(copy.PUBLIC_MODE_PLAN_SUMMARY));
  assert.doesNotMatch(onboarding, /Free includes Instant|Free includes.*Thinking\. Plus/);
  assert.match(modes, />Thinking \(Plus\) \/ High \(Pro\)<\/h2>/);
  for (const html of [onboarding, modes]) {
    assert.match(html, /do not identify the serving model/);
    assert.match(html, /availability depends on the configured provider/);
  }
  assert.match(modes, /<dt[^>]*>Plus<\/dt><dd[^>]*>Lite, Medium, Thinking<\/dd>/);
  assert.doesNotMatch(modes, /<h2[^>]*>Thinking<\/h2>/);
});
test("Exactly18 standalone links opt in; prose-inline support links remain untouched", () => {
  for (const [path, count] of [
    ["assistants", 1],
    ["getting-started", 10],
    ["modes", 5],
    ["contact-support", 2],
  ])
    assert.equal(
      (readFileSync(`src/routes/${path}.tsx`, "utf8").match(/kova-public-action-link/g) || [])
        .length,
      count,
      path,
    );
  const contact = renderRoute("src/routes/contact-support.tsx");
  assert.match(contact, /href="\/help#support-form"/);
  assert.match(contact, /<a href="mailto:support@kovagpt.com">/);
  assert.match(contact, /New to KovaGPT\? <a href="\/getting-started">/);
});
test("Assistant directory logic and contact destinations remain exact apart from target marker", () => {
  for (const p of ["src/routes/assistants.tsx", "src/routes/contact-support.tsx"]) {
    const before = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
    const after = readFileSync(p, "utf8")
      .replaceAll('className="kova-public-action-link"', "")
      .replaceAll("kova-public-action-link ", "");
    assert.equal(compile(after), compile(before));
  }
});
test("Canonical policy, labels, registry, billing and composer contracts are byte-identical", () => {
  for (const p of [
    "src/lib/mode-entitlements.mjs",
    "src/lib/modes.ts",
    "src/lib/capability-registry.ts",
    "src/lib/billing-plans.ts",
    "src/lib/core-launch-policy.mjs",
    "src/components/ResponsiveModelSelector.tsx",
    "src/components/ComposerModelStatus.tsx",
    "src/routes/pricing.tsx",
  ])
    assert.equal(
      p === "src/lib/core-launch-policy.mjs"
        ? readFileSync(p, "utf8").replace('  "/work",\n', "").replace('  "/discovery",\n', "")
        : readFileSync(p, "utf8"),
      execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
      p,
    );
});
