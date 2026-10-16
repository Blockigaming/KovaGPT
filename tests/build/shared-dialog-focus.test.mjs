import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import postcss from "postcss";
import { cva } from "class-variance-authority";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
const base = "df1c42b759cfc04d78753e6f1221cbb6bf359e7b";
const oldParity = execFileSync("git", ["show", base + ":src/styles/chatgpt-parity.css"], {
  encoding: "utf8",
});
let oldRule;
postcss.parse(oldParity).walkRules((r) => {
  if (r.selector.includes('[role="dialog"]') && r.selector.includes(":focus-visible"))
    oldRule = r.toString();
});
assert.ok(oldRule);
const baseline = postcss.parse(css);
baseline.walkRules((r) => {
  if (r.selector.includes(".kova-model-menu") && r.selector.includes(":focus-visible"))
    r.selector = postcss.parse(oldRule).nodes[0].selector;
});
const baselineCss = baseline.toString();
// State attributes retain pseudo-class specificity. Simple color background
// shorthands are expanded so the bounded evaluator models their importance.
function states(text) {
  const ast = postcss.parse(text);
  ast.walkRules((r) => {
    r.selector = r.selector.replace(
      /(?<!\\):(focus-visible|focus|hover|disabled)\b/g,
      (_, s) => `[data-test-${s}]`,
    );
  });
  ast.walkDecls("background", (d) => {
    if (/^(var\(|oklch\(|rgb\(|#|transparent)/.test(d.value)) d.prop = "background-color";
  });
  return ast.toString();
}
const styled = states(css);
const { buttonVariants } = loadUiModule("src/components/ui/button.tsx", {
  react: { forwardRef: (f) => f },
  "@radix-ui/react-slot": { Slot: "Slot" },
  "class-variance-authority": { cva },
  "@/lib/utils": { cn: (...x) => x.filter(Boolean).join(" ") },
});
const escape = (s) =>
  s
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
const variants = ["default", "secondary", "outline", "ghost", "link", "destructive"].map(
  (variant) => ({ name: variant, classes: buttonVariants({ variant }) }),
);
variants.push({
  name: "auth-submit",
  classes: buttonVariants() + " audit-auth-submit w-full h-14 rounded-full text-[15px] font-medium",
});
variants.push(
  {
    name: "custom-inverse",
    classes: "bg-foreground text-background hover:opacity-90 disabled:opacity-50",
  },
  { name: "custom-muted", classes: "text-muted-foreground hover:text-foreground" },
  { name: "custom-danger-text", classes: "text-destructive hover:bg-destructive/10" },
);
function fixture(c, width, dark, classes, state = [], role = "dialog") {
  const root = element("html", dark ? "dark" : ""),
    dialog = element(
      "div",
      classes.includes("audit-auth-submit")
        ? "kova-auth-surface bg-card text-foreground"
        : "bg-background text-foreground",
      root,
      { role },
    );
  const attrs = Object.fromEntries(state.map((s) => ["data-test-" + s, ""]));
  if (state.includes("disabled")) attrs.disabled = "";
  if (classes.includes("audit-auth-submit")) attrs.type = "submit";
  return element("button", escape(classes), dialog, attrs);
}
// Resolve inherited foreground/surface for transparent outline/ghost/custom buttons.
const inherited = (c, el, prop) => {
  const value = c.value(el, prop);
  return value && !["inherit", "unset"].includes(value)
    ? value
    : el.parent
      ? inherited(c, el.parent, prop)
      : undefined;
};
const pair = (c, el) => [
  inherited(c, el, "color"),
  c.value(el, "background-color") ?? "transparent",
  c.value(el, "opacity") ?? "1",
];
// Convert actual OKLCH tokens to sRGB. Transparency and element opacity use
// standard sRGB compositing over the dialog surface before WCAG luminance.
function rgb(color) {
  if (color === "transparent") return [0, 0, 0, 0];
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
    const raw = color.slice(1),
      h =
        raw.length < 5
          ? raw
              .split("")
              .map((x) => x + x)
              .join("")
          : raw;
    return [0, 2, 4]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .concat(h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1);
  }
  const mix = /^color-mix\(in oklab,\s*(oklch\([^)]*\))\s*([\d.]+)%,\s*transparent\)$/.exec(color);
  if (mix) {
    const out = rgb(mix[1]);
    out[3] = Number(mix[2]) / 100;
    return out;
  }
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\)$/.exec(color);
  assert.ok(m, color);
  const L = Number(m[1]) / (m[2] ? 100 : 1),
    C = Number(m[3]),
    h = (Number(m[4]) * Math.PI) / 180,
    a = C * Math.cos(h),
    b = C * Math.sin(h),
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    q = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * q + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * q - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * q + 1.707614701 * s,
  ]
    .map((v) => {
      const x = Math.max(0, Math.min(1, v));
      return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    })
    .concat(m[5] ? Number(m[5]) / (m[6] ? 100 : 1) : 1);
}
const composite = (fg, bg, opacity = 1) =>
  fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) * opacity + bg[i] * (1 - (fg[3] ?? 1) * opacity));
const luminance = (color) =>
  color
    .slice(0, 3)
    .reduce(
      (n, v, i) =>
        n + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i],
      0,
    );
function contrast(c, el) {
  const [fg, bg, opacity] = pair(c, el),
    surface = rgb(c.value(el.parent, "background-color") ?? c.value(el, "--background")),
    background = composite(rgb(bg), surface),
    text = composite(rgb(fg), background);
  const a = luminance(
      composite(
        [...text, 1],
        surface,
        opacity.endsWith("%") ? parseFloat(opacity) / 100 : Number(opacity),
      ),
    ),
    b = luminance(
      composite(
        [...background, 1],
        surface,
        opacity.endsWith("%") ? parseFloat(opacity) / 100 : Number(opacity),
      ),
    );
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
test("Prior generic focus reset reproduces Temporary, Auth and custom inverse contrast defects", () => {
  const c = compiledCascade(states(baselineCss), 390, true);
  for (const classes of [
    buttonVariants(),
    "bg-foreground text-background",
    buttonVariants() + " audit-auth-submit",
  ]) {
    const button = fixture(c, 390, true, classes, ["focus-visible"]);
    assert.equal(c.value(button, "background-color"), c.value(button, "--accent"));
    assert.ok(contrast(c, button) < 1.5);
    assert.match(c.winner(button, "background-color").selector, /role=.?dialog/);
  }
});
for (const width of [390, 1440])
  for (const dark of [false, true]) {
    test(`Shared dialog variants retain paired colors and one focus indicator ${width} dark=${dark}`, () => {
      const c = compiledCascade(styled, width, width < 768);
      for (const variant of variants)
        for (const state of [[], ["hover"], ["disabled"], ["disabled", "hover"]]) {
          const plain = fixture(c, width, dark, variant.classes, state),
            focused = fixture(c, width, dark, variant.classes, [
              ...state,
              "focus-visible",
              "focus",
            ]);
          assert.deepEqual(
            pair(c, focused),
            pair(c, plain),
            `${variant.name} ${state}: focus must preserve variant pairing/opacity`,
          );
          assert.match(c.value(focused, "outline"), /^2px solid /);
          assert.equal(c.value(focused, "outline-offset"), "2px");
          assert.equal(
            c.value(focused, "box-shadow"),
            "none",
            "no utility ring doubling the outline",
          );
          const ratio = contrast(c, focused);
          assert.ok(Number.isFinite(ratio));
          // Disabled opacity remains unchanged; enabled action pairs must meet4.5:1.
          if (!state.includes("disabled"))
            assert.ok(ratio >= 4.5, `${variant.name} ${state}: ${ratio}`);
        }
    });
    test(`Temporary dialog footer minimum is phone-only ${width} dark=${dark}`, () => {
      const c = compiledCascade(styled, width, width < 768);
      for (const variant of ["default", "outline"]) {
        const el = fixture(c, width, dark, buttonVariants({ variant }) + " kova-workspace-action");
        assert.equal(c.value(el, "height"), "calc(.25rem * 10)");
        assert.equal(c.value(el, "min-height"), width < 768 ? "44px" : undefined);
        assert.equal(c.value(el, "min-width"), width < 768 ? "44px" : undefined);
      }
    });
  }
test("Menu/listbox reset and alert dialog variants are unaffected by removing dialog ancestor", () => {
  const c = compiledCascade(styled, 390, true),
    old = compiledCascade(states(baselineCss), 390, true);
  for (const role of ["menu", "listbox", "alertdialog"])
    for (const variant of variants) {
      const target = fixture(c, 390, true, variant.classes, ["focus-visible"], role);
      for (const property of ["color", "background-color", "outline", "box-shadow"])
        assert.equal(c.value(target, property), old.value(target, property));
    }
});
// Emit source-backed numerical audit without turning existing limits into passes.
if (process.env.KOVA_CONTRAST_AUDIT) {
  const rows = [];
  for (const width of [390, 1440])
    for (const dark of [false, true]) {
      const c = compiledCascade(styled, width, width < 768);
      for (const variant of variants)
        for (const state of [[], ["hover"], ["disabled"], ["disabled", "hover"]]) {
          const el = fixture(c, width, dark, variant.classes, [...state, "focus-visible"]);
          rows.push({
            width,
            theme: dark ? "dark" : "light",
            variant: variant.name,
            state: [...state, "focus-visible"],
            pair: pair(c, el),
            contrast: Number(contrast(c, el).toFixed(3)),
          });
        }
    }
  console.log("CONTRAST_AUDIT=" + JSON.stringify(rows));
}
