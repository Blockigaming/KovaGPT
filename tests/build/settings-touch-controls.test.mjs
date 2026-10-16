import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { cva } from "class-variance-authority";
import postcss from "postcss";
import { loadUiModule, elements } from "../helpers/ui-state-harness.mjs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const assets = readdirSync("dist/client/assets"),
  css = readFileSync(
    "dist/client/assets/" + assets.find((n) => /^styles-.*\.css$/.test(n)),
    "utf8",
  );
const deps = {
  react: { forwardRef: (fn) => fn },
  "@/lib/utils": { cn: (...xs) => xs.filter(Boolean).join(" ") },
};
const { Slider } = loadUiModule("src/components/ui/slider.tsx", {
  ...deps,
  "@radix-ui/react-slider": { Root: "Root", Track: "Track", Range: "Range", Thumb: "Thumb" },
});
const { Input } = loadUiModule("src/components/ui/input.tsx", deps);
const { Button } = loadUiModule("src/components/ui/button.tsx", {
  ...deps,
  "@radix-ui/react-slot": { Slot: "Slot" },
  "class-variance-authority": { cva },
});
const escaped = (value) =>
  value
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
for (const width of [390, 767, 822, 1440])
  test(`Settings actual control/slider classes ${width}`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html"),
      dialog = element("div", "kova-settings-dialog", root, { role: "dialog" }),
      input = Input({ className: "kova-personalization-name" }, null),
      button = Button({ asChild: true, size: "sm", className: "kova-settings-support-link" }, null);
    const name = element("input", escaped(input.props.className), dialog),
      link = element("a", escaped(button.props.className), dialog),
      slider = Slider({ value: [5], thumbLabel: "Kindness", touchTarget: true }, null),
      sr = element("span", escaped(slider.props.className), dialog),
      track = element(
        "span",
        escaped(elements(slider, (n) => n.type === "Track")[0].props.className),
        sr,
      ),
      thumb = element(
        "span",
        escaped(elements(slider, (n) => n.type === "Thumb")[0].props.className),
        sr,
      );
    for (const control of [name, link, sr, thumb]) {
      if (width < 768) assert.equal(c.value(control, "min-height"), "44px");
      else assert.notEqual(c.value(control, "min-height"), "44px");
    }
    if (width < 768) {
      assert.equal(c.value(thumb, "width"), "44px");
      assert.equal(c.value(thumb, "height"), "44px");
      assert.match(c.value(thumb, "background"), /^(transparent|0 0)$/);
      assert.equal(c.value(link, "white-space"), "normal");
      assert.equal(c.value(link, "max-width"), "100%");
    } else {
      assert.equal(c.value(name, "height"), "calc(.25rem * 9)");
      assert.equal(c.value(link, "height"), "calc(.25rem * 9)");
      assert.equal(c.value(thumb, "height"), "calc(.25rem * 4)");
    }
    assert.equal(c.value(track, "height"), "calc(.25rem * 1.5)");
    const plain = Slider({ value: [5] }, null),
      pr = element("span", escaped(plain.props.className), dialog),
      pt = element(
        "span",
        escaped(elements(plain, (n) => n.type === "Thumb")[0].props.className),
        pr,
      );
    assert.notEqual(c.value(pt, "min-height"), "44px");
  });
test("phone thumb retains a16px visible indicator within its44px interaction area", () => {
  const declarations = {};
  // The compiler splits color-mix fallback/support rules; combine this selector's declarations.
  postcss.parse(css).walkRules((rule) => {
    if (
      rule.selectors.some((selector) =>
        /^\.kova-touch-slider \.kova-slider-thumb::?before$/.test(selector),
      )
    ) {
      Object.assign(
        declarations,
        Object.fromEntries(
          rule.nodes.filter((n) => n.type === "decl").map((n) => [n.prop, n.value]),
        ),
      );
    }
  });
  assert.equal(declarations.width, "16px");
  assert.equal(declarations.height, "16px");
  assert.equal(declarations["pointer-events"], "none");
});
