import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n));
const css = readFileSync("dist/client/assets/" + asset, "utf8");
for (const width of [390, 767, 768, 1188])
  test(`plan overview visibility and readable navigation ${width}`, () => {
    const c = compiledCascade(css, width, width < 1024),
      root = element("html"),
      nav = element("nav", "kova-mobile-plan-overview", root),
      grid = element("div", "kova-mobile-plan-choices", nav),
      link = element("a", "kova-mobile-plan-choice", grid);
    assert.equal(c.value(nav, "display"), width < 768 ? "grid" : "none");
    if (width < 768) {
      assert.equal(c.value(grid, "grid-template-columns"), "repeat(3,minmax(0,1fr))");
      assert.equal(c.value(link, "min-height"), "44px");
      assert.equal(c.value(link, "font-size"), "14px");
      assert.equal(c.value(link, "overflow-wrap"), "anywhere");
    }
  });
for (const [width, guest, multiline] of [
  [390, true, false],
  [390, true, true],
  [390, false, false],
  [1188, true, false],
])
  test(`guest composer ${width} compact=${guest} multiline=${multiline}`, () => {
    const c = compiledCascade(css, width, width < 1024),
      root = element("html"),
      app = element("div", "kova-assistant", root),
      input = element("div", "kova-chat-input", app, {
        "data-composer-surface": "empty",
        ...(guest ? { "data-compact-guest": "true" } : {}),
      }),
      composer = element("div", "kova-composer", input),
      row = element("div", "kova-composer-row", composer),
      textarea = element("textarea", "kova-composer-input", row, {
        "data-multiline": String(multiline),
      }),
      leading = element("div", "kova-composer-leading", row),
      trailing = element("div", "kova-composer-trailing", row),
      button = element("button", "kova-composer-button", trailing);
    if (width < 640 && guest) {
      assert.equal(c.value(row, "grid-template-rows"), "auto");
      assert.equal(c.value(row, "padding"), "1px");
      assert.equal(c.value(row, "min-height"), "46px");
      assert.equal(c.value(textarea, "grid-area"), "1/2");
      assert.equal(c.value(textarea, "padding"), "9px 0");
      assert.equal(c.value(leading, "grid-area"), "1/1");
      assert.equal(c.value(trailing, "grid-area"), "1/3");
      assert.equal(c.value(composer, "border-radius"), multiline ? "28px" : "24px");
      assert.equal(c.value(textarea, "max-height"), "12.5rem");
    } else if (width < 640) assert.equal(c.value(row, "grid-template-rows"), "auto auto");
    else assert.equal(c.value(composer, "border-radius"), "26px");
    assert.equal(c.value(button, "width"), width < 1024 ? "44px" : "36px");
  });
