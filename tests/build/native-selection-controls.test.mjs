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
    test(`Native selection indicators and console targets ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        page = element("main", "kova-developer-console", root);
      for (const type of ["checkbox", "radio"])
        for (const classes of ["", "h-4 w-4", "h-3.5 w-3.5", "sr-only"]) {
          const input = element("input", classes, page, { type });
          assert.equal(c.value(input, "appearance"), "auto");
          assert.notEqual(c.value(input, "-webkit-appearance"), "none");
          assert.ok(c.value(input, "accent-color"));
          assert.equal(c.value(input, "min-width"), undefined);
          assert.equal(c.value(input, "min-height"), undefined);
        }
      const text = element("input", "", page, { type: "text" });
      assert.equal(c.value(text, "-webkit-appearance"), "none");
      const custom = element("button", "h-4 w-4", page, { role: "checkbox" });
      assert.notEqual(c.value(custom, "appearance"), "auto");
      assert.equal(c.value(custom, "min-height"), undefined);
      const button = element("button", "h-10", page);
      if (width < 768) {
        assert.equal(c.value(button, "min-height"), "44px");
        assert.equal(c.value(button, "height"), "auto");
        assert.equal(c.value(button, "white-space"), "normal");
      } else assert.equal(c.value(button, "height"), "calc(.25rem * 10)");
      const unrelated = element("button", "h-10", root);
      assert.equal(c.value(unrelated, "height"), "calc(.25rem * 10)");
    });
