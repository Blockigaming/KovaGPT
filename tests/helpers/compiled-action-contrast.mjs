import assert from "node:assert/strict";
import postcss from "postcss";
// Bounded compiled-color/state helpers; no native paint or device claim.
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

const escape = (s) =>
  s
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");

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

export { states, escape, pair, contrast, rgb };
