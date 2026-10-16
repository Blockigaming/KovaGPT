import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { loadUiModule, elements } from "../helpers/ui-state-harness.mjs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const assets = readdirSync("dist/client/assets");
const css = [/^styles-.*\.css$/, /^PublicShell-.*\.css$/]
  .map((pattern) =>
    readFileSync("dist/client/assets/" + assets.find((n) => pattern.test(n)), "utf8"),
  )
  .join("\n");
const { LegalArticle } = loadUiModule("src/components/LegalArticle.tsx", {}),
  wrapper = LegalArticle({ children: null }),
  articleNode = elements(wrapper, (n) => n.type === "article")[0];
const escaped = (value) =>
  value
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`AI Safety and scoped blog typography ${width} ${dark ? "dark" : "light"}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        shell = element("div", "", root, { "data-public-shell": "" }),
        main = element("main", escaped(wrapper.props.className), shell),
        safety = element("article", escaped(articleNode.props.className), main),
        h1 = element("h1", "", safety),
        h2 = element("h2", "", safety),
        p = element("p", "", safety);
      assert.equal(c.value(h1, "font-size"), "2.25rem");
      assert.equal(c.value(h1, "font-weight"), "700");
      assert.equal(c.value(h2, "font-size"), "1.5rem");
      assert.equal(c.value(h2, "font-weight"), "600");
      assert.equal(c.value(p, "margin-block"), "calc(.25rem * 5)");
      assert.equal(c.value(p, "line-height"), "1.8");
      const article = element("article", "kova-public-article max-w-none", main),
        blogH1 = element("h1", "text-4xl font-bold tracking-tight", article),
        blogH2 = element("h2", "mt-10 text-2xl font-semibold", article),
        body = element("p", "", article),
        intro = element("p", "mt-6 text-lg leading-relaxed", article, {
          class: "mt-6 text-lg leading-relaxed",
        }),
        meta = element("p", "mt-3 text-sm text-muted-foreground", article, {
          class: "mt-3 text-sm text-muted-foreground",
        }),
        ul = element("ul", "", article),
        ol = element("ol", "", article),
        li = element("li", "", ul),
        tableWrapper = element(
          "div",
          "mt-4 overflow-x-auto rounded-lg border border-border",
          article,
        );
      assert.equal(c.value(blogH1, "font-size"), "2.25rem");
      assert.equal(c.value(blogH1, "font-weight"), "700");
      assert.equal(c.value(blogH2, "font-size"), "1.5rem");
      assert.equal(c.value(blogH2, "font-weight"), "600");
      assert.equal(c.value(body, "margin-block"), "1.25rem");
      assert.equal(c.value(body, "line-height"), "1.8");
      assert.equal(c.value(body, "font-size"), ".9375rem");
      assert.equal(c.value(intro, "font-size"), "1.125rem");
      assert.equal(c.value(meta, "font-size"), ".875rem");
      assert.equal(c.value(ul, "list-style-type"), "disc");
      assert.equal(c.value(ol, "list-style-type"), "decimal");
      for (const list of [ul, ol]) {
        assert.equal(c.value(list, "padding-inline-start"), "1.5rem");
        assert.equal(c.value(list, "margin-block"), "1.25rem");
        assert.equal(c.value(list, "list-style-position"), "outside");
      }
      assert.equal(c.value(li, "margin-block"), ".5rem");
      assert.equal(c.value(li, "line-height"), "1.8");
      assert.equal(c.value(body, "overflow-wrap"), "anywhere");
      assert.equal(c.value(body, "color"), dark ? "#b4b4b4" : "#5d5d5d");
      assert.equal(c.value(safety, "color"), dark ? "#f5f5f5" : "#111");
      assert.equal(c.value(tableWrapper, "overflow-x"), "auto");
      const unrelated = element("article", "", main),
        unrelatedP = element("p", "", unrelated);
      assert.notEqual(c.value(unrelatedP, "margin-block"), "1.25rem");
    });
