import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`Project response, rename and shared composer geometry ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        main = element("main", "kova-project-chat", root);
      for (const [group, cls] of [
        ["kova-message-actions", "kova-message-icon-action"],
        ["kova-message-actions", ""],
        ["kova-code-toolbar", ""],
      ]) {
        const b = element("button", cls, element("div", group, main)),
          control = element(
            "button",
            cls,
            element(
              "div",
              group,
              group === "kova-message-actions" && !cls
                ? element("div", "kova-assistant", root)
                : root,
            ),
          );
        if (width < 768)
          for (const p of ["min-width", "min-height"]) assert.equal(c.value(b, p), "44px");
        else
          for (const p of ["width", "height", "min-width", "min-height", "flex"])
            assert.equal(c.value(b, p), c.value(control, p));
      }
      const rename = element("input", "kova-workspace-action h-9", root);
      assert.equal(c.value(rename, "min-height"), width < 768 ? "44px" : undefined);
      const shell = element("div", "kova-assistant kova-project-composer", main),
        input = element("div", "kova-chat-input", shell, {
          "data-signed-in": "true",
          "data-composer-surface": "conversation",
        }),
        composer = element("div", "kova-composer", input),
        row = element("div", "kova-composer-row", composer),
        textarea = element("textarea", "kova-composer-input", row),
        context = element("button", "kova-composer-context-button", row),
        model = element("button", "kova-composer-model-status", row);
      assert.equal(c.value(textarea, "min-height"), width < 640 ? "32px" : "36px");
      for (const b of [context, model])
        assert.equal(c.value(b, "min-height"), width < 640 ? "44px" : "36px");
      assert.equal(c.value(row, "grid-template-rows"), width < 640 ? "auto auto" : undefined);
    });
