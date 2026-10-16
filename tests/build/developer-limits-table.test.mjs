import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const dir = "dist/client/assets/",
  assets = readdirSync(dir);
const css = [/^styles-.*\.css$/, /^PublicShell-.*\.css$/]
  .map((pattern) => readFileSync(dir + assets.find((n) => pattern.test(n)), "utf8"))
  .join("\n");
const source = readFileSync("src/routes/developers.console.tsx", "utf8");
const tableSource = source.slice(
  source.indexOf("Stored spending limits"),
  source.indexOf("</table>", source.indexOf("Stored spending limits")),
);
const escape = (s) =>
  s
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
const tableClass = tableSource.match(/<table className="([^"]+)"/)[1];
for (const width of [320, 390, 834, 1440])
  test(`Spending limits table scrolls internally with readable columns at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html");
    const shell = element("div", "kova-developer-console", root, { "data-public-shell": "" });
    const section = element("section", "min-w-0 space-y-3 rounded-xl border p-5", shell);
    const scroller = element("div", "overflow-x-auto", section);
    const table = element("table", escape(tableClass), scroller);
    assert.equal(c.value(section, "min-width"), "0");
    assert.equal(c.value(scroller, "overflow-x"), "auto");
    assert.equal(c.value(table, "min-width"), "44rem");
    assert.equal(c.value(table, "width"), "100%");
    for (const [, classes] of tableSource.matchAll(/<th className="([^"]+)"/g)) {
      const th = element("th", escape(classes), element("tr", "", element("thead", "", table)));
      assert.equal(c.value(th, "white-space"), "nowrap");
      assert.equal(c.value(th, "padding"), "calc(.25rem * 2)");
    }
    for (const [, classes] of tableSource.matchAll(/<td className="([^"]+)"/g)) {
      const td = element("td", escape(classes), element("tr", "", element("tbody", "", table)));
      assert.equal(c.value(td, "padding"), "calc(.25rem * 2)");
      assert.equal(c.value(td, "vertical-align"), "top");
    }
    assert.notEqual(c.value(shell, "overflow-x"), "hidden");
  });
