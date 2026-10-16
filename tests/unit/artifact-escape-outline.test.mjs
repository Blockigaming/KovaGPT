import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { editorFixture, elements } from "../helpers/paper-editor-rendered-fixture.mjs";
import {
  loadUiModule,
  createHookHarness,
  elements as uiElements,
} from "../helpers/ui-state-harness.mjs";

for (const paper of [false, true])
  test(`Dialog Escape closes the phone outline before History, returns focus, and preserves the editor (${paper ? "Paper" : "Source"})`, () => {
    const value = editorFixture({
      content: "# Synthetic heading\n\nPreserved content.",
      paper,
      presentation: "dialog",
    });
    const history = value.fixture.find(
      "button",
      (n) => n.props["aria-label"] === "Toggle version history",
    );
    const historyTarget = { synthetic: "history trigger" };
    history.props.ref.current = historyTarget;
    history.props.onClick();
    value.fixture.render();
    const outline = value.fixture.find(
      "button",
      (n) => n.props["aria-label"] === "Toggle document outline",
    );
    const outlineTarget = { synthetic: "outline trigger" };
    outline.props.ref.current = outlineTarget;
    outline.props.onClick();
    value.fixture.render();
    const hooks = createHookHarness();
    let editorCloses = 0,
      prevented = 0;
    const { ArtifactEditorSurface } = loadUiModule("src/components/ArtifactEditorSurface.tsx", {
      react: hooks.react,
      "@radix-ui/react-dialog": Object.fromEntries(
        ["Root", "Portal", "Overlay", "Content", "Title"].map((n) => [n, n]),
      ),
      "@/lib/dialog-return-focus": { restoreDialogFocus() {} },
    });
    function escape() {
      const surface = hooks.render(ArtifactEditorSurface, {
        presentation: "dialog",
        label: "Writing",
        onRequestClose: () => editorCloses++,
        onEscape: value.fixture.tree.props.onEscape,
        children: "Synthetic editor body",
      });
      uiElements(surface, (n) => n.type === "Content")[0].props.onEscapeKeyDown({
        preventDefault: () => prevented++,
      });
      value.fixture.render();
    }
    escape();
    assert.equal(editorCloses, 0);
    assert.equal(
      value.fixture.find("button", (n) => n.props["aria-label"] === "Toggle document outline")
        .props["aria-expanded"],
      false,
    );
    assert.equal(
      value.fixture.find("button", (n) => n.props["aria-label"] === "Toggle version history").props[
        "aria-pressed"
      ],
      true,
    );
    assert.deepEqual(value.focusReturns, [
      { target: outlineTarget, url: "http://fixture.invalid/document" },
    ]);
    assert.equal(
      elements(
        value.renderDocument().document,
        (n) => n.attribs["aria-label"] === "Document outline",
      ).length,
      0,
    );
    escape();
    assert.equal(editorCloses, 0);
    assert.equal(
      value.fixture.find("button", (n) => n.props["aria-label"] === "Toggle version history").props[
        "aria-pressed"
      ],
      false,
    );
    assert.deepEqual(value.focusReturns[1], {
      target: historyTarget,
      url: "http://fixture.invalid/document",
    });
    assert.equal(
      value.fixture.find("textarea").props.value,
      "# Synthetic heading\n\nPreserved content.",
    );
    assert.equal(value.fixture.tree.props.onEscape, undefined);
    escape();
    assert.equal(editorCloses, 1);
    assert.equal(prevented, 3);
  });

test("The actual page Escape callback closes outline, then History, then requests guarded editor close", () => {
  const source = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
  const expression = source.match(/const onKey = (\(e: KeyboardEvent\) => \{[\s\S]*?\n    \});/)[1];
  const compiled = ts.transpileModule("var actualPageKeyHandler = " + expression + ";", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [outlineOpen, historyOpen, expected] of [
    [true, true, "outline"],
    [false, true, "history"],
    [false, false, "editor"],
  ]) {
    const calls = [],
      context = {
        outlineOpen,
        historyOpen,
        closeOutline: () => calls.push("outline"),
        closeHistory: () => calls.push("history"),
        requestClose: () => calls.push("editor"),
      };
    vm.runInNewContext(compiled, context);
    context.actualPageKeyHandler({ key: "ArrowDown" });
    assert.deepEqual(calls, []);
    context.actualPageKeyHandler({ key: "Escape" });
    assert.deepEqual(calls, [expected]);
  }
});
