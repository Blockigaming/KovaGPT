import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
for (const width of [390, 834, 1024, 1440]) {
  test(`secondary spacing and Library utility wrapping at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 1024);
    const root = element("html");
    for (const core of [false, true]) {
      const main = element("main", "kova-secondary-page" + (core ? " kova-core-page" : ""), root);
      const header = element("header", "kova-page-header", main);
      assert.equal(c.value(header, "margin-bottom"), "0");
      assert.equal(c.value(header, "flex-wrap"), "wrap");
    }
    const row = element("div", "kova-library-utilities", root);
    const closed = element("details", "kova-library-disclosure", row);
    const summary = element("summary", "", closed);
    const open = element("details", "kova-library-disclosure", row, { open: "" });
    assert.equal(c.value(row, "display"), "flex");
    assert.equal(c.value(row, "flex-wrap"), "wrap");
    assert.equal(c.value(summary, "min-height"), "44px");
    assert.equal(c.value(open, "flex-basis"), "100%");
    assert.notEqual(c.value(closed, "flex-basis"), "100%");
    const actions = element(
      "div",
      "kova-page-actions ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2",
      root,
    );
    assert.equal(c.value(actions, "flex-wrap"), "wrap");
    assert.equal(c.value(actions, "max-width"), "100%");
    assert.equal(c.value(actions, "justify-content"), "flex-end");
    assert.equal(c.value(actions, "margin-left"), "auto");
  });
}
