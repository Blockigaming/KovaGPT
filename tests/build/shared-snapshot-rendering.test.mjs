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
    test(`Snapshot code/table containment ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        prose = element("div", "prose-chat kova-shared-markdown", root),
        pre = element("pre", "", prose),
        code = element("code", "language-js", pre),
        scroll = element("div", "kova-table-scroll", prose);
      assert.equal(c.value(prose, "max-width"), "100%");
      assert.equal(c.value(prose, "min-width"), "0");
      assert.equal(c.value(prose, "overflow-wrap"), "anywhere");
      for (const node of [pre, scroll]) {
        assert.equal(c.value(node, "max-width"), "100%");
        assert.equal(c.value(node, "overflow-x"), "auto");
      }
      assert.equal(c.value(pre, "white-space"), "pre");
      assert.equal(c.value(pre, "overflow-wrap"), "normal");
      assert.equal(c.value(code, "white-space"), "inherit");
      assert.equal(
        c.value(element("pre", "", element("div", "prose-chat", root)), "white-space"),
        undefined,
      );
    });
