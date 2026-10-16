import { supportHierarchy } from "../helpers/settings-support-hierarchy.mjs";
import { dialogRules } from "../helpers/workspace-layout-preservation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const base = "df1c42b759cfc04d78753e6f1221cbb6bf359e7b";
const old = (p) => execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
test("Root correction only excludes dialogs from menu-row reset; all other CSS and variant contracts preserved", () => {
  const p = "src/styles/chatgpt-parity.css";
  assert.deepEqual(
    dialogRules(readFileSync(p, "utf8")),
    dialogRules(
      old(p)
        .replace(
          "/* Menu rows: keep only the soft grey highlight, never a hard outline box. */",
          "/* Menu rows only: dialog actions retain their variant color pair and the shared focus outline. */",
        )
        .replace(
          '[role="listbox"], [role="dialog"], .kova-model-menu',
          '[role="listbox"], .kova-model-menu',
        ),
    ),
  );
  for (const p of [
    "src/components/ui/button.tsx",
    "src/components/ui/dialog.tsx",
    "src/components/ui/alert-dialog.tsx",
    "src/components/OnboardingDialog.tsx",
    "src/components/ConfirmActionDialog.tsx",
    "src/components/LogoutConfirmDialog.tsx",
    "src/components/SelectionEditDialog.tsx",
    "src/components/SettingsDialog.tsx",
    "src/components/auth/AuthDialog.tsx",
    "src/lib/dialog-return-focus.ts",
    "src/lib/chat-store.ts",
  ])
    if (p.endsWith("SettingsDialog.tsx")) {
      const compile = (source) =>
        ts.transpileModule(source, {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        }).outputText;
      assert.equal(compile(readFileSync(p, "utf8")), compile(supportHierarchy(old(p))), p);
    } else assert.equal(readFileSync(p, "utf8"), old(p), p);
});
test("Temporary dialog only adds two phone target markers; handlers, choice defaults, focus return and banner unchanged", () => {
  const p = "src/components/TemporaryChatStartDialog.tsx",
    current = readFileSync(p, "utf8");
  assert.equal((current.match(/className="kova-workspace-action"/g) || []).length, 2);
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(
    compile(current.replaceAll('className="kova-workspace-action"', "")),
    compile(old(p)),
  );
});

test("Unrelated shared dialog and focus CSS remains exact after page spacing correction", () => {
  for (const p of ["src/styles.css", "src/styles/core-pages.css"])
    assert.deepEqual(
      dialogRules(readFileSync(p, "utf8")).filter(
        (rule) => !rule.startsWith(".image-lightbox > button:last-child:focus-visible"),
      ),
      dialogRules(
        execFileSync("git", ["show", "ebd244977ac7250a291e71f08a1d802f383868c5:" + p], {
          encoding: "utf8",
        }),
      ),
    );
});
