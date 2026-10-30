import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const manifest = JSON.parse(readFileSync("docs/ui-reference-icons.json", "utf8"));
const entryPath = resolve("src/components/ui/product-icons.tsx");
const leafRoot = resolve("src/components/ui/product-icons") + sep;
const modules = new Map();
const sources = new Map();
function loadIconModule(filePath) {
  if (modules.has(filePath)) return modules.get(filePath).exports;
  assert.ok(filePath === entryPath || filePath.startsWith(leafRoot));
  const source = readFileSync(filePath, "utf8");
  sources.set(filePath, source);
  const module = { exports: {} };
  modules.set(filePath, module);
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require(name) {
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return jsxRuntime;
        if (name === "./product-icons.css" && filePath === entryPath) return {};
        if (name.startsWith(".")) {
          const dependency = resolve(dirname(filePath), name);
          const target = [dependency + ".tsx", dependency + ".ts"].find(existsSync);
          if (target) return loadIconModule(target);
        }
        throw Error(`Unexpected icon dependency: ${name}`);
      },
    },
    { filename: filePath },
  );
  return module.exports;
}
const icons = loadIconModule(entryPath);
const source = [...sources.values()].join("\n");
const rows = manifest.mappings.filter((row) => row.kind !== "type-only");
const geometry = new Map(manifest.sourceGlyphs.map((row) => [row.sourceSymbol, row]));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const svgElement = (name, props = {}, ref = null) => {
  const element = icons[name].render(props, ref);
  return element.type === "svg" ? element : element.type(element.props);
};

test("the icon barrel reexports independent leaves without eagerly constructing every glyph", () => {
  const entry = ts.createSourceFile(
    entryPath,
    sources.get(entryPath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  assert.ok(
    entry.statements.every((node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node)),
  );
  const iconExports = entry.statements.filter(
    (node) => ts.isExportDeclaration(node) && !node.isTypeOnly,
  );
  assert.equal(iconExports.length, 184);
  assert.equal(new Set(iconExports.map((node) => node.moduleSpecifier.text)).size, 184);
  assert.equal(
    [...sources.keys()].filter((name) => name.includes(`${sep}glyphs${sep}`)).length,
    manifest.sourceGlyphs.length,
  );
});

// The fingerprints come from the separately fetched and Git-blob-verified upstream
// SVG components, not from this adapter's source or a newly accepted screenshot.
test("all 184 UI icon exports render and retain every pinned upstream SVG path", () => {
  assert.equal(rows.length, 184);
  assert.deepEqual(Object.keys(icons).sort(), rows.map((row) => row.symbol).sort());
  for (const row of rows) {
    const html = renderToStaticMarkup(React.createElement(icons[row.symbol]));
    assert.match(html, /^<svg\b/, row.symbol);
    assert.match(html, new RegExp(`data-product-icon="${row.symbol}"`), row.symbol);
    if (row.kind === "source-css-indicator-proposal") {
      assert.match(html, /<foreignObject width="100%" height="100%">/);
      assert.match(html, /kova-reference-loading-indicator/);
      continue;
    }
    const match = html.match(/<g data-sdk-geometry="([^"]+)"[^>]*>([\s\S]*)<\/g>/);
    assert.ok(match, row.symbol);
    assert.equal(match[1], row.sourceSymbol, row.symbol);
    assert.equal(
      digest(match[2]),
      geometry.get(row.sourceSymbol).sourceGeometryMarkupSha256,
      row.symbol,
    );
  }
  assert.doesNotMatch(source, /GlyphSpin|OpenaiLogo/);
});

test("every adapter keeps SVG props, explicit dimensions, accessible labels, handlers and SVG refs", () => {
  for (const row of rows) {
    let calls = 0;
    const handler = () => calls++;
    const ref = { current: null };
    const style = { color: "rgb(12, 34, 56)", opacity: 0.7 };
    const svg = svgElement(
      row.symbol,
      {
        size: 40,
        width: 27,
        height: 29,
        className: "supplied-svg-class",
        "aria-label": `Action ${row.symbol}`,
        role: "img",
        style,
        onClick: handler,
        onKeyDown: handler,
        absoluteStrokeWidth: true,
      },
      ref,
    );
    assert.equal(svg.type, "svg", row.symbol);
    assert.equal(svg.props.width, 27, row.symbol);
    assert.equal(svg.props.height, 29, row.symbol);
    assert.equal(svg.props.className, "supplied-svg-class", row.symbol);
    assert.equal(svg.props["aria-label"], `Action ${row.symbol}`, row.symbol);
    assert.equal(svg.props["aria-hidden"], undefined, row.symbol);
    assert.equal(svg.props.role, "img", row.symbol);
    assert.equal(svg.props.style, style, row.symbol);
    assert.equal(svg.props.ref, ref, row.symbol);
    assert.equal(Object.hasOwn(svg.props, "absoluteStrokeWidth"), false, row.symbol);
    svg.props.onClick();
    svg.props.onKeyDown();
    assert.equal(calls, 2, row.symbol);
    const sized = svgElement(row.symbol, { size: 31 });
    assert.equal(sized.props.width, 31, row.symbol);
    assert.equal(sized.props.height, 31, row.symbol);
  }
});

test("source paint survives legacy fill=none and stroke props, with true filled-state variants", () => {
  for (const [name, expected] of Object.entries(manifest.stateVariants)) {
    const outline = renderToStaticMarkup(
      React.createElement(icons[name], { fill: "none", stroke: "currentColor", strokeWidth: 8 }),
    );
    assert.match(outline, /<g data-sdk-geometry="[^"]+" fill="currentColor" stroke="none">/);
    const filled = renderToStaticMarkup(
      React.createElement(icons[name], { className: "fill-current" }),
    );
    const match = filled.match(/<g data-sdk-geometry="([^"]+)"[^>]*>([\s\S]*)<\/g>/);
    assert.equal(match[1], expected, name);
    assert.equal(digest(match[2]), geometry.get(expected).sourceGeometryMarkupSha256, name);
    assert.notEqual(
      filled.match(/data-sdk-geometry="([^"]+)"/)[1],
      outline.match(/data-sdk-geometry="([^"]+)"/)[1],
      name,
    );
  }
  const circle = renderToStaticMarkup(React.createElement(icons.Circle));
  assert.match(circle, /data-sdk-geometry="EmptyCircle"/);
  assert.match(circle, /viewBox="0 0 24 24"/);
});

test("loading adapters use the captured CSS indicator once and respect reduced motion", () => {
  for (const name of ["Loader2", "LoaderCircle"]) {
    const svg = svgElement(name, {
      className: "h-4 animate-spin motion-reduce:animate-none",
      strokeWidth: 3,
    });
    assert.equal(svg.props.className, "h-4 motion-reduce:animate-none");
    assert.equal(
      svg.props.viewBox,
      undefined,
      "CSS-pixel stroke stays the same at every rendered size",
    );
    const foreign = React.Children.toArray(svg.props.children).find(
      (node) => node.type === "foreignObject",
    );
    assert.equal(foreign.props.children.props.style["--indicator-stroke"], "3px");
  }
  const css = readFileSync("src/components/ui/product-icons.css", "utf8");
  assert.match(css, /mask-image:\s*conic-gradient/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /0\.8s/);
  const config = ts.createSourceFile(
    "vite.config.ts",
    readFileSync("vite.config.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const aliases = [];
  function walk(node) {
    if (ts.isRegularExpressionLiteral(node)) aliases.push(node.getText(config));
    ts.forEachChild(node, walk);
  }
  walk(config);
  assert.ok(aliases.includes("/^lucide-react$/"), "Only the exact package entry is aliased");
});

test("the existing icon vendor chunk includes only the pinned adapter and legacy icon package", () => {
  const config = ts.createSourceFile(
    "vite.config.ts",
    readFileSync("vite.config.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let classify;
  function walk(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(config) === "manualChunks") {
      classify = new Function("path", "configDir", "id", node.body.getText(config).slice(1, -1));
    }
    ts.forEachChild(node, walk);
  }
  walk(config);
  assert.ok(classify);
  const root = dirname(resolve("vite.config.ts"));
  const chunk = (id) => classify(path, root, id);
  const adapter = resolve("src/components/ui/product-icons");
  for (const suffix of [".tsx", "/factory.tsx", "/glyphs/Plus.tsx", "/icons/Plus.tsx"])
    assert.equal(chunk(adapter + suffix), "vendor-icons", suffix);
  assert.equal(chunk(`${adapter}/glyphs/Plus.tsx?commonjs-proxy`), "vendor-icons");
  assert.equal(chunk(`${adapter}/glyphs/Plus.tsx`.replaceAll("/", "\\")), "vendor-icons");
  assert.equal(
    chunk(resolve("node_modules/lucide-react/dist/esm/lucide-react.js")),
    "vendor-icons",
  );
  for (const file of [
    "src/components/ui/button.tsx",
    "src/components/ui/product-icons-other.tsx",
    "src/components/ui/product-icons.tsx.extra",
    "src/components/ui/product-icons/glyphs/Plus.ts",
    "src/components/ui/product-icons/nested/other/Plus.tsx",
    "src/components/ui/product-icons.css",
    "elsewhere/src/components/ui/product-icons/icons/Plus.tsx",
  ])
    assert.equal(chunk(resolve(file)), undefined, file);
});
