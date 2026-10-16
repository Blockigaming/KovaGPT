import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import postcss from "postcss";
import ts from "typescript";
const base = "8b634b3bea1a4f1472831dc7696442961a546355";
test("Native focus rules remain intact after the separately tested dialog/menu scope correction", () => {
  const p = "src/styles/chatgpt-parity.css",
    old = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" })
      // Compact secondary headers removed only this obsolete competing margin.
      .replace(".kova-page-header {\n  margin-bottom: 24px !important;\n}\n", ""),
    current = readFileSync(p, "utf8")
      .replace(
        "/* Menu rows only: dialog actions retain their variant color pair and the shared focus outline. */",
        "/* Menu rows: keep only the soft grey highlight, never a hard outline box. */",
      )
      .replace(
        '[role="listbox"], .kova-model-menu, .kova-glass)',
        '[role="listbox"], [role="dialog"], .kova-model-menu, .kova-glass)',
      );
  assert.ok(current.startsWith(old));
  const rules = [];
  postcss.parse(current.slice(old.length)).walkRules((r) => rules.push(r));
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, [
    'html input[type="checkbox"]:focus-visible',
    'html input[type="radio"]:focus-visible',
  ]);
  for (const d of rules[0].nodes) assert.equal(d.important, true);
});
test("Native checked/default/permission declarations survive subsequent presentation changes", () => {
  const inputs = (source, path) => {
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out = [];
    function visit(n) {
      if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === "input") {
        const type = n.attributes.properties.find((p) => p.name?.getText(ast) === "type")
          ?.initializer?.text;
        if (["checkbox", "radio"].includes(type)) out.push(n.getText(ast));
      }
      ts.forEachChild(n, visit);
    }
    visit(ast);
    return out;
  };
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=M", base, "--", "src/**/*.tsx"],
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const p of changed)
    assert.deepEqual(
      inputs(readFileSync(p, "utf8"), p),
      inputs(execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }), p),
      p,
    );
});
