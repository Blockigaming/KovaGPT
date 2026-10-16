import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const source = readFileSync("src/components/WorkSessionPanel.tsx", "utf8");
const match = source.match(
  /<p className="text-xs text-muted-foreground">\s+Your status:[\s\S]*?<\/p>/,
);
assert.ok(match);
const module = { exports: {} };
vm.runInNewContext(
  ts.transpileModule("export function Status({selected}){return (" + match[0] + ");}", {
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
  },
);
for (const count of [0, 1, 2])
  test(`Rendered Work planning count ${count} uses correct singular/plural`, () => {
    const html = renderToStaticMarkup(
      runtime.jsx(module.exports.Status, {
        selected: { status: "draft", events: Array(count).fill({}) },
      }),
    );
    assert.ok(
      html.includes(
        `Your status: draft. ${count} planning ${count === 1 ? "action" : "actions"} recorded.`,
      ),
    );
  });
test(
  "Planning count correction preserves the complete component except the declared text expression",
  { skip: !process.env.KOVA_WORK_SESSION_BASE_SOURCE },
  () => {
    const before = readFileSync(process.env.KOVA_WORK_SESSION_BASE_SOURCE, "utf8");
    const expected = before.replace(
      "Your status: {selected.status}. {selected.events.length} planning actions recorded.",
      'Your status: {selected.status}. {selected.events.length} planning{" "}\n            {selected.events.length === 1 ? "action" : "actions"} recorded.',
    );
    assert.equal(source, expected);
  },
);
