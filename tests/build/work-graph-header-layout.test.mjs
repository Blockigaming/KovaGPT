import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const dir = "dist/client/assets/";
const css = readFileSync(dir + readdirSync(dir).find((n) => /^styles-.*\.css$/.test(n)), "utf8");
const source = readFileSync("src/routes/work.tsx", "utf8");
const section = source.slice(source.indexOf("function DependencyGraph"));
const headerClass = section.match(/<section>\s+<div className="([^"]+)"/)[1];
const descriptionClass = section.match(
  /<div className="([^"]+)">\s+<h3 className="font-semibold">Dependency graph/,
)[1];
const controlsClass = section.match(/<div\s+className="([^"]+)"\s+aria-label="Graph controls"/)[1];
const fitClass = section.match(/<button className="([^"]+)" onClick=\{fit\}/)[1];
const escape = (s) =>
  s
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [320, 390, 834, 1440])
  test(`Compiled graph header preserves the Fit label and wraps before controls collide at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html"),
      shell = element("div", "kova-app-shell", root),
      main = element("main", "kova-adapted-controls", shell),
      header = element("div", escape(headerClass), main),
      description = element("div", escape(descriptionClass), header),
      controls = element("div", escape(controlsClass), header),
      fit = element("button", escape(fitClass), controls);
    assert.equal(c.value(header, "flex-wrap"), "wrap");
    assert.equal(c.value(description, "min-width"), "0");
    assert.match(c.value(description, "flex"), /^(?:1 1 )?16rem$/);
    assert.equal(c.value(controls, "flex-shrink"), "0");
    assert.equal(c.value(controls, "white-space"), "nowrap");
    assert.equal(c.value(fit, "flex-shrink"), "0");
    assert.equal(c.value(fit, "white-space"), "nowrap");
  });
