import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import postcss from "postcss";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
import { states, escape } from "../helpers/compiled-action-contrast.mjs";
import { dropdown, actionVariants, contentProps, select } from "../helpers/dropdown-fixture.mjs";
const css = readFileSync(
    "dist/client/assets/" +
      readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
    "utf8",
  ),
  ast = postcss.parse(css);
ast.walkRules((r) => {
  if (r.selectors.includes(".kova-dropdown-item")) r.remove();
});
// --tw-leading:initial is the guaranteed-invalid custom-property value, so
// text-sm uses its actual line-height fallback. The bounded evaluator otherwise
// treats it as a literal; remove only this reset for these unoverridden fixtures.
function prepared(text) {
  const parsed = postcss.parse(text);
  parsed.walkDecls("--tw-leading", (d) => {
    if (d.value === "initial") d.remove();
  });
  return states(parsed.toString());
}
const baseline = prepared(ast.toString()),
  current = prepared(css);
function row(dark, name, role, classes = "", menuClasses = "", attrs = {}) {
  const root = element("html", dark ? "dark" : ""),
    menu = element("div", menuClasses, root, { role: "menu" });
  const props = (name === "SelectItem" ? select.SelectItem : dropdown["DropdownMenu" + name])({
    className: classes,
  }).props;
  return element("div", escape(props.className), menu, { role, ...attrs });
}
// Simple values used by the actual compiled text-sm and py-2 utilities. This is
// single-line box arithmetic, not a native layout/hit-test implementation.
function length(v) {
  if (v === undefined) return 0;
  const n = /^([\d.]+)(px|rem)?$/.exec(v);
  if (n) return Number(n[1]) * (n[2] === "rem" ? 16 : 1);
  const c = /^calc\(\s*([\d.]+)(rem|px)?\s*([*/])\s*([\d.]+)\s*\)$/.exec(v);
  assert.ok(c, v);
  return (
    Number(c[1]) * (c[2] === "rem" ? 16 : 1) * (c[3] === "*" ? Number(c[4]) : 1 / Number(c[4]))
  );
}
function naturalHeight(c, el) {
  const font = length(c.value(el, "font-size")),
    line = c.value(el, "line-height"),
    lineHeight = /px|rem/.test(line) ? length(line) : length(line) * font;
  return lineHeight + 2 * length(c.value(el, "padding-block"));
}
test("Prior compiled shared item variants reproduce36px single-line phone targets", () => {
  const c = compiledCascade(baseline, 390, true);
  for (const [name, role] of [...actionVariants, ["SelectItem", "option"]]) {
    const el = row(false, name, role);
    assert.equal(Math.max(length(c.value(el, "min-height")), naturalHeight(c, el)), 36);
  }
});
for (const width of [390, 767, 768, 1440])
  for (const dark of [false, true])
    test(`Dropdown actionable variants ${width} dark=${dark}`, () => {
      const c = compiledCascade(current, width, width < 768),
        old = compiledCascade(baseline, width, width < 768);
      for (const [name, role] of [...actionVariants, ["SelectItem", "option"]])
        for (const extra of [
          {},
          { "data-disabled": "" },
          { "data-state": "checked" },
          { "data-state": "open" },
        ])
          for (const focus of [false, true]) {
            const el = row(dark, name, role, "text-destructive", "", {
              ...extra,
              ...(focus ? { "data-test-focus": "", "data-test-focus-visible": "" } : {}),
            });
            assert.equal(
              Math.max(length(c.value(el, "min-height")), naturalHeight(c, el)),
              width < 768 ? 44 : 36,
            );
            for (const prop of [
              "height",
              "max-height",
              "padding-block",
              "padding-inline",
              "font-size",
              "line-height",
              "color",
              "background-color",
              "outline",
              "box-shadow",
              "pointer-events",
              "opacity",
            ])
              assert.equal(c.value(el, prop), old.value(el, prop), `${name} ${prop}`);
          }
      const profile = row(dark, "Item", "menuitem", "", "kova-profile-menu");
      assert.equal(c.value(profile, "min-height"), width < 768 ? "44px" : "36px");
      const larger = compiledCascade(
        current + "\n.kova-profile-menu { --layout-control:52px; }",
        width,
        width < 768,
      );
      assert.equal(larger.value(profile, "min-height"), "52px");
      // Multiline branch rows can keep their54px natural box; no fixed height/max-height added.
      const branch = row(dark, "Item", "menuitem", "flex flex-col items-start gap-0.5");
      assert.equal(c.value(branch, "height"), undefined);
      assert.equal(c.value(branch, "max-height"), undefined);
      assert.ok(length(c.value(branch, "min-height")) <= 54);
    });
for (const sub of [false, true])
  test(`${sub ? "Submenu" : "Menu"} keeps available-height scrolling and width collision bounds for longer44px rows`, () => {
    for (const available of [180, 320]) {
      const c = compiledCascade(
          current +
            `\n.audit-menu {--radix-dropdown-menu-content-available-height:${available}px;--radix-dropdown-menu-content-available-width:210px;}`,
          390,
          true,
        ),
        root = element("html"),
        props = contentProps(sub, "w-48 audit-menu"),
        menu = element("div", escape(props.className), root, { role: "menu" });
      assert.equal(c.value(menu, "overflow-y"), "auto");
      assert.equal(c.value(menu, "overflow-x"), "hidden");
      assert.equal(c.value(menu, "overscroll-behavior"), "contain");
      assert.match(
        c.value(menu, "max-height"),
        new RegExp(`^min\\(${available}px,\\s*calc\\(100dvh - 1rem\\)\\)$`),
      );
      assert.match(c.value(menu, "max-width"), /^min\(210px,\s*calc\(100vw - 1rem\)\)$/);
      assert.equal(props.collisionPadding, 8);
      const fiveRows = 5 * 44 + 12 + 2 + 9;
      assert.equal(fiveRows, 243);
      assert.ok(
        20 * 44 > available,
        "long menu requires existing vertical scroll, not clipping rows",
      );
    }
  });

test("Custom Select keeps available-height containment and native options unchanged", () => {
  const props = select.SelectContent({}).props.children.props;
  assert.equal(props.position, "popper");
  assert.equal(props.collisionPadding, 8);
  for (const dark of [false, true])
    for (const available of [180, 320]) {
      const suffix = `\n.audit-select {--radix-select-content-available-height:${available}px;--radix-select-content-available-width:350px;--radix-select-trigger-width:338px;}`;
      const c = compiledCascade(current + suffix, 390, true),
        old = compiledCascade(baseline + suffix, 390, true),
        root = element("html", dark ? "dark" : ""),
        content = element("div", escape(props.className + " audit-select"), root, {
          role: "listbox",
        });
      assert.equal(c.value(content, "max-height"), `${available}px`);
      assert.equal(c.value(content, "overflow-y"), "auto");
      assert.equal(c.value(content, "overflow-x"), "hidden");
      for (const p of ["min-width", "max-width", "max-height", "overflow-y", "overflow-x"])
        assert.equal(c.value(content, p), old.value(content, p));
      for (const tag of ["select", "option"]) {
        const native = element(tag, "", root);
        for (const p of ["min-height", "height", "padding-block"])
          assert.equal(c.value(native, p), old.value(native, p));
      }
    }
});
