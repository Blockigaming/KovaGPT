import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const dir = "dist/client/assets/";
const css = readFileSync(dir + readdirSync(dir).find((n) => /^styles-.*\.css$/.test(n)), "utf8");
const source = readFileSync("src/components/ScheduledTaskEditor.tsx", "utf8");
const buttonBase = source.match(/const button\s*=\s*"([^"]+)"/)[1];
const control = source.match(/const control\s*=\s*"([^"]+)"/)[1];
const selectExtra = source.match(/className=\{`\$\{control\} ([^`]+)`\}\s+value=\{kind\}/)[1];
const buttonExtra = source.match(
  /className=\{`\$\{button\} ([^`]+)`\}\s+onClick=\{\(\) => void loadFiles\(\)\}/,
)[1];
const escape = (s) => s.replaceAll(":", "\\:").replaceAll("!", "\\!");
for (const width of [320, 390, 834])
  test(`Context Browse and Remove compiled rules at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html");
    const main = element(
      "main",
      "kova-page kova-secondary-page kova-core-page kova-adapted-controls max-w-3xl",
      root,
    );
    const row = element("div", "my-2 flex gap-2", element("details", "", main));
    const select = element("select", escape(control + " " + selectExtra), row);
    const button = element("button", escape(buttonBase + " " + buttonExtra), row);
    assert.equal(c.value(select, "min-width"), "0");
    assert.equal(c.value(select, "flex"), "1");
    assert.equal(c.value(button, "flex-shrink"), "0");
    assert.equal(c.value(button, "white-space"), "nowrap");
    assert.equal(c.value(button, "min-height"), "44px");
    assert.ok(["44px", "calc(.25rem * 11)"].includes(c.value(button, "min-width")));
    const labels = [
      ...source.matchAll(/<span className="([^"]+)">\s+\{(?:ref.kind|trigger.provider)/g),
    ];
    assert.equal(labels.length, 2);
    for (const [, classes] of labels) {
      const label = element("span", classes, row);
      assert.equal(c.value(label, "min-width"), "0");
      assert.equal(c.value(label, "flex"), "1");
      assert.equal(c.value(label, "overflow-wrap"), "break-word");
    }
  });
