import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "@tailwindcss/node";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const write = readFileSync("src/routes/write.tsx", "utf8");
const work = readFileSync("src/routes/work.tsx", "utf8");
const appShell = readFileSync("src/components/AppShell.tsx", "utf8");
const mainClass = write.match(/id="main-content"\s+tabIndex=\{-1\}\s+className="([^"]+)"/)[1];
const shellClass = appShell.match(/className="(kova-app-shell [^"]+)"/)[1];
const contentClass = appShell.match(/className="(kova-app-content [^"]+)"/)[1];
const fitClass = work.match(/<button className="([^"]+)" onClick=\{fit\}/)[1];
const tokens = new Set(
  [mainClass, shellClass, contentClass, fitClass, "whitespace-nowrap"].flatMap((value) =>
    value.split(/\s+/),
  ),
);
const compiler = await compile(readFileSync("src/styles.css", "utf8"), {
  base: `${process.cwd()}/src`,
  onDependency() {},
});
const css = compiler.build([...tokens]);
const escape = (value) =>
  value
    .split(/\s+/)
    .map((part) => part.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [320, 390, 834, 1440]) {
  test(`Write's actual AppShell flex ancestry cannot shrink the content-height focus region at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768);
    const root = element("html");
    const shell = element("div", escape(shellClass), root);
    const content = element("div", escape(contentClass), shell);
    const main = element("main", escape(mainClass), content, { id: "main-content" });
    assert.equal(c.value(shell, "height"), "100dvh");
    assert.equal(c.value(content, "display"), "flex");
    assert.equal(c.value(content, "flex-direction"), "column");
    assert.equal(c.value(content, "overflow-y"), "auto");
    assert.equal(c.value(main, "height"), undefined, "Automatic content height is retained");
    assert.equal(c.value(main, "min-height"), "100%", "Viewport floor remains");
    assert.equal(
      c.value(main, "flex-shrink"),
      "0",
      "Measured d57b baseline shrank this main to844px while its content reached1014px",
    );
  });
  test(`Fit's nowrap survives the real adapted-controls ancestor at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768);
    const root = element("html");
    const main = element("main", "kova-adapted-controls", root);
    const baseline = element("button", "work-small shrink-0 whitespace-nowrap", main);
    const corrected = element("button", escape(fitClass), main);
    assert.equal(
      c.value(baseline, "white-space"),
      "normal",
      "Reproduces the unlayered global override missed by the earlier reduced model",
    );
    assert.equal(c.value(corrected, "white-space"), "nowrap");
    assert.equal(c.value(corrected, "flex-shrink"), "0");
  });
}
