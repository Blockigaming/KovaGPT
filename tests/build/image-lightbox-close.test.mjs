import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import postcss from "postcss";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const ast = postcss.parse(
  readFileSync(
    "dist/client/assets/" +
      readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
    "utf8",
  ),
);
ast.walkRules((r) => {
  r.selector = r.selector.replace(
    /(?<!\\):(last-child|focus-visible|hover)\b/g,
    (_, state) => `[data-test-${state}]`,
  );
});
const css = ast.toString();
for (const width of [390, 834, 1024, 1440])
  for (const dark of [false, true])
    test(`image Close contrast/target/focus at${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 1024);
      const root = element("html", dark ? "dark" : "");
      const dialog = element("div", "image-lightbox", root);
      const close = element("button", "absolute", dialog, { "data-test-last-child": "" });
      assert.equal(c.value(close, "background"), "#171717");
      assert.match(c.value(close, "color"), /^(white|#fff)$/);
      assert.equal(c.value(close, "width"), "2.75rem");
      assert.equal(c.value(close, "height"), "2.75rem");
      assert.equal(c.value(close, "z-index"), "1");
      const hover = element("button", "absolute", dialog, {
        "data-test-last-child": "",
        "data-test-hover": "",
      });
      assert.equal(c.value(hover, "background"), "#303030");
      const focus = element("button", "absolute", dialog, {
        "data-test-last-child": "",
        "data-test-focus-visible": "",
      });
      assert.match(c.value(focus, "outline"), /^2px solid (white|#fff)$/);
      assert.equal(c.value(focus, "outline-offset"), "2px");
      assert.equal(c.value(focus, "box-shadow"), "0 0 0 6px #171717");
    });
