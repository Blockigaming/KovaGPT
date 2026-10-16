import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const names = readdirSync("dist/client/assets"),
  css = names
    .filter((n) => /^(styles|PublicShell)-.*\.css$/.test(n))
    .map((n) => readFileSync("dist/client/assets/" + n, "utf8"))
    .join("\n");
for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`Standalone public link opt-in ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        shell = element("div", "", root, { "data-public-shell": "" }),
        main = element("main", "", shell),
        paragraph = element("p", "", main);
      for (const parent of [main, paragraph]) {
        const link = element("a", "kova-public-action-link underline", parent),
          control = element("a", "underline", parent);
        if (width < 768) {
          assert.equal(c.value(link, "min-height"), "44px");
          assert.equal(c.value(link, "min-width"), "44px");
          assert.equal(c.value(link, "display"), "inline-flex");
          assert.equal(c.value(link, "align-items"), "center");
          assert.equal(c.value(link, "max-width"), "100%");
        } else
          for (const p of ["min-height", "min-width", "display", "align-items", "max-width"])
            assert.equal(c.value(link, p), c.value(control, p));
        assert.equal(c.value(control, "min-height"), undefined);
      }
    });
