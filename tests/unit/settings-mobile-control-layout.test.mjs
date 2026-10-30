import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const source = readFileSync("src/styles/settings-reference.css", "utf8");
const parsed = postcss.parse(source);
function rule(selector, media = null) {
  let found;
  parsed.walkRules((node) => {
    const parentMedia = node.parent.type === "atrule" ? node.parent.params : null;
    if (node.selectors.includes(selector) && parentMedia === media) found = node;
  });
  assert.ok(found, `Missing canonical ${selector} in ${media ?? "desktop"}`);
  return Object.fromEntries(
    found.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
  );
}
const mobile = "(max-width: 767px)";
const dialog = '[role="dialog"].kova-settings-dialog.is-authenticated';
const close = '[role="dialog"].kova-settings-dialog > [data-kova-dialog-close]';

test("canonical authenticated mobile Settings replaces bounded desktop dimensions with a safe fullscreen surface", () => {
  const desktop = rule(dialog);
  assert.equal(desktop.width, "min(calc(100vw - 32px), 1008px)");
  assert.equal(desktop.height, "min(86dvh, 720px)");
  const css = rule(dialog, mobile);
  for (const [property, value] of Object.entries({
    inset: "0",
    width: "100vw",
    height: "100dvh",
    "max-width": "none",
    "max-height": "none",
    transform: "none",
    translate: "none",
    "padding-top": "var(--safe-top)",
    "padding-bottom": "var(--safe-bottom)",
  }))
    assert.equal(css[property], value);
  assert.doesNotMatch(
    source,
    /!important/,
    "The focused owner must not require old global Settings layers",
  );
  const global = readFileSync("src/styles.css", "utf8");
  assert.match(
    readFileSync("src/components/SettingsDialog.tsx", "utf8"),
    /import "@\/styles\/settings-reference\.css"/,
  );
  assert.doesNotMatch(global, /\.kova-settings-dialog\.is-authenticated\s*\{/);
});

test("mobile Close remains right aligned with an independent 44px Back target and header clearance", () => {
  assert.equal(rule(close).left, "auto");
  const css = rule(close, mobile);
  assert.equal(css.right, "max(12px, var(--safe-right))");
  assert.equal(css.top, "max(12px, var(--safe-top))");
  assert.equal(css.width, "44px");
  assert.equal(css.height, "44px");
  const back = rule(".kova-settings-reference .kova-settings-back", mobile);
  assert.equal(back.width, "44px");
  assert.equal(back.height, "44px");
  assert.equal(
    rule(".kova-settings-reference .kova-settings-content-header", mobile).padding,
    "8px 44px 8px 0",
  );
});

test("mobile hit targets expand while the close glyph keeps its shared desktop scale", () => {
  const desktop = rule(close);
  assert.equal(desktop.right, "12px");
  assert.equal(desktop.width, "36px");
  assert.equal(desktop.height, "36px");
  const coarse = rule(close, "(pointer: coarse)");
  assert.equal(coarse.width, "44px");
  assert.equal(coarse.height, "44px");
  const icon = rule(`${close} > svg`);
  assert.equal(icon.width, "18px");
  assert.equal(icon.height, "18px");
  assert.equal(rule(".kova-settings-reference .kova-settings-back svg", mobile).width, "20px");
  const mobileIcon = [];
  parsed.walkRules((node) => {
    if (
      node.parent.type === "atrule" &&
      node.parent.params === mobile &&
      node.selector.includes("data-kova-dialog-close") &&
      node.selector.includes("svg")
    )
      mobileIcon.push(node);
  });
  assert.equal(
    mobileIcon.length,
    0,
    "Phone layout inherits the source glyph size instead of inflating it",
  );
});
