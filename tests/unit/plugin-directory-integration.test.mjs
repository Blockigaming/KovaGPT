import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const route = readFileSync(new URL("../../src/routes/apps.tsx", import.meta.url), "utf8");
test("launch directory exposes planned details without unsupported connect actions", () => {
  assert.match(route, /MASTER_PLUGIN_REVIEW_CATALOG/);
  assert.match(route, /const filtered = catalog.filter/);
  assert.match(route, /connectionFilter === "connected" && !hasConnection/);
  assert.match(route, /category !== "all" && c.category !== category/);
  assert.match(route, /setCategory\("all"\)/);
  assert.match(route, /!configured\s*\? "Coming soon"/);
  assert.match(route, /selectedReview.permissions.map/);
  assert.doesNotMatch(route, /google.com\/s2\/favicons|label.slice\(0, 2\)/);
  assert.doesNotMatch(route, /PluginConnectionPreview|plugin-preview/);
});
test("review flow is bundled and routed only through separate local controls", () => {
  const packaging = readFileSync(new URL("../../review-kit/package.mjs", import.meta.url), "utf8");
  const controls = readFileSync(new URL("../../review-kit/review.mjs", import.meta.url), "utf8");
  assert.match(packaging, /buildPluginPreview\(root/);
  assert.match(controls, /openPluginReview/);
  assert.match(controls, /route.abort\(\)/);
});

test("selected account action retains disabled behavior with opaque neutral styling", () => {
  const css = readFileSync(
    new URL("../../src/styles/spec400-plugins.css", import.meta.url),
    "utf8",
  );
  assert.match(
    route,
    /className="spec400-plugin-use-account"\s*disabled=\{[\s\S]*?account.id === visibleGoogleStatus\?\.selectedConnectionId/,
  );
  const rule = css.match(
    /\.spec400-plugin-actions button\.spec400-plugin-use-account:disabled\s*\{([^}]+)\}/,
  )?.[1];
  assert.ok(rule);
  assert.match(rule, /opacity: 1;/);
  assert.match(rule, /background-color: var\(--muted\);/);
  assert.match(rule, /color: var\(--muted-foreground\);/);
  assert.match(rule, /border-color: var\(--border\);/);
  assert.doesNotMatch(rule, /destructive|#[0-9a-f]+|rgba?\(/i);
});
