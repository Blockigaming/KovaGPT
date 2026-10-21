import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/styles.css", "utf8");
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing ${selector}`);
  return css.slice(start, css.indexOf("}", start) + 1);
};

test("shared missing/error state explains consequences in left-aligned sentence case", () => {
  assert.match(rule(".kova-state-panel > p:not(.kova-state-eyebrow)"), /text-align: left/);
  assert.match(rule(".kova-state-eyebrow"), /text-transform: none/);
  assert.match(rule(".kova-state-eyebrow"), /letter-spacing: normal/);
});

test("shared recovery controls retain 44px targets with full-pill corners and theme colors", () => {
  const actions = rule(".kova-state-secondary");
  assert.match(actions, /min-height: 2.75rem/);
  assert.match(actions, /border-radius: var\(--kova-radius-button\)/);
  assert.match(
    css,
    /\.kova-state-primary \{\s*color: var\(--background\);\s*background: var\(--foreground\)/,
  );
  assert.match(rule(".kova-state-secondary:focus-visible"), /outline: 2px solid var\(--ring\)/);
});
