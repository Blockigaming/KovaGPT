import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/styles/chatgpt-final-parity.css", "utf8");

test("final Day 16 UI system covers shell, composer, mobile and reduced motion", () => {
  assert.match(css, /DAY16_UI_SYSTEM_START/);
  assert.match(css, /\.kova-sidebar/);
  assert.match(css, /\.kova-composer/);
  assert.match(css, /max-width:\s*360px/);
  assert.match(css, /prefers-reduced-motion/);
});

test("final composer focus remains quiet and explicit", () => {
  assert.match(css, /\.kova-composer:focus-within/);
  assert.match(css, /outline:\s*none\s*!important/);
});
