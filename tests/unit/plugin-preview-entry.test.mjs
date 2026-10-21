import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
const source = readFileSync(
  new URL("../../review-kit/plugin-preview.tsx", import.meta.url),
  "utf8",
);

test("standalone preview bundles outside production with its existing UI dependencies", () => {
  const result = buildSync({
    entryPoints: ["review-kit/plugin-preview.tsx"],
    bundle: true,
    loader: { ".svg": "dataurl" },
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    logLevel: "silent",
  });
  assert.ok(result.outputFiles[0].text.length > 0);
});

test("review entry exposes every catalog provider, appearance and local reset controls", () => {
  assert.match(source, /LAUNCH_PLUGIN_REVIEW_CATALOG\.map/);
  assert.match(source, /getPluginPreviewProvider\(providerId\)/);
  assert.match(source, /aria-label="Preview appearance"/);
  assert.match(source, /htmlFor="preview-provider"/);
  assert.match(source, /Reset and open preview/);
  assert.match(source, /Connection preview · sample data/);
  assert.match(source, /returnFocusRef=\{trigger\}/);
  assert.doesNotMatch(
    source,
    /\b(?:fetch|useServerFn|localStorage|sessionStorage|window\.open)\s*\(/,
  );
});

test("shared launch catalog supplies all thirteen preview providers", () => {
  const result = buildSync({
    entryPoints: ["src/lib/plugin-review-catalog.ts"],
    bundle: true,
    loader: { ".svg": "dataurl" },
    write: false,
    format: "cjs",
    platform: "node",
    logLevel: "silent",
  });
  const module = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
  const { LAUNCH_PLUGIN_REVIEW_CATALOG: catalog, getPluginPreviewProvider: provider } =
    module.exports;
  assert.equal(catalog.length, 13);
  assert.equal(new Set(catalog.map((entry) => entry.connector.id)).size, 13);
  for (const entry of catalog) {
    const value = provider(entry.connector.id);
    assert.equal(value.id, entry.connector.id);
    assert.ok(value.label);
    assert.ok(value.permissions.length);
    assert.ok(value.availabilityNote);
  }
});
