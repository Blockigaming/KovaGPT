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
    test(`History sheet preserves editor allocation ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        body = element("div", "flex min-h-0 flex-1", root),
        editor = element("div", "min-w-0 flex-1", body),
        panel = element(
          "aside",
          "kova-artifact-history shrink-0 overflow-y-auto border-l p-3",
          body,
        ),
        button = element("button", "", panel);
      assert.ok(["0", "calc(.25rem * 0)"].includes(c.value(editor, "min-width")));
      if (width < 768) {
        assert.equal(c.value(panel, "position"), "fixed");
        assert.equal(c.value(panel, "width"), "100%");
        assert.equal(c.value(panel, "max-height"), "70dvh");
        assert.equal(c.value(panel, "bottom"), "0");
        assert.equal(c.value(button, "min-height"), "44px");
      } else {
        assert.notEqual(c.value(panel, "position"), "fixed");
        assert.equal(c.value(panel, "width"), "256px");
        assert.equal(c.value(panel, "max-height"), undefined);
      }
    });
