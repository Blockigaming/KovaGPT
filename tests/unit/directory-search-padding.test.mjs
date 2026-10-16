import { eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import postcss from "postcss";
const base = "a9267b24fc3498e8dcb32aee2764f8e70127ecb5";
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
for (const route of ["library", "projects"])
  test(`${route}: only the existing icon search wrapper opts in; query/filter/action code unchanged`, () => {
    const p = `src/routes/${route}.tsx`,
      old = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
      actual = readFileSync(p, "utf8");
    assert.equal((actual.match(/kova-directory-search-with-icon/g) || []).length, 1);
    assert.deepEqual(eventAttributes(actual), eventAttributes(old));
    assert.equal(
      compile(actual.slice(0, actual.indexOf("  return (\n    <AppShell"))),
      compile(old.slice(0, old.indexOf("  return (\n    <AppShell"))),
    );
  });
test("Icon-free Kovas, shared Input and files redirect remain byte-identical", () => {
  for (const p of ["src/routes/kovas.tsx", "src/components/ui/input.tsx", "src/routes/files.tsx"])
    assert.equal(
      readFileSync(p, "utf8").replace("<AppShell utilitiesInHeader>", "<AppShell>"),
      execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
    );
  assert.match(
    readFileSync("src/routes/files.tsx", "utf8"),
    /throw redirect\(\{ to: "\/library", replace: true \}\)/,
  );
});
test("Opt-in search padding rule preserves dimensions; later unrelated CSS is allowed", () => {
  const p = "src/styles/core-pages.css",
    current = readFileSync(p, "utf8");
  const rules = [];
  postcss.parse(current).walkRules((r) => {
    if (r.selector === ".kova-directory-search.kova-directory-search-with-icon input")
      rules.push(r);
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, ".kova-directory-search.kova-directory-search-with-icon input");
  assert.deepEqual(
    rules[0].nodes.map((d) => [d.prop, d.value]),
    [["padding-left", "2.25rem"]],
  );
});
