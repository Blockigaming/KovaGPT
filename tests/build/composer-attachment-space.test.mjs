import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" +
    readdirSync("dist/client/assets").find((name) => /^styles-.*\.css$/.test(name)),
  "utf8",
);
for (const [width, coarse] of [
  [390, true],
  [430, true],
  [1023, false],
  [1440, true],
  [1440, false],
]) {
  test(`attachment removal reserves content space at ${width}, coarse=${coarse}`, () => {
    const c = compiledCascade(css, width, coarse);
    const app = element("div", "kova-assistant", element("html"));
    const composer = element("div", "kova-composer", app);
    const attachments = element("div", "flex flex-wrap", composer);
    const card = element("div", "kova-attachment-card relative", attachments);
    const remove = element("button", "absolute", card);
    if (coarse || width < 1024) {
      assert.equal(c.value(remove, "min-height"), "44px");
      assert.equal(c.value(remove, "min-width"), "44px");
      //4px top inset +44px touch target +4px content separation.
      assert.equal(c.value(card, "padding-top"), "52px");
    } else assert.notEqual(c.value(card, "padding-top"), "52px");
    assert.equal(c.value(attachments, "flex-wrap"), "wrap");
  });
}
