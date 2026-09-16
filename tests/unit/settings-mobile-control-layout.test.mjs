import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/styles.css", "utf8");
const workspace = source.slice(source.indexOf("/* Authenticated settings workspace */"));
const mobile = workspace.slice(workspace.indexOf("@media (max-width: 767px)"));

function rule(selector) {
  const start = mobile.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Mobile rules must match desktop specificity: ${selector}`);
  return mobile.slice(start, mobile.indexOf("}", start));
}

test("authenticated mobile Settings overrides desktop dialog dimensions", () => {
  const css = rule(".kova-settings-dialog.is-authenticated");
  assert.match(css, /inset: 0 !important/);
  assert.match(css, /width: 100vw !important/);
  assert.match(css, /height: 100dvh !important/);
});

test("authenticated mobile Close moves right and cannot cover the Back control", () => {
  const css = rule(".kova-settings-dialog.is-authenticated > [data-kova-dialog-close]");
  assert.match(css, /left: auto/);
  assert.match(css, /right: max\(14px, var\(--safe-right\)\)/);
  assert.match(css, /width: 48px/);
  assert.match(css, /height: 48px/);
  assert.match(rule(".kova-settings-back"), /width: 44px/);
});

test("mobile close icon size wins without changing desktop controls", () => {
  assert.match(
    rule(".kova-settings-dialog.is-authenticated > [data-kova-dialog-close] svg"),
    /width: 23px/,
  );
  const desktop = workspace.slice(0, workspace.indexOf("@media (max-width: 767px)"));
  assert.match(desktop, /left: 22px/);
  assert.match(desktop, /width: 68px/);
});
