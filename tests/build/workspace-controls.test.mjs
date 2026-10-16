import postcss from "postcss";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);

for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`Workspace control opt-in ${width} dark=${dark}`, () => {
      const c = compiledCascade(css, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        page = element("main", "kova-workspace-controls", root);
      for (const [tag, attrs] of [
        ["button", {}],
        ["button", { role: "tab" }],
        ["input", { type: "text" }],
        ["input", { type: "file" }],
        ["select", {}],
      ])
        for (const classes of ["h-9", "h-10 w-10", "min-h-10", ""]) {
          const target = element(tag, classes, page, attrs),
            control = element(tag, classes, root, attrs);
          if (width < 768) {
            assert.equal(c.value(target, "min-height"), "44px");
            assert.equal(c.value(target, "min-width"), "44px");
          } else
            for (const p of ["height", "width", "min-height", "min-width"])
              assert.equal(c.value(target, p), c.value(control, p));
        }
      for (const type of ["checkbox", "radio", "range", "hidden"]) {
        const native = element("input", "", page, { type });
        assert.equal(c.value(native, "min-height"), undefined);
        assert.equal(c.value(native, "min-width"), undefined);
      }
      for (const role of ["checkbox", "radio", "switch"]) {
        const custom = element("button", "", page, { role });
        assert.equal(c.value(custom, "min-height"), undefined);
      }
      const filter = element("button", "kova-directory-filter underline", page),
        label = element("label", "kova-directory-search", page);
      if (width < 768) {
        assert.equal(c.value(filter, "border-radius"), "9999px");
        assert.equal(c.value(filter, "text-decoration"), "none");
        assert.equal(c.value(label, "display"), "grid");
        assert.equal(c.value(label, "width"), "100%");
      } else {
        assert.equal(c.value(label, "display"), undefined);
        assert.equal(
          c.value(filter, "border-radius"),
          c.value(element("button", "underline", root), "border-radius"),
        );
      }
    });

test("Compiled native file-picker button has a phone-only44px target", () => {
  const matches = [];
  postcss.parse(css).walkRules((r) => {
    if (
      r.selector.includes(".kova-workspace-controls") &&
      r.selector.includes("::file-selector-button")
    )
      matches.push(r);
  });
  assert.ok(matches.length);
  assert.ok(
    matches.some((r) => r.nodes.some((d) => d.prop === "min-height" && d.value === "44px")),
  );
  for (const r of matches)
    assert.ok(
      r.parent.type === "atrule" && r.parent.name === "media" && r.parent.params.includes("767px"),
    );
});

test("Study file import can shrink within phone grid without changing desktop", () => {
  for (const width of [390, 1440]) {
    const c = compiledCascade(css, width, width < 768),
      root = element("html"),
      main = element("main", "kova-workspace-controls", root),
      label = element("label", "kova-study-import", main),
      input = element("input", "", label, { type: "file" });
    if (width < 768) {
      assert.equal(c.value(label, "min-width"), "0");
      assert.equal(c.value(input, "width"), "100%");
      assert.equal(c.value(input, "min-width"), "0");
      assert.equal(c.value(input, "max-width"), "100%");
      assert.equal(c.value(input, "min-height"), "44px");
    } else {
      assert.equal(c.value(label, "min-width"), undefined);
      assert.equal(c.value(input, "width"), undefined);
    }
  }
});

test("Graph hit extension is phone-only and Timeline links have full-height targets", () => {
  for (const width of [390, 1440]) {
    const c = compiledCascade(css, width, width < 768),
      root = element("html"),
      rect = element("rect", "kova-graph-node-hit", root),
      link = element("a", "kova-graph-resource", root);
    assert.equal(c.value(rect, "display"), width < 768 ? "block" : "none");
    if (width < 768) {
      assert.equal(c.value(rect, "pointer-events"), "all");
      assert.equal(c.value(link, "min-height"), "44px");
      assert.equal(c.value(link, "display"), "flex");
    } else assert.equal(c.value(link, "min-height"), undefined);
  }
});
