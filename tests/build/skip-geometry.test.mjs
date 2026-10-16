import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);

for (const width of [390, 768, 1024, 1440])
  for (const safe of ["0px", "24px"])
    test(`Skip margin follows header ${width} safe=${safe}`, () => {
      const c = compiledCascade(css + `:root{--safe-top:${safe}}`, width, width < 768),
        root = element("html"),
        shell = element("div", "kova-app-shell", root),
        header = element("header", "kova-topbar", shell),
        main = element("main", "", shell, { id: "main-content" }),
        unrelated = element("main", "", root, { id: "main-content" });
      assert.equal(c.value(unrelated, "scroll-margin-top"), undefined);
      if (width < 1024)
        assert.equal(c.value(main, "scroll-margin-top"), c.value(header, "min-height"));
      else assert.equal(c.value(main, "scroll-margin-top"), undefined);
      for (const p of ["margin-top", "padding-top", "scroll-padding-top"])
        assert.equal(c.value(main, p), c.value(unrelated, p));
    });
for (const width of [390, 1440])
  test(`Graph labels and Project summary ${width}`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html"),
      main = element("main", "kova-core-page", root),
      panel = element("div", "kova-workspace-controls", main),
      summary = element("summary", "flex min-h-10", panel),
      filters = element("div", "kova-graph-filters flex gap-1 overflow-x-auto", panel),
      button = element("button", "kova-graph-mode min-h-10", filters);
    assert.equal(c.value(filters, "overflow-x"), "auto");
    if (width < 768) {
      assert.equal(c.value(button, "flex-shrink"), "0");
      assert.equal(c.value(button, "white-space"), "nowrap");
      assert.equal(c.value(button, "min-height"), "44px");
      assert.equal(c.value(summary, "min-height"), "44px");
      assert.equal(c.value(summary, "min-width"), "44px");
    } else {
      assert.equal(
        c.value(button, "flex-shrink"),
        c.value(element("button", "min-h-10", root), "flex-shrink"),
      );
      assert.equal(
        c.value(summary, "min-height"),
        c.value(element("summary", "min-h-10", root), "min-height"),
      );
    }
  });
