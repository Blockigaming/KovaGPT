import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const directory = "dist/client/assets/";
const css = readFileSync(
  directory + readdirSync(directory).find((name) => /^styles-.*\.css$/.test(name)),
  "utf8",
);
for (const [width, height, coarse] of [
  [568, 320, true],
  [844, 390, true],
  [390, 568, true],
  [1280, 900, false],
  [1280, 900, true],
]) {
  test(`sidebar search-open/history cascade at ${width}x${height} coarse=${coarse}`, () => {
    const app = element("div", "kova-app-shell"),
      sidebar = element("aside", "kova-sidebar", app, { "data-kova-core-sidebar": "" }),
      inner = element("div", "kova-sidebar-inner overflow-hidden", sidebar),
      search = element("div", "kova-sidebar-search-wrap", inner),
      scroll = element("div", "kova-sidebar-scroll", inner),
      row = element("div", "kova-chat-row", scroll),
      open = element("button", "kova-chat-row-main", row),
      options = element("button", "kova-chat-options", row),
      footer = element("footer", "kova-sidebar-footer", inner);
    const c = compiledCascade(css, width, coarse, width, {}, height),
      touch = coarse || width <= 1023;
    if (height <= 420) {
      assert.equal(c.value(inner, "overflow-y"), "auto");
      assert.equal(c.value(scroll, "overflow"), "visible");
      assert.equal(c.value(scroll, "flex"), "none");
      assert.equal(c.value(search, "flex-shrink"), "0");
    } else {
      assert.equal(c.value(inner, "overflow-y"), undefined);
      assert.equal(c.value(scroll, "flex"), "1");
      assert.equal(c.value(footer, "flex-shrink"), "0");
    }
    assert.equal(c.value(row, "height"), touch ? "44px" : "36px");
    assert.equal(c.value(open, "min-height"), touch ? "44px" : "36px");
    assert.equal(c.value(options, "height"), touch ? "44px" : "2.25rem");
    if (touch) {
      assert.equal(c.value(options, "min-height"), "44px");
      assert.equal(c.value(options, "width"), "44px");
    }
  });
}

test("height-aware cascade evaluates both range and min/max media syntax", () => {
  const css =
    "@media(max-height:420px){.target{overflow-y:auto}}@media(height > 420px){.target{overflow-y:hidden}}";
  const target = element("div", "target");
  assert.equal(compiledCascade(css, 568, true, 568, {}, 320).value(target, "overflow-y"), "auto");
  assert.equal(compiledCascade(css, 568, true, 568, {}, 700).value(target, "overflow-y"), "hidden");
});
