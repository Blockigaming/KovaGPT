import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
for (const [width, signed, guest, multiline] of [
  [390, true, false, false],
  [390, true, false, true],
  [390, false, true, false],
  [390, false, false, false],
  [1188, true, false, false],
])
  test(`composer allocation ${width} signed=${signed} compactGuest=${guest} multiline=${multiline}`, () => {
    const c = compiledCascade(css, width, width < 1024),
      root = element("html"),
      app = element("div", "kova-assistant", root),
      input = element("div", "kova-chat-input", app, {
        "data-composer-surface": "empty",
        ...(signed ? { "data-signed-in": "true" } : {}),
        ...(guest ? { "data-compact-guest": "true" } : {}),
      }),
      composer = element("div", "kova-composer", input),
      row = element("div", "kova-composer-row", composer),
      textarea = element("textarea", "kova-composer-input", row, {
        "data-multiline": String(multiline),
      }),
      footer = element("div", "kova-composer-trailing", row),
      button = element("button", "kova-composer-button", footer),
      model = element("button", "kova-composer-model-status", footer);
    if (width < 640 && signed) {
      assert.equal(c.value(textarea, "min-height"), "32px");
      assert.equal(c.value(textarea, "padding"), "3px 14px 3px 15px");
      assert.equal(c.value(row, "gap"), "4px");
      assert.equal(c.value(row, "padding"), "calc(8px - 1px)");
      assert.equal(c.value(row, "grid-template-rows"), "auto auto");
      assert.equal(c.value(composer, "border-radius"), "28px");
    } else {
      assert.equal(c.value(textarea, "min-height"), width < 640 ? "44px" : "36px");
      assert.equal(c.value(row, "gap"), "8px");
    }
    assert.equal(c.value(textarea, "max-height"), "12.5rem");
    assert.equal(c.value(button, "height"), width < 640 ? "44px" : "36px");
    assert.equal(c.value(model, "min-height"), width < 640 ? "44px" : "36px");
    if (guest) assert.equal(c.value(row, "padding"), "1px");
  });
