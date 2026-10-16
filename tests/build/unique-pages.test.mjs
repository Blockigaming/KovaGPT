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
    test(`Unique page target sizing ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        shell = element("div", "kova-app-shell", root),
        contacts = element("main", "kova-workspace-controls", shell, { id: "main-content" }),
        summary = element("main", "kova-summary-page kova-workspace-controls", shell, {
          id: "main-content",
        });
      for (const [tag, classes, attrs] of [
        ["button", "", {}],
        ["button", "h-10", {}],
        ["input", "", { type: "email" }],
      ]) {
        const target = element(tag, classes, contacts, attrs),
          control = element(tag, classes, root, attrs);
        if (width < 768) {
          assert.equal(c.value(target, "min-height"), "44px");
          assert.equal(c.value(target, "min-width"), "44px");
        } else
          for (const p of ["height", "width", "min-height", "min-width"])
            assert.equal(c.value(target, p), c.value(control, p));
      }
      const native = element("input", "", contacts, { type: "checkbox" });
      assert.equal(c.value(native, "min-height"), undefined);
      for (const classes of [
        "kova-summary-target flex",
        "kova-summary-target block",
        "kova-summary-target kova-summary-inline-action",
      ]) {
        const target = element("a", classes, summary);
        if (width < 768) {
          assert.equal(c.value(target, "min-height"), "44px");
          assert.equal(c.value(target, "min-width"), "44px");
          if (classes.includes("inline-action"))
            assert.equal(c.value(target, "display"), "inline-flex");
        } else assert.equal(c.value(target, "min-height"), undefined);
      }
      const inline = element("a", "", summary);
      assert.equal(c.value(inline, "min-height"), undefined);
      const hide = element("button", "p-1", summary);
      if (width < 768) assert.equal(c.value(hide, "min-height"), "44px");
      if (width < 1024)
        assert.equal(
          c.value(contacts, "scroll-margin-top"),
          c.value(element("header", "kova-topbar", shell), "min-height"),
        );
    });
