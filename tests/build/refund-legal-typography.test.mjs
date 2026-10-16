import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { loadUiModule, elements } from "../helpers/ui-state-harness.mjs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
// PublicShell loads its own CSS chunk after the application stylesheet.
const assets = readdirSync("dist/client/assets");
const css = [/^styles-.*\.css$/, /^PublicShell-.*\.css$/]
  .map((pattern) => {
    const asset = assets.find((name) => pattern.test(name));
    assert.ok(asset);
    return readFileSync("dist/client/assets/" + asset, "utf8");
  })
  .join("\n");
const { LegalArticle } = loadUiModule("src/components/LegalArticle.tsx", {});
const wrapper = LegalArticle({ children: null }),
  articleNode = elements(wrapper, (n) => n.type === "article")[0];
const escaped = (value) =>
  value
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`Refund shared legal typography ${width} ${dark ? "dark" : "light"}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        shell = element("div", "", root, { "data-public-shell": "", "data-core-shell": "true" }),
        main = element("main", escaped(wrapper.props.className), shell),
        article = element("article", escaped(articleNode.props.className), main),
        h1 = element("h1", "", article),
        h2 = element("h2", "", article),
        p = element("p", "", article),
        link = element("a", "", p);
      assert.equal(c.value(h1, "font-size"), "2.25rem");
      assert.equal(c.value(h1, "font-weight"), "700");
      assert.equal(c.value(h2, "font-size"), "1.5rem");
      assert.equal(c.value(h2, "font-weight"), "600");
      assert.equal(c.value(h1, "margin-bottom"), "calc(.25rem * 10)");
      assert.equal(c.value(h2, "margin-top"), "calc(.25rem * 14)");
      assert.equal(c.value(p, "margin-block"), "calc(.25rem * 5)");
      assert.equal(c.value(p, "line-height"), "1.8");
      assert.equal(c.value(p, "font-size"), ".9375rem");
      assert.equal(c.value(article, "color"), dark ? "#f5f5f5" : "#111");
      assert.equal(c.value(link, "color"), dark ? "#f5f5f5" : "#111");
      assert.ok(c.value(p, "color").includes(dark ? "#f5f5f5" : "#111"));
      assert.equal(c.value(link, "text-decoration-line"), "underline");
      assert.equal(c.value(main, "overflow-wrap"), "anywhere");
      assert.equal(c.value(article, "max-width"), "48rem");
    });
