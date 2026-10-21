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

test("custom sidebar glyphs preserve all eleven exports without icon-package geometry", () => {
  assert.deepEqual(Object.keys(glyphs).sort(), [...expected].sort());
  assert.doesNotMatch(source, /@phosphor-icons|lucide-react/);
  const shapes = expected.map((name) => render(name).replace(/^<svg[^>]*>|<\/svg>$/g, ""));
  assert.equal(
    new Set(shapes).size,
    expected.length,
    "Every navigation action has a distinct shape",
  );
});

test("sidebar glyphs share a square optical grid and rounded current-color strokes", () => {
  for (const name of expected) {
    const markup = render(name);
    assert.match(markup, /^<svg[^>]*width="20"[^>]*height="20"/);
    assert.match(markup, /viewBox="0 0 24 24"/);
    assert.match(markup, /fill="none" stroke="currentColor" stroke-width="1.7"/);
    assert.match(markup, /stroke-linecap="round" stroke-linejoin="round"/);
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

test("sidebar styling paints glyphs with the canonical rounded 2px stroke", () => {
  const css = postcss.parse(readFileSync("src/styles/sidebar-personalization.css", "utf8"));
  const rules = [];
  css.walkRules((rule) => {
    if (rule.selector.includes("[data-kova-navigation-glyph]")) rules.push(rule);
  });
  assert.equal(rules.length, 1);
  const declarations = Object.fromEntries(
    rules[0].nodes.filter((node) => node.type === "decl").map(({ prop, value }) => [prop, value]),
  );
  assert.equal(declarations.width, "22px");
  assert.equal(declarations.height, "22px");
  assert.equal(declarations.stroke, "currentColor");
  // The unchanged SVG presentation attribute is an unstyled optical fallback;
  // the shared CSS token owns the painted navigation stroke.
  assert.equal(declarations["stroke-width"], "var(--kova-icon-stroke, 2)");
  const strokes = [];
  postcss
    .parse(readFileSync("src/styles/spec400-system.css", "utf8"))
    .walkDecls("--kova-icon-stroke", ({ value }) => strokes.push(value));
  assert.deepEqual(strokes, ["2"], "One canonical stroke token supplies the 2px contract");
  const shared = [];
  postcss.parse(readFileSync("src/styles/sidebar-core.css", "utf8")).walkRules((rule) => {
    if (rule.selector.endsWith(".kova-sidebar-icon svg")) shared.push(rule);
  });
  assert.equal(shared.length, 1);
  assert.equal(
    shared[0].nodes.findLast((node) => node.prop === "stroke-width")?.value,
    "var(--kova-icon-stroke, 2)",
  );
  assert.equal(declarations["stroke-linecap"], "round");
  assert.equal(declarations["stroke-linejoin"], "round");
});
