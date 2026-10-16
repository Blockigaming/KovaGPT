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
    test(`Developer/recovery scoped cascade ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        page = element("main", "kova-auth-page", root),
        surface = element("div", "kova-auth-surface", page),
        error = element("p", "kova-reset-error text-sm text-destructive", surface);
      const fg = c.value(error, "color");
      assert.ok(dark ? ["#f5f5f5"].includes(fg) : ["#171717"].includes(fg), String(fg));
      // Conservative contrast against every possible 10%-alpha error tint over the actual card.
      const linear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      const lum = (rgb) =>
        rgb.map((x) => linear(x / 255)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
      const foreground = dark ? 245 : 23,
        card = dark ? 36 : 255;
      const worstBackground = 0.9 * card + 0.1 * (dark ? 255 : 0);
      const a = lum([foreground, foreground, foreground]),
        b = lum([worstBackground, worstBackground, worstBackground]);
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5);
      const link = element("a", "kova-developer-link kova-workspace-action underline", root);
      if (width < 768) {
        assert.equal(c.value(link, "min-height"), "44px");
        assert.equal(c.value(link, "min-width"), "44px");
        assert.equal(c.value(link, "display"), "inline-flex");
      } else {
        assert.equal(c.value(link, "min-height"), undefined);
        assert.equal(c.value(link, "display"), undefined);
      }
      const controls = element("div", "kova-workspace-controls", root);
      for (const [tag, attrs] of [
        ["input", { type: "text" }],
        ["button", {}],
      ]) {
        const target = element(tag, "h-9", controls, attrs);
        assert.equal(c.value(target, "min-height"), width < 768 ? "44px" : undefined);
      }
      assert.equal(
        c.value(element("input", "", controls, { type: "checkbox" }), "min-height"),
        undefined,
      );
    });
