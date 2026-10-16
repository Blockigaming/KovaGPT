import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import postcss from "postcss";
import { cva } from "class-variance-authority";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
    "dist/client/assets/" +
      readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
    "utf8",
  ),
  ast = postcss.parse(css);
// Map pseudo states to fixture attributes (same specificity), retaining actual
// compiled cascade/order/importance; this is not a native browser-state test.
ast.walkRules((r) => {
  r.selector = r.selector.replace(
    /(?<!\\):(focus-visible|hover|disabled)\b/g,
    (_, state) => `[data-test-${state}]`,
  );
});
ast.walkDecls("background", (d) => {
  if (/^(var\(|oklch\(|rgb\(|#|transparent)/.test(d.value)) d.prop = "background-color";
});
const styled = ast.toString();
const { buttonVariants } = loadUiModule("src/components/ui/button.tsx", {
  react: { forwardRef: (fn) => fn },
  "@radix-ui/react-slot": { Slot: "Slot" },
  "class-variance-authority": { cva },
  "@/lib/utils": { cn: (...xs) => xs.filter(Boolean).join(" ") },
});
const classes = buttonVariants()
  .split(" ")
  .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
  .join(" ");
function oklch(value) {
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  assert.ok(match, `Expected resolved theme OKLCH, got ${value}`);
  return [Number(match[1]) / (match[2] ? 100 : 1), Number(match[3]), Number(match[4])];
}
function luminance(value) {
  const [L, C, h] = oklch(value),
    a = C * Math.cos((h * Math.PI) / 180),
    b = C * Math.sin((h * Math.PI) / 180),
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => Math.max(0, Math.min(1, x)));
  return rgb.reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}
const contrast = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`Onboarding primary state contrast ${width} dark=${dark}`, () => {
      const c = compiledCascade(styled, width, width < 768),
        root = element("html", dark ? "dark" : ""),
        dialog = element("div", "kova-onboarding-dialog", root, { role: "dialog" });
      for (const states of [
        [],
        ["hover"],
        ["focus-visible"],
        ["hover", "focus-visible"],
        ["disabled"],
        ["disabled", "hover"],
      ]) {
        const attrs = Object.fromEntries(states.map((s) => ["data-test-" + s, ""]));
        if (states.includes("disabled")) attrs.disabled = "";
        const button = element("button", classes + " kova-onboarding-primary", dialog, attrs),
          foreground = c.value(button, "color"),
          background = c.value(button, "background-color");
        assert.ok(
          contrast(foreground, background) >= 4.5,
          `${states}: ${foreground} / ${background}`,
        );
        if (states.includes("disabled")) {
          assert.equal(c.value(button, "opacity"), "1");
          assert.equal(background, c.value(button, "--muted"));
          assert.equal(foreground, c.value(button, "--muted-foreground"));
        }
        if (states.includes("focus-visible")) {
          assert.equal(c.value(button, "outline-offset"), "3px");
          assert.match(c.value(button, "outline"), /^2px solid /);
          assert.ok(contrast(c.value(button, "--ring"), c.value(button, "--background")) >= 3);
        }
      }
      // An unmarked button is unaffected by this fix, even inside the same dialog.
      const unmarked = element("button", classes, dialog, { "data-test-focus-visible": "" }),
        other = element("button", classes, element("div", "", root, { role: "dialog" }), {
          "data-test-focus-visible": "",
        });
      for (const p of ["background-color", "color", "outline", "opacity"])
        assert.equal(c.value(unmarked, p), c.value(other, p));
    });
test("Unmarked dialog primary action now retains its own focus color pair", () => {
  const c = compiledCascade(styled, 390, true),
    root = element("html", "dark"),
    dialog = element("div", "", root, { role: "dialog" }),
    button = element("button", classes, dialog, { "data-test-focus-visible": "" });
  assert.equal(c.value(button, "background-color"), c.value(button, "--primary"));
  assert.equal(c.value(button, "color"), c.value(button, "--primary-foreground"));
  assert.ok(contrast(c.value(button, "color"), c.value(button, "background-color")) >= 4.5);
  assert.equal(c.value(button, "box-shadow"), "none");
  assert.match(c.value(button, "outline"), /^2px solid /);
});
