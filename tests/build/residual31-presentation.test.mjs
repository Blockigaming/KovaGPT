import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import postcss from "postcss";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readdirSync("dist/client/assets")
  .filter((n) => /^(styles|PublicShell)-.*\.css$/.test(n))
  .map((n) => readFileSync("dist/client/assets/" + n, "utf8"))
  .join("\n");
for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`Residual controls, text actions and anchor geometry ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        dialog = element("div", "kova-settings-dialog", root, { role: "dialog" });
      for (const [parent, classes] of [
        [root, "rounded border p-2"],
        [dialog, "mt-1.5 h-10 w-full px-3"],
      ]) {
        const select = element("select", "kova-workspace-action " + classes, parent),
          control = element("select", classes, parent);
        if (width < 768) assert.equal(c.value(select, "min-height"), "44px");
        else
          for (const p of ["height", "min-height", "width"])
            assert.equal(c.value(select, p), c.value(control, p));
      }
      const panel = element("section", "kova-workspace-controls", root);
      for (const [tag, attrs] of [
        ["button", {}],
        ["input", { type: "text" }],
        ["input", { type: "date" }],
        ["input", { type: "email" }],
        ["select", {}],
      ]) {
        const control = element(tag, "h-9", panel, attrs),
          plain = element(tag, "h-9", root, attrs);
        assert.equal(
          c.value(control, "min-height"),
          width < 768 ? "44px" : c.value(plain, "min-height"),
        );
      }
      const project = element("main", "kova-project-chat", root),
        regular = element("div", "kova-assistant", root),
        actions = element("div", "kova-message-actions", project),
        regularActions = element("div", "kova-message-actions", regular),
        text = element("button", "", actions),
        reference = element("button", "", regularActions);
      assert.equal(c.value(text, "width"), "auto");
      assert.equal(c.value(text, "white-space"), "nowrap");
      assert.match(c.value(text, "flex"), /^(none|0 0 auto)$/);
      if (width < 768) assert.equal(c.value(text, "min-height"), "44px");
      else
        for (const p of ["height", "min-height", "padding-inline"])
          assert.equal(c.value(text, p), c.value(reference, p));
      const icon = element("button", "kova-message-icon-action", actions),
        plainIcon = element(
          "button",
          "kova-message-icon-action",
          element("div", "kova-message-actions", root),
        );
      if (width < 768) {
        assert.equal(c.value(icon, "min-height"), "44px");
        assert.equal(c.value(icon, "min-width"), "44px");
      } else
        for (const p of ["width", "height", "min-width", "min-height"])
          assert.equal(c.value(icon, p), c.value(plainIcon, p));
      const shell = element("div", "kova-app-shell", root),
        work = element("main", "kova-adapted-controls", shell, { id: "main-content" }),
        topbar = element("header", "kova-topbar", shell);
      assert.equal(
        c.value(work, "scroll-margin-top"),
        width < 1024 ? c.value(topbar, "min-height") : undefined,
      );
      for (const height of [68, 104]) {
        const measured = compiledCascade(
            css + `[data-public-shell]{--kova-public-header-height:${height}px}`,
            width,
            width < 768,
          ),
          publicShell = element("div", "", root, { "data-public-shell": "" }),
          card = element("article", "kova-plan-card", publicShell, { id: "plan-plus" });
        assert.equal(
          measured.value(card, "scroll-margin-top"),
          width < 768 ? `calc(${height}px + 1rem)` : "24px",
        );
      }
    });
test("Invisible switch target includes borders: actual compiled track24 stays24 while hit bounds cover +/-21", () => {
  const c = compiledCascade(css, 390, true),
    root = element("html"),
    dialog = element("div", "kova-settings-dialog", root, { role: "dialog" }),
    track = element("button", "", dialog, { role: "switch" });
  assert.equal(c.value(track, "height"), "24px");
  assert.equal(c.value(track, "width"), "44px");
  assert.equal(c.value(track, "border-width"), "2px");
  const declarations = {};
  postcss.parse(css).walkRules((r) => {
    if (
      r.selectors.some(
        (s) => s.includes("kova-settings-dialog") && s.includes("switch") && /::?before$/.test(s),
      )
    )
      for (const d of r.nodes) if (d.type === "decl") declarations[d.prop] = d.value;
  });
  assert.equal(declarations.inset, "-12px -2px");
  const [vertical, horizontal] = declarations.inset.split(" ").map(parseFloat),
    width = 44 - 2 * 2 - 2 * horizontal,
    height = 24 - 2 * 2 - 2 * vertical;
  assert.equal(width, 44);
  assert.equal(height, 44);
  const contains = (x, y, w, h) => x >= -w / 2 && x < w / 2 && y >= -h / 2 && y < h / 2;
  for (const [x, y] of [
    [-21, 0],
    [21, 0],
    [0, -21],
    [0, 21],
  ]) {
    assert.equal(contains(x, y, width, height), true);
    assert.equal(contains(x, y, 40, 40), false, "baseline inset produced40x40");
  }
});
