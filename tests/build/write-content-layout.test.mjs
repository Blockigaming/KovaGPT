import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const dir = "dist/client/assets/";
const css = readFileSync(dir + readdirSync(dir).find((n) => /^styles-.*\.css$/.test(n)), "utf8");
const source = readFileSync("src/routes/write.tsx", "utf8");
const mainClass = source.match(/id="main-content"\s+tabIndex=\{-1\}\s+className="([^"]+)"/)[1];
const custom = source.slice(source.indexOf('aria-label="Custom instruction"'));
const inputClass = custom.match(/className="([^"]+)"/)[1];
const applyClass = custom.match(/<button[\s\S]*?className="([^"]+)"/)[1];
const escape = (s) =>
  s
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [320, 390, 834, 1440]) {
  test(`Compiled Write layout keeps natural content height and a contained custom action at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768);
    const root = element("html");
    const main = element("main", escape(mainClass), root);
    const row = element("div", "mb-3 flex items-center gap-2", main);
    const input = element("input", escape(inputClass), row);
    const button = element("button", escape(applyClass), row);
    assert.equal(c.value(main, "min-height"), "100%");
    assert.equal(
      c.value(main, "flex-shrink"),
      "0",
      "The AppShell flex column must not shrink the focus region below its automatic content height",
    );
    assert.equal(
      c.value(main, "height"),
      undefined,
      "No fixed height can end the focus outline before wrapped footer actions",
    );
    assert.equal(c.value(main, "display"), "flex");
    assert.equal(c.value(main, "flex-direction"), "column");
    assert.equal(c.value(input, "min-width"), "0");
    assert.equal(c.value(input, "flex"), "1");
    assert.equal(c.value(button, "flex-shrink"), "0");
    assert.equal(c.value(button, "white-space"), "nowrap");
    assert.equal(c.value(button, "min-height"), "calc(.25rem * 11)");
    assert.notEqual(c.value(main, "overflow"), "hidden");
  });
}
