import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const { safeDocumentFilename } = loadUiModule("src/lib/writing-export/common.ts", {});
function expression(name) {
  const source = ts.createSourceFile(
    "editor.tsx",
    readFileSync("src/components/ArtifactEditor.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === name)
      found = n.initializer.getText(source);
    ts.forEachChild(n, visit);
  }
  visit(source);
  return (
    ts.transpileModule("const fn=" + found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
      .outputText + ";return fn;"
  );
}
test("source export includes current title and final textarea keystroke without claiming a save", async () => {
  let blob, anchor;
  const env = {
    kind: "writing",
    artifactTitle: "Unsaved / title",
    value: "older React snapshot",
    textareaRef: { current: { value: "Latest final keystroke **bold**" } },
    Blob,
    URL: {
      createObjectURL: (v) => {
        blob = v;
        return "blob:local";
      },
      revokeObjectURL() {},
    },
    document: { createElement: () => (anchor = { click() {} }) },
    safeDocumentFilename,
    setTimeout() {},
  };
  new Function(...Object.keys(env), expression("exportDocument"))(...Object.values(env))();
  assert.equal(blob.type, "text/markdown;charset=utf-8");
  assert.equal(await blob.text(), "# Unsaved / title\n\nLatest final keystroke **bold**");
  assert.equal(anchor.download, "Unsaved  title.md");
});
