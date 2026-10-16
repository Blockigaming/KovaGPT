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
    test(`Writing/Translation phone actions ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : "");
      for (const tag of ["button", "a"])
        for (const old of ["h-9 w-9", "h-10 w-10", "min-h-9", "min-h-10"]) {
          const target = element(tag, "kova-workspace-action " + old, root);
          const original = element(tag, old, root);
          if (width < 768) {
            assert.equal(c.value(target, "min-height"), "44px");
            assert.equal(c.value(target, "min-width"), "44px");
          } else
            for (const property of ["height", "width", "min-height", "min-width"])
              assert.equal(c.value(target, property), c.value(original, property));
        }
    });
