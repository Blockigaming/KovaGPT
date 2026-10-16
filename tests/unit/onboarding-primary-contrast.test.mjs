import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import postcss from "postcss";
const base = "07339c2c1153b489b8bb6245bfc2147169007e84";
test("Only onboarding shell and three primary footer actions receive markers; all persistence/default/completion code is exact", () => {
  const p = "src/components/OnboardingDialog.tsx",
    current = readFileSync(p, "utf8"),
    old = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
  assert.equal((current.match(/kova-onboarding-primary/g) || []).length, 3);
  const normalized = current
    .replace("kova-onboarding-dialog ", "")
    .replaceAll('className="kova-onboarding-primary"', "");
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(compile(normalized), compile(old));
  for (const path of [
    "src/lib/onboarding.functions.ts",
    "src/lib/onboarding-response-policy.mjs",
    "src/lib/onboarding-handoff.ts",
    "src/components/ui/button.tsx",
    "src/components/ui/dialog.tsx",
  ])
    assert.equal(
      readFileSync(path, "utf8"),
      execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
    );
});
test("New color/focus rules are scoped exclusively to marked onboarding primary actions", () => {
  const p = "src/styles/core-pages.css",
    current = readFileSync(p, "utf8");
  const rules = [];
  postcss.parse(current).walkRules((r) => {
    if (r.selector.startsWith(".kova-onboarding-dialog .kova-onboarding-primary")) rules.push(r);
  });
  assert.equal(rules.length, 4);
  for (const rule of rules) {
    assert.ok(rule.selector.startsWith(".kova-onboarding-dialog .kova-onboarding-primary"));
    for (const d of rule.nodes)
      assert.ok(
        ["background-color", "color", "outline", "outline-offset", "opacity"].includes(d.prop),
      );
  }
});
