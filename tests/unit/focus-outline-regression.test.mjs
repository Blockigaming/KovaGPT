import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/styles.css", "utf8");
const select = readFileSync("src/components/ui/select.tsx", "utf8");

test("select triggers do not combine a Tailwind ring with the global keyboard outline", () => {
  assert.match(select, /focus-visible:ring-0 focus-visible:ring-offset-0/);
  assert.doesNotMatch(select, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(css, /One neutral, theme-aware focus indicator/);
  assert.match(css, /color-mix\(in srgb, var\(--foreground\) 65%, transparent\)/);
  assert.match(css, /outline-offset: -2px !important/);
  assert.match(css, /box-shadow: none !important/);
});

test("pointer-focused dropdown options do not acquire a second ring", () => {
  assert.match(css, /data-kova-input-modality="pointer"/);
  assert.match(css, /\[data-slot="select-item"\]/);
  assert.match(css, /\[data-slot="select-trigger"\]/);
  assert.match(css, /\[data-slot="menu-item"\]/);
});
