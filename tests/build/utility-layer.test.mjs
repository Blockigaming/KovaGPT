import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);

for (const width of [390, 768, 1024, 1440])
  for (const dark of [false, true])
    test(`Utility header stacking ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        shell = element("div", "kova-app-shell", root),
        header = element("header", "kova-topbar sticky top-0 z-30", shell),
        utilities = element("div", "kova-core-utilities flex", shell),
        timer = element("div", "relative z-40", utilities),
        panel = element("div", "absolute right-0 top-full", timer),
        portal = element("div", "fixed z-50", root);
      assert.equal(c.value(timer, "z-index"), "40");
      assert.equal(c.value(header, "z-index"), "30");
      assert.equal(c.value(portal, "z-index"), "50");
      if (width < 1024) {
        assert.equal(c.value(utilities, "position"), "relative");
        assert.equal(c.value(utilities, "z-index"), "calc(30 - 1)");
        assert.ok(30 - 1 < Number(c.value(header, "z-index")));
      } else {
        assert.equal(c.value(utilities, "z-index"), undefined);
        assert.equal(c.value(utilities, "position"), undefined);
      }
      assert.equal(c.value(panel, "position"), "absolute");
      assert.equal(c.value(panel, "top"), "100%");
      // A portal is attached to the root, outside the utility stacking context.
      assert.equal(portal.parent, root);
      assert.ok(Number(c.value(portal, "z-index")) > Number(c.value(header, "z-index")));
      for (const p of ["height", "min-height", "width", "padding-top", "overflow"])
        assert.equal(c.value(utilities, p), c.value(element("div", "flex", shell), p));
    });
