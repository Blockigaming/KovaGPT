import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const asset = readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n));
const css = readFileSync("dist/client/assets/" + asset, "utf8");
for (const [width, coarse] of [
  [390, true],
  [822, true],
  [1188, true],
  [1188, false],
])
  test(`composer model status ${width} coarse=${coarse}`, () => {
    const c = compiledCascade(css, width, coarse),
      root = element("html"),
      app = element("div", "kova-assistant", root),
      composer = element("div", "kova-composer", app),
      trailing = element("div", "kova-composer-trailing", composer),
      button = element("button", "kova-composer-model-status", trailing);
    assert.equal(c.value(button, "min-height"), coarse ? "44px" : "36px");
    assert.equal(c.value(button, "min-width"), "44px");
    assert.equal(c.value(button, "height"), "auto");
    assert.equal(c.value(button, "font-size"), "14px");
    assert.equal(c.value(button, "line-height"), "20px");
    assert.equal(c.value(button, "display"), "inline-flex");
    const context = element("button", "kova-composer-context-button", trailing);
    assert.equal(c.value(context, "min-height"), coarse ? "44px" : "36px");
    assert.equal(c.value(context, "min-width"), "44px");
    assert.equal(c.value(context, "height"), "auto");
    assert.equal(c.value(context, "font-size"), "14px");
  });
