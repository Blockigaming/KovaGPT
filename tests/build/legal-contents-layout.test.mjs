import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const dir = "dist/client/assets/",
  assets = readdirSync(dir);
const css = [/^styles-.*\.css$/, /^PublicShell-.*\.css$/]
  .map((pattern) => readFileSync(dir + assets.find((n) => pattern.test(n)), "utf8"))
  .join("\n");
for (const width of [320, 390, 1440])
  for (const dark of [false, true])
    test(`Legal contents index/marker rules at ${width}px ${dark ? "Dark" : "Light"}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : "");
      const shell = element("div", "", root, { "data-public-shell": "" }),
        doc = element("div", "legal-doc", shell);
      const details = element("details", "legal-toc-mobile", doc),
        nav = element("nav", "", details);
      const ol = element("ol", "legal-toc-list", nav),
        li = element("li", "", ol),
        link = element("a", "", li);
      const index = element("span", "legal-toc-index", link),
        label = element("span", "legal-toc-label", link);
      assert.equal(c.value(ol, "list-style"), "none");
      assert.equal(c.value(li, "list-style"), "none");
      assert.equal(c.value(index, "flex-shrink"), "0");
      assert.equal(c.value(index, "white-space"), "nowrap");
      assert.equal(c.value(label, "min-width"), "0");
      assert.equal(c.value(link, "overflow-wrap"), "anywhere");
      // Ordinary legal body lists retain their decimal markers.
      assert.equal(
        c.value(element("ol", "", element("div", "legal-body", doc)), "list-style"),
        "decimal",
      );
    });

for (const width of [320, 390, 834, 1023, 1024, 1440])
  test(`Legal contents/body separation at ${width}px preserves desktop grid`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html");
    const shell = element("div", "", root, { "data-public-shell": "" });
    const doc = element("div", "legal-doc", shell),
      mobile = element("details", "legal-toc-mobile", doc);
    const layout = element("div", "legal-layout", doc);
    if (width < 1024) {
      assert.equal(c.value(mobile, "margin-block-end"), "1rem");
      assert.notEqual(c.value(mobile, "display"), "none");
      assert.equal(c.value(layout, "gap"), "2rem");
    } else {
      assert.equal(c.value(mobile, "display"), "none");
      assert.equal(c.value(layout, "grid-template-columns"), "16rem minmax(0,1fr)");
      assert.equal(c.value(layout, "gap"), "clamp(3rem,6vw,6rem)");
    }
  });
