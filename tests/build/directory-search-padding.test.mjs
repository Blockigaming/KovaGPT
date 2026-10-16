import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import postcss from "postcss";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
    "dist/client/assets/" +
      readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
    "utf8",
  ),
  ast = postcss.parse(css);
// The bounded cascade helper does not expand shorthands. Expand actual compiled
// padding declarations in-place so later shorthand resets cannot escape this test.
ast.walkDecls(/^(padding|padding-inline)$/, (d) => {
  const v = postcss.list.space(d.value);
  d.cloneAfter({
    prop: "padding-left",
    value: d.prop === "padding-inline" ? v[0] : (v[3] ?? v[1] ?? v[0]),
  });
  d.cloneAfter({ prop: "padding-right", value: v[1] ?? v[0] });
});
const expanded = ast.toString(),
  px = (v) =>
    v?.endsWith("px")
      ? parseFloat(v)
      : v?.endsWith("rem")
        ? parseFloat(v) * 16
        : v === "calc(.25rem * 9)"
          ? 36
          : NaN;
for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`Library/Projects icon padding specificity ${width} dark=${dark}`, () => {
      const c = compiledCascade(expanded, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        main = element("main", "kova-directory", root),
        toolbar = element("section", "kova-toolbar", main);
      for (const tag of ["label", "div"]) {
        const wrap = element(
            tag,
            "kova-directory-search kova-directory-search-with-icon relative",
            toolbar,
          ),
          oldWrap = element(tag, "kova-directory-search relative", toolbar),
          input = element("input", "h-11 w-full px-3 py-1 pl-9", wrap),
          old = element("input", "h-11 w-full px-3 py-1 pl-9", oldWrap);
        assert.equal(px(c.value(input, "padding-left")), 36, "12px icon inset +16px icon +8px gap");
        assert.equal(
          px(c.value(old, "padding-left")),
          width < 768 ? 12 : 36,
          "reproduce old phone override with actual compiled shorthand",
        );
        for (const p of [
          "padding-right",
          "width",
          "min-width",
          "max-width",
          "height",
          "min-height",
        ])
          assert.equal(c.value(input, p), c.value(old, p));
        for (const p of ["width", "min-width", "max-width", "flex"])
          assert.equal(c.value(wrap, p), c.value(oldWrap, p));
      }
      const plain = element(
        "input",
        "px-2 py-1",
        element("label", "kova-directory-search", toolbar),
      );
      assert.notEqual(px(c.value(plain, "padding-left")), 36, "icon-free search not widened");
      const ordinary = element("input", "px-3", main);
      assert.notEqual(px(c.value(ordinary, "padding-left")), 36);
    });
