import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const spec = readFileSync("tests/e2e/chatgpt-shell-parity.spec.ts", "utf8");
const authFixture = readFileSync("tests/e2e/authenticated-fixture.ts", "utf8");
const modelSelectorSpec = readFileSync("tests/e2e/model-selector.spec.ts", "utf8");
const browserConfig = readFileSync("playwright.browser.config.ts", "utf8");
const goal = readFileSync("docs/release-reconciliation/chatgpt-parity-target.md", "utf8");

test("ChatGPT-parity verification covers every required width, theme, and auth state", () => {
  for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 1728]) {
    assert.match(spec, new RegExp(`\\b${width}\\b`, "u"));
    assert.match(goal, new RegExp(`\\b${width}\\b`, "u"));
  }
  assert.match(spec, /const themes = \["light", "dark"\]/u);
  assert.match(spec, /signed-out shell/u);
  assert.match(spec, /signed-in shell/u);
  assert.match(spec, /installAuthenticatedFixture/u);
  assert.match(authFixture, /page\.route\(supabaseRequestPattern/u);
  assert.match(authFixture, /url\.pathname === "\/auth\/v1\/user"/u);
  assert.match(
    spec,
    /locator\("header"\)[\s\S]*?getByRole\("button", \{ name: "Account menu", exact: true \}\)/u,
  );
  assert.doesNotMatch(spec, /KOVA_E2E_SIGNED_IN/u);
  assert.doesNotMatch(spec, /authenticated storage state/u);
  for (const engine of ["chromium", "firefox", "webkit"]) {
    assert.match(browserConfig, new RegExp(engine, "iu"));
  }
});

test("required model-selector coverage uses an isolated authenticated fixture and cannot skip", () => {
  // Free is deliberately upgrade-only; require explicit paid fixtures rather
  // than asserting that every authenticated account can choose a model.
  for (const tier of ["free", "plus", "pro"]) {
    assert.ok(
      modelSelectorSpec.includes(`installAuthenticatedFixture(page, { tier: "${tier}" })`),
      `model controls must exercise the ${tier} subscription independently`,
    );
  }
  assert.match(modelSelectorSpec, /thinking-upgrade-button/u);
  assert.match(modelSelectorSpec, /Choose model: KovaGPT Thinking/u);
  assert.match(modelSelectorSpec, /model-option-high/u);
  assert.match(modelSelectorSpec, /expect\(chatRequests\)\.toBe\(0\)/u);
  assert.doesNotMatch(modelSelectorSpec, /test(?:Info)?\.(?:skip|fixme)/u);
  assert.doesNotMatch(modelSelectorSpec, /Model selector not present/u);
});

test("the visual goal explicitly rejects a futuristic dashboard detour", () => {
  assert.match(goal, /not a separate futuristic dashboard/iu);
  assert.match(goal, /conversation-first/iu);
  assert.match(goal, /No Voice mode/iu);
  assert.match(goal, /Source code alone is not visual proof/iu);
});
