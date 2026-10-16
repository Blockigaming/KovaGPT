import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
for (const width of [390, 767, 822, 1188])
  test(`Project navigation touch bounds at ${width}`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html"),
      main = element("main", "kova-core-page", root),
      tabs = element("div", "kova-project-tabs", main),
      tab = element("button", "", tabs, { role: "tab" }),
      actions = element("div", "kova-project-actions", main),
      group = element("div", "", actions),
      button = element("button", "", group),
      link = element("a", "", actions);
    assert.equal(c.value(tab, "flex-shrink"), "0");
    for (const target of [tab, button, link]) {
      if (width < 768) {
        assert.equal(c.value(target, "min-height"), "44px");
        assert.equal(c.value(target, "min-width"), "44px");
      } else assert.notEqual(c.value(target, "min-height"), "44px");
    }
    if (width < 768) assert.equal(c.value(group, "flex-wrap"), "wrap");
  });
