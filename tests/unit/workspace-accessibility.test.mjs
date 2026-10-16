import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const base = "ac4897de475d90d2615f4d0b72ebe91195a893d1";
const read = (p) => readFileSync(p, "utf8");
const before = (p) => execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
const js = (s) =>
  ts.transpileModule(s, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText;
test("Writing behavior unchanged apart from synchronous guarded Clear focus and target markers", () => {
  const p = "src/components/writing/WritingToolWorkspace.tsx";
  let s = read(p)
    .replace('import { restoreDialogFocus } from "@/lib/dialog-return-focus";\n', "")
    .replace(/  const sourceRef = useRef<HTMLTextAreaElement>\(null\);\n/, "")
    .replace(/\s+ref=\{sourceRef\}/, "")
    .replace(/\s+restoreDialogFocus\(sourceRef.current, window.location.href\);/, "")
    .replaceAll("kova-workspace-action ", "");
  assert.equal(js(s), js(before(p)));
  assert.equal((read(p).match(/kova-workspace-action/g) || []).length, 5);
});
test("Clear focuses the existing source before removing result; no deferred navigation focus", () => {
  const s = read("src/components/writing/WritingToolWorkspace.tsx");
  const body = s.match(
    /onClick=\{\(\) => \{\s*(restoreDialogFocus\(sourceRef.current,[\s\S]*?)\}\}/,
  )[1];
  const calls = [];
  const source = {};
  new Function(
    "restoreDialogFocus",
    "sourceRef",
    "window",
    "setResult",
    "setError",
    "setAnnouncement",
    body,
  )(
    (target, url) => {
      assert.equal(target, source);
      assert.equal(url, "local");
      calls.push("focus");
    },
    { current: source },
    { location: { href: "local" } },
    (v) => {
      assert.equal(v, "");
      calls.push("result");
    },
    (v) => assert.equal(v, ""),
    (v) => assert.equal(v, ""),
  );
  assert.deepEqual(calls, ["focus", "result"]);
});
test("Translation requests, values, selectors and copy logic unchanged", () => {
  const p = "src/components/translation/TranslationWorkspace.tsx";
  assert.equal(js(read(p).replaceAll("kova-workspace-action ", "")), js(before(p)));
  assert.equal((read(p).match(/kova-workspace-action/g) || []).length, 3);
});
test("Organization has one focusable semantic skip target in all account states; logic unchanged", () => {
  const p = "src/components/OrganizationAdminPage.tsx";
  const s = read(p).replace("<AppShell utilitiesInHeader>", "<AppShell>");
  assert.equal((s.match(/id="main-content"/g) || []).length, 1);
  assert.match(s, /<main\s+id="main-content"\s+tabIndex=\{-1\}/);
  assert.equal(js(s.replace(/id="main-content"\s+tabIndex=\{-1\}\s+/, "")), js(before(p)));
});
