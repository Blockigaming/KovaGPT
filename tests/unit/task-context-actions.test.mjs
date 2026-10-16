import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
const path = "src/components/ScheduledTaskEditor.tsx",
  base = "286bbef3f3f78adb0896eabfff7a49b29be7b9b7";
const before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
const source = process.env.KOVA_REGRESSION_BASE ? before : readFileSync(path, "utf8");
test("Context selector flexes within the Browse row", () => {
  assert.match(source, /className=\{`\$\{control\} min-w-0 flex-1`\}\s+value=\{kind\}/);
});
for (const handler of [
  "() => void loadFiles()",
  "() => setRefs((current) => current.filter((item) => item !== ref))",
  "() => setTriggers((current) => current.filter((_, i) => i !== index))",
])
  test(`Short context action cannot shrink or wrap: ${handler}`, () => {
    const escaped = handler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      source,
      new RegExp(
        "className=\\{`\\$\\{button\\} min-h-11 min-w-11 shrink-0 whitespace-nowrap!`\\}\\s+onClick=\\{" +
          escaped +
          "\\}",
      ),
    );
  });
test("Exactly declared class edits; all task logic, handlers and data remain identical", () => {
  const normalize = (s) =>
    s
      .replaceAll("className={`${control} min-w-0 flex-1`}", "className={control}")
      .replaceAll(
        "className={`${button} min-h-11 min-w-11 shrink-0 whitespace-nowrap!`}",
        "className={button}",
      )
      .replaceAll(
        'className="my-2 flex items-start justify-between gap-2 text-sm"',
        'className="my-2 flex justify-between text-sm"',
      )
      .replaceAll(
        'className="flex items-start justify-between gap-2 text-sm"',
        'className="flex justify-between text-sm"',
      )
      .replaceAll('<span className="min-w-0 flex-1 break-words">', "<span>");
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(compile(normalize(source)), compile(normalize(before)));
  assert.deepEqual(eventAttributes(source), eventAttributes(before));
});
