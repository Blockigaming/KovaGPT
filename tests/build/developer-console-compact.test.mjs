import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const dir = "dist/client/assets/";
const assets = readdirSync(dir);
const css = [/^styles-.*\.css$/, /^PublicShell-.*\.css$/]
  .map((pattern) => readFileSync(dir + assets.find((n) => pattern.test(n)), "utf8"))
  .join("\n");
const source = readFileSync("src/routes/developers.console.tsx", "utf8");
const pagerClass = source.match(
  /<div className="([^"]+)">\s+<Button\s+variant="outline"\s+disabled=\{limitsPage === 0 \|\| busy\}/,
)[1];
const indicatorClass = source.match(/<span className="([^"]+)">Page \{limitsPage \+ 1\}/)[1];
const calls = source.slice(source.indexOf("Latest 100 API calls</h2>"));
const tableClass = calls.match(/<table className="([^"]+)"/)[1];
const escape = (s) =>
  s
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [320, 390, 834, 1440]) {
  test(`Developer compact pager and calls table at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768);
    const root = element("html");
    const shell = element("div", "kova-developer-console", root, { "data-public-shell": "" });
    const pager = element("div", escape(pagerClass), shell);
    const indicator = element("span", escape(indicatorClass), pager);
    assert.equal(c.value(pager, "flex-wrap"), "wrap");
    assert.equal(c.value(indicator, "flex-shrink"), "0");
    assert.equal(c.value(indicator, "white-space"), "nowrap");
    const section = element("section", "min-w-0 rounded-xl border p-5", shell);
    const scroller = element("div", "overflow-x-auto", section);
    const table = element("table", escape(tableClass), scroller);
    assert.equal(c.value(section, "min-width"), "0");
    assert.equal(c.value(scroller, "overflow-x"), "auto");
    assert.equal(c.value(table, "min-width"), "28rem");
    assert.equal(c.value(table, "width"), "100%");
    for (const [, classes] of calls.matchAll(/<th className="([^"]+)"/g)) {
      const th = element("th", escape(classes), element("tr", "", element("thead", "", table)));
      assert.equal(c.value(th, "white-space"), "nowrap");
      assert.equal(c.value(th, "padding"), "calc(.25rem * 2)");
    }
    assert.notEqual(c.value(shell, "overflow-x"), "hidden");
  });
}
