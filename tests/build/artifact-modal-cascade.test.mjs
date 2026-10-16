import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
import { createHookHarness, loadUiModule, elements } from "../helpers/ui-state-harness.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
for (const width of [390, 822, 1440])
  test(`Artifact modal compiled viewport bounds at ${width}`, () => {
    const hooks = createHookHarness();
    const { ArtifactEditorSurface } = loadUiModule("src/components/ArtifactEditorSurface.tsx", {
      react: hooks.react,
      "@radix-ui/react-dialog": Object.fromEntries(
        ["Root", "Portal", "Overlay", "Content", "Title"].map((n) => [n, n]),
      ),
      "@/lib/dialog-return-focus": { restoreDialogFocus() {} },
    });
    const tree = hooks.render(ArtifactEditorSurface, {
      presentation: "dialog",
      label: "Code",
      onRequestClose() {},
      children: null,
    });
    const overlayNode = elements(tree, (n) => n.type === "Overlay")[0],
      contentNode = elements(tree, (n) => n.type === "Content")[0];
    // The bounded evaluator compares serialized CSS identifiers, including utility escapes.
    const cssClasses = (value) =>
      value
        .split(" ")
        .map((name) => name.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
        .join(" ");
    const c = compiledCascade(css, width, width < 768),
      root = element("html"),
      body = element("body", "", root),
      overlay = element("div", cssClasses(overlayNode.props.className), body),
      content = element("div", cssClasses(contentNode.props.className), overlay, {
        role: "dialog",
      });
    assert.equal(c.value(overlay, "position"), "fixed");
    assert.equal(c.value(overlay, "inset"), "0");
    assert.equal(c.value(overlay, "z-index"), "100");
    assert.equal(c.value(overlay, "align-items"), width < 640 ? "stretch" : "center");
    assert.equal(c.value(content, "height"), width < 640 ? "100%" : "90dvh");
    assert.equal(c.value(content, "width"), "100%");
    assert.equal(c.value(content, "min-width"), "0");
    assert.equal(c.value(content, "overflow"), "hidden");
    assert.equal(c.value(content, "display"), "flex");
    if (width >= 640) assert.equal(c.value(content, "max-width"), "72rem");
  });
