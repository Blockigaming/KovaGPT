import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const source = readFileSync("src/routes/work.tsx", "utf8");
const afterHeader =
  '<div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">\n        <div className="min-w-0 flex-[1_1_16rem]">\n          <h3 className="font-semibold">Dependency graph</h3>';
// Historical byte-equivalence for the earlier header-only patch is retained in
// its frozen receipt. The current candidate intentionally changes Fit geometry,
// measured-card layout and viewport fitting, covered by work-graph-viewport.
test("Actual graph header JSX keeps the full descriptive text and all three controls in normal flow", () => {
  const start = source.indexOf(afterHeader);
  const end = source.indexOf("</div>\n      <div\n", start) + 6;
  assert.ok(start > 0 && end > start);
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule("export function Header(){return (" + source.slice(start, end) + ");}", {
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
      fit() {},
      setScale() {},
    },
  );
  const html = renderToStaticMarkup(runtime.jsx(module.exports.Header, {}));
  assert.match(html, /flex shrink-0 flex-wrap items-center justify-between gap-3/);
  assert.match(html, /min-w-0 flex-\[1_1_16rem\]/);
  assert.match(html, /Authoritative persisted task dependencies\. No estimated percentage\./);
  assert.equal((html.match(/<button/g) || []).length, 3);
  assert.match(html, /<button class="work-small shrink-0 whitespace-nowrap!">Fit<\/button>/);
  assert.doesNotMatch(html, /overflow-hidden|absolute|hidden="/);
});
