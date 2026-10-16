import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const dir = "dist/client/assets/";
const css = readFileSync(dir + readdirSync(dir).find((n) => /^styles-.*\.css$/.test(n)), "utf8");
const source = readFileSync("src/components/ScheduledTaskEditor.tsx", "utf8");
const base = source.match(/const button\s*=\s*"([^"]+)"/)[1];
const extra = source.match(/className=\{`\$\{button\} ([^`]+)`\}\s+onClick=\{onClose\}/)[1];
const titleClass = source.match(/<h2 className="([^"]+)"/)[1];
for (const width of [320, 390])
  test(`Task Close compiled CSS at ${width}px keeps a 44px target, no shrink/wrap, and flexible title`, () => {
    const c = compiledCascade(css, width, true);
    const root = element("html"),
      main = element(
        "main",
        "kova-page kova-secondary-page kova-core-page kova-adapted-controls max-w-3xl",
        root,
      );
    const section = element("section", "", main),
      header = element("div", "flex items-start justify-between gap-3", section);
    const button = element(
      "button",
      base.replaceAll(":", "\\:") + " " + extra.replaceAll("!", "\\!"),
      header,
    );
    const title = element("h2", titleClass, header);
    assert.equal(c.value(button, "flex-shrink"), "0");
    assert.equal(c.value(button, "white-space"), "nowrap");
    assert.equal(c.value(button, "min-height"), "44px");
    assert.equal(c.value(button, "min-width"), "44px");
    assert.equal(c.value(title, "min-width"), "0");
    assert.equal(c.value(title, "flex"), "1");
    assert.equal(c.value(title, "overflow-wrap"), "break-word");
  });
