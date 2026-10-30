import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(path, "utf8");
const declarations = (path, selector, media = null) => {
  const matches = [];
  postcss.parse(read(path)).walkRules((rule) => {
    if (
      rule.selectors.includes(selector) &&
      (rule.parent.type === "atrule" ? rule.parent.params : null) === media
    )
      matches.push(rule);
  });
  assert.equal(matches.length, 1, `One positioning owner: ${selector}`);
  return Object.fromEntries(
    matches[0].nodes.filter((node) => node.type === "decl").map(({ prop, value }) => [prop, value]),
  );
};

// These are source-composition checks. Actual rectangle, close-button and
// scroll-content bounds are separately checked by the production browser suite.
const shared = read("src/components/ui/dialog.tsx");
assert.match(shared, /left-1\/2 top-1\/2/);
assert.match(shared, /-translate-x-1\/2 -translate-y-1\/2/);

test("full-screen phone Settings cancels both transform systems for guests and signed-in users", () => {
  const path = "src/styles/settings-reference.css";
  for (const selector of [
    '[role="dialog"].kova-settings-dialog',
    '[role="dialog"].kova-settings-dialog.is-authenticated',
  ]) {
    const css = declarations(path, selector, "(max-width: 767px)");
    assert.equal(css.inset, "0");
    assert.equal(css.width, "100vw");
    assert.equal(css.height, "100dvh");
    assert.equal(css.transform, "none");
    assert.equal(css.translate, "none");
  }
});

test("Connections details uses the shared individual translation exactly once", () => {
  const css = declarations(
    "src/styles/spec400-plugins.css",
    ".spec400-plugin-detail[data-kova-dialog-surface]",
  );
  assert.equal(css.inset, "50% auto auto 50%");
  assert.equal(css.transform, "none");
  assert.equal(css.translate, undefined, "Shared DialogContent supplies the sole -50% centering");
  assert.equal(css.width, "min(600px, calc(100vw - 32px))");
  assert.equal(css["max-height"], "calc(100dvh - 48px)");
  assert.equal(css["overflow-y"], "auto");
});

test("Sources docks to the right without retaining the shared centered-dialog offset", () => {
  const path = "src/components/response-action-refinement.css";
  const css = declarations(path, ".kova-sources-inspector[data-kova-dialog-surface]");
  assert.equal(css.left, "auto");
  assert.equal(css.right, "0");
  assert.equal(css.top, "0");
  assert.equal(css.transform, "none");
  assert.equal(css.translate, "none");
  assert.equal(css.width, "min(420px, 100vw)");
  assert.equal(css.height, "100dvh");
  assert.equal(css["max-height"], "100dvh");
  assert.equal(
    declarations(path, ".kova-sources-inspector[data-kova-dialog-surface]", "(max-width: 767px)")
      .width,
    "100vw",
  );
});
