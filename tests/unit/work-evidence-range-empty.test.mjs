import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { compile } from "@tailwindcss/node";
const source = readFileSync("src/routes/work.tsx", "utf8");
const compiler = await compile(readFileSync("src/styles.css", "utf8"), {
  base: `${process.cwd()}/src`,
  onDependency() {},
});
const css = compiler.build(["kova-work-evidence-range", "mt-1", "w-full"]);
function declarations(selector) {
  const result = {};
  postcss.parse(css).walkRules((rule) => {
    if (
      rule.selector
        .split(",")
        .map((value) => value.trim())
        .includes(selector)
    )
      rule.walkDecls((decl) => {
        result[decl.prop] = decl.value;
      });
  });
  return result;
}
test("The real compiled Work range has visible theme-token tracks and thumb styling for both native engines", () => {
  for (const pseudo of ["::-webkit-slider-runnable-track", "::-moz-range-track"]) {
    const d = declarations("input.kova-work-evidence-range" + pseudo);
    assert.equal(d.height, "4px");
    assert.equal(d.background, "var(--muted-foreground)");
  }
  for (const pseudo of ["::-webkit-slider-thumb", "::-moz-range-thumb"]) {
    const d = declarations("input.kova-work-evidence-range" + pseudo);
    assert.equal(d.background, "var(--primary)");
    assert.equal(d.border, "2px solid var(--background)");
  }
  assert.equal(declarations("input.kova-work-evidence-range").height, "var(--layout-touch)");
  assert.equal(
    declarations("input.kova-work-evidence-range:focus-visible").outline,
    "2px solid var(--ring)",
  );
  assert.equal(declarations("input.kova-work-evidence-range:disabled").cursor, "not-allowed");
});
test("Native range type, bounds, value and change handler remain intact", () => {
  assert.match(
    source,
    /className="kova-work-evidence-range mt-1 w-full"\s+type="range"\s+min="0"\s+max=\{Math.max\(0, detail.events.length - 1\)\}\s+value=\{Math.max\(0, cursor\)\}\s+onChange=\{\(e\) => setCursor\(Number\(e.target.value\)\)\}/,
  );
});
const block = source.slice(
  source.indexOf("function Deliverables("),
  source.indexOf("function Approvals("),
);
const empty = block.match(/<EmptyState\s+icon=\{FileText\}[^]*?\/>/)[0];
const module = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(`export function Empty({items}) { return (${empty}); }`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    module,
    exports: module.exports,
    require: (id) => {
      assert.equal(id, "react/jsx-runtime");
      return runtime;
    },
    FileText: () => null,
    EmptyState: ({ title, description }) =>
      runtime.jsxs("div", {
        children: [
          runtime.jsx("h2", { children: title }),
          runtime.jsx("p", { children: description }),
        ],
      }),
  },
);
for (const [items, title, description] of [
  [[], "No deliverables", "Generated Project"],
  [[{ title: "Existing fixture" }], "No matching deliverables", "Try another title or file type."],
])
  test(`Actual empty-state JSX renders ${title}`, () => {
    const html = renderToStaticMarkup(runtime.jsx(module.exports.Empty, { items }));
    assert.ok(html.includes(`<h2>${title}</h2>`));
    assert.ok(html.includes(description));
    assert.match(block, /!shown.length &&/);
  });
