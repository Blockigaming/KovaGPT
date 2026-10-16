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
    test(`Consent and Canvas scoped controls ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        panel = element("section", "kova-workspace-controls", root);
      for (const [tag, cls, attrs] of [
        ["select", "block w-full rounded border bg-background p-2", {}],
        ["input", "h-9 w-full px-3", { type: "number" }],
        ["button", "h-10 px-4", {}],
      ]) {
        const target = element(tag, cls, panel, attrs),
          normal = element(tag, cls, root, attrs);
        if (width < 768) {
          assert.equal(c.value(target, "min-height"), "44px");
          assert.equal(c.value(target, "min-width"), "44px");
        } else
          for (const p of ["height", "min-height", "min-width"])
            assert.equal(c.value(target, p), c.value(normal, p));
      }
      assert.equal(
        c.value(element("input", "", panel, { type: "checkbox" }), "min-height"),
        undefined,
      );
      const comment = element("button", "kova-workspace-action min-h-9", root),
        normal = element("button", "min-h-9", root);
      assert.equal(
        c.value(comment, "min-height"),
        width < 768 ? "44px" : c.value(normal, "min-height"),
      );
    });
