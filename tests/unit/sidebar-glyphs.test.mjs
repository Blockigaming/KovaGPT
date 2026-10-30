import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import ts from "typescript";

const source = readFileSync("src/components/SidebarIcons.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;
const glyphs = {};
new Function("exports", "require", compiled)(glyphs, createRequire(import.meta.url));
const expected = [
  "NewChatGlyph",
  "LibraryGlyph",
  "ProjectsGlyph",
  "ImagesGlyph",
  "TasksGlyph",
  "PluginsGlyph",
  "SidebarGlyphIcon",
  "SearchGlyph",
  "SettingsGlyph",
  "MoreGlyph",
  "CustomizeGlyph",
];

const render = (name, props = {}) => renderToStaticMarkup(createElement(glyphs[name], props));

test("pinned SDK sidebar glyphs preserve all eleven exports without a runtime icon dependency", () => {
  assert.deepEqual(Object.keys(glyphs).sort(), [...expected].sort());
  assert.doesNotMatch(source, /@phosphor-icons|lucide-react/);
  const shapes = expected.map((name) => render(name).replace(/^<svg[^>]*>|<\/svg>$/g, ""));
  assert.equal(
    new Set(shapes).size,
    expected.length,
    "Every navigation action has a distinct shape",
  );
});

test("sidebar glyphs preserve the official filled current-color geometry on a square optical grid", () => {
  for (const name of expected) {
    const markup = render(name);
    assert.match(markup, /^<svg[^>]*width="20"[^>]*height="20"/);
    assert.match(markup, /viewBox="0 0 24 24"/);
    assert.match(markup, /fill="currentColor"/);
    assert.match(markup, /data-ui-reference="chatgpt-sdk-icon"/);
    assert.match(markup, /data-icon-source="[A-Za-z]+"/);
    assert.match(markup, /data-kova-navigation-glyph=""/);
    assert.doesNotMatch(markup, /<image|<use|<filter|<mask|<text|#[a-fA-F0-9]{3,8}/);
  }
});

test("glyphs remain decorative and non-focusable while preserving caller props", () => {
  for (const name of expected) {
    assert.match(render(name), /aria-hidden="true" focusable="false"/);
    const markup = render(name, { className: "nav-test", "aria-hidden": false });
    assert.match(markup, /class="nav-test"/);
    assert.match(markup, /aria-hidden="false"/);
    assert.match(markup, /focusable="false"/);
    assert.doesNotMatch(markup, /<title|tabindex|role="button"/);
  }
});

test("one sidebar optical-size rule preserves the upstream filled paths without injecting strokes", () => {
  const rules = [];
  postcss.parse(readFileSync("src/styles/sidebar-core.css", "utf8")).walkRules((rule) => {
    if (rule.selector === "[data-kova-navigation-glyph]") rules.push(rule);
  });
  assert.equal(rules.length, 1);
  const declarations = Object.fromEntries(
    rules[0].nodes.filter((node) => node.type === "decl").map(({ prop, value }) => [prop, value]),
  );
  assert.equal(declarations.width, "20px");
  assert.equal(declarations.height, "20px");
  assert.equal(declarations.stroke, undefined);
  assert.equal(declarations["stroke-width"], undefined);
  assert.match(source, /0f00143c7a639906f1621fe58e1b6be7b5bea46d/);
  assert.ok(
    !readFileSync("src/styles/sidebar-personalization.css", "utf8").includes(
      "[data-kova-navigation-glyph]",
    ),
  );
});
