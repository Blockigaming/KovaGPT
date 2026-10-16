import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n));
assert.ok(asset, "Build the exact source before running compiled cascade tests");
const css = readFileSync("dist/client/assets/" + asset, "utf8");
for (const [width, coarse] of [
  [1188, false],
  [390, true],
  [768, true],
  [1188, true],
])
  test(`compiled cascade ${width}px coarse=${coarse}`, () => {
    const root = element("html"),
      app = element("div", "kova-assistant", root),
      main = element("main", "kova-chat-main", app),
      empty = element("section", "kova-empty-chat", main),
      content = element("div", "kova-empty-chat-content", empty),
      greeting = element("div", "kova-greeting", content),
      heading = element("h1", "", greeting),
      outer = element("div", "kova-empty-composer", content),
      input = element("div", "kova-chat-input", outer, { "data-composer-surface": "empty" }),
      column = element("div", "kova-chat-column", input),
      composer = element("div", "kova-composer", column),
      row = element("div", "kova-composer-row", composer),
      textarea = element("textarea", "kova-composer-input", row),
      button = element("button", "kova-composer-button kova-send-button", row),
      sidebar = element("aside", "kova-sidebar", app, { "data-kova-core-sidebar": "" }),
      nav = element("button", "kova-nav-row", sidebar);
    const c = compiledCascade(css, width, coarse, width === 1188 ? 848 : width);
    assert.equal(c.value(row, "display"), "grid");
    assert.equal(c.value(button, "width"), coarse ? "44px" : "36px");
    assert.equal(c.value(textarea, "line-height"), "26px");
    assert.equal(c.value(textarea, "margin-block"), "0");
    assert.equal(
      c.value(row, "grid-template-columns"),
      width < 640 ? "minmax(0,1fr) auto" : "auto minmax(0,1fr) auto",
    );
    assert.equal(c.value(heading, "font-size"), "24px");
    assert.equal(c.value(heading, "font-weight"), "400");
    assert.equal(c.value(heading, "line-height"), "1.2");
    assert.equal(c.value(empty, "padding-inline"), "0");
    const gutter = width < 640 ? "16px" : "20px";
    assert.equal(
      c.value(input, "padding-inline"),
      `max(${gutter},env(safe-area-inset-left,0px)) max(${gutter},env(safe-area-inset-right,0px))`,
    );
    assert.equal(c.value(nav, "min-height"), coarse ? "44px" : "35px");
    if (!coarse) {
      assert.equal(c.value(nav, "gap"), "8px");
      assert.equal(c.value(nav, "border-radius"), "8px");
    }
  });
