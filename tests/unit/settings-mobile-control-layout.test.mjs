import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const source = readFileSync("src/styles/settings-reference.css", "utf8");
const parsed = postcss.parse(source);
function rule(selector, media = null) {
  const values = {};
  parsed.walkRules((node) => {
    const parentMedia = node.parent.type === "atrule" ? node.parent.params : null;
    if (
      node.selectors.includes(selector) &&
      (media === null
        ? parentMedia === null
        : parentMedia
            ?.split(",")
            .map((query) => query.trim())
            .includes(media))
    )
      for (const child of node.nodes) if (child.type === "decl") values[child.prop] = child.value;
  });
  assert.ok(Object.keys(values).length, `Missing ${selector}`);
  return values;
}
const mobile = "(max-width: 767px)";
const dialog = '[role="dialog"].kova-settings-dialog.is-authenticated';
const close = '[role="dialog"].kova-settings-dialog > [data-kova-dialog-close]';

test("phone Settings replaces the bounded desktop dialog with a full viewport", () => {
  assert.match(rule(dialog).width, /^min\(/);
  const phone = rule(dialog, mobile);
  assert.equal(phone.inset, "0");
  assert.equal(phone.width, "100%");
  assert.equal(phone.height, "100dvh");
  assert.equal(phone["max-width"], "none");
  assert.equal(phone["border-radius"], "0");
  assert.equal(phone.transform, "none");
  assert.equal(
    Object.values(phone).some((value) => value.includes("!important")),
    false,
  );
});

test("phone dialog close and back have independent touch targets with safe-area clearance", () => {
  const css = rule(close, mobile);
  assert.equal(css.width, "44px");
  assert.equal(css.height, "44px");
  assert.match(css.right, /safe-right/);
  assert.match(css.top, /safe-top/);
  const back = rule(".kova-settings-reference .kova-settings-back", mobile);
  assert.equal(back.width, "44px");
  assert.equal(back.height, "44px");
  assert.equal(
    rule('[role="dialog"].kova-settings-dialog .kova-settings-content-header', mobile)[
      "padding-right"
    ],
    "64px",
  );
});

test("Settings has one layout owner without the former global margins and forced titles", () => {
  const legacy = readFileSync("src/styles/app-finish.css", "utf8");
  assert.doesNotMatch(legacy, /kova-settings-(?:sidebar|content-header|page\s*\{)/);
  const page = readFileSync("src/styles/settings-page-layout.css", "utf8");
  assert.match(page, /\.mobile-home\s*\{/);
  assert.match(page, /\.mobile-hidden\s*\{/);
});
