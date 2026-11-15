// Appearance is a bounded slice of principal-scoped device preferences.
// Never use the full Settings default to reset it: that would clear responses.
export const APPEARANCE_DEFAULTS = Object.freeze({
  interfaceSize: 100,
  settingsNavigationWidth: 280,
  interfaceAccent: "",
  interfaceColors: {},
  interfaceFont: "system",
  mode: "dark",
  readingSize: 16,
  readingWidth: 760,
  density: "comfortable",
  motion: "full",
  contrast: "system",
});

export function resetAppearance(settings) {
  return { ...settings, ...APPEARANCE_DEFAULTS };
}

export function appearanceValues(settings) {
  return {
    interfaceFont: ["system", "serif", "mono"].includes(settings.interfaceFont)
      ? settings.interfaceFont
      : "system",
    interfaceColors: Object.fromEntries(
      [
        "background",
        "foreground",
        "card",
        "border",
        "sidebar",
        "muted",
        "muted-foreground",
        "accent",
      ].flatMap((key) =>
        /^#[0-9a-f]{6}$/i.test(settings.interfaceColors?.[key] ?? "")
          ? [[key, settings.interfaceColors[key]]]
          : [],
      ),
    ),
    interfaceSize: Number.isFinite(settings.interfaceSize)
      ? Math.min(125, Math.max(85, settings.interfaceSize))
      : 100,
    settingsNavigationWidth: Number.isFinite(settings.settingsNavigationWidth)
      ? Math.min(440, Math.max(200, settings.settingsNavigationWidth))
      : APPEARANCE_DEFAULTS.settingsNavigationWidth,
    interfaceAccent: /^#[0-9a-f]{6}$/i.test(settings.interfaceAccent ?? "")
      ? settings.interfaceAccent
      : "",
    mode: ["dark", "light", "system"].includes(settings.mode) ? settings.mode : "dark",
    readingSize: [16, 18, 20].includes(settings.readingSize) ? settings.readingSize : 16,
    readingWidth: [680, 760, 900].includes(settings.readingWidth) ? settings.readingWidth : 760,
    density: settings.density === "compact" ? "compact" : "comfortable",
    motion: settings.motion === "reduced" ? "reduced" : "full",
    contrast: settings.contrast === "high" ? "high" : "system",
  };
}

function luminance(color) {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function readableTextColor(background, foreground) {
  if (!/^#[0-9a-f]{6}$/i.test(background) || !/^#[0-9a-f]{6}$/i.test(foreground)) return foreground;
  const surface = luminance(background) + 0.05;
  const text = luminance(foreground) + 0.05;
  if (Math.max(surface, text) / Math.min(surface, text) >= 4.5) return foreground;
  return surface / 0.05 >= 1.05 / surface ? "#000000" : "#ffffff";
}

const textSurfaces = [
  ["background", "foreground"],
  ["background", "muted-foreground"],
  ["card", "card-foreground"],
  ["popover", "popover-foreground"],
  ["sidebar", "sidebar-foreground"],
  ["accent", "accent-foreground"],
  ["secondary", "secondary-foreground"],
  ["primary", "primary-foreground"],
];

function applyReadableColors(root, values) {
  const computed = root.ownerDocument?.defaultView?.getComputedStyle(root);
  for (const token of new Set(textSurfaces.map(([, foreground]) => foreground))) {
    if (values.interfaceColors[token])
      root.style.setProperty(`--${token}`, values.interfaceColors[token]);
    else root.style.removeProperty(`--${token}`);
  }
  if (!computed || !(Object.keys(values.interfaceColors).length || values.interfaceAccent)) return;

  for (const [surface, foreground] of textSurfaces) {
    if (
      !values.interfaceColors[surface] &&
      !values.interfaceColors.foreground &&
      !values.interfaceColors[foreground] &&
      !(surface === "primary" && values.interfaceAccent)
    )
      continue;
    const background = computed.getPropertyValue(`--${surface}`).trim();
    const color = computed.getPropertyValue(`--${foreground}`).trim();
    const readable = readableTextColor(background, color);
    if (readable !== color) root.style.setProperty(`--${foreground}`, readable);
  }
}

export function applyReadingPreferences(root, settings) {
  const values = appearanceValues(settings);
  const fonts = {
    system: "ui-sans-serif, system-ui, sans-serif",
    serif: "Georgia, serif",
    mono: "ui-monospace, monospace",
  };
  root.style.setProperty("--font-ui", fonts[values.interfaceFont]);
  for (const key of [
    "background",
    "foreground",
    "card",
    "border",
    "sidebar",
    "muted",
    "muted-foreground",
    "accent",
  ]) {
    if (values.interfaceColors[key])
      root.style.setProperty(`--${key}`, values.interfaceColors[key]);
    else root.style.removeProperty(`--${key}`);
  }
  root.style.fontSize = `${(16 * values.interfaceSize) / 100}px`;
  root.style.setProperty("--kova-settings-navigation-width", `${values.settingsNavigationWidth}px`);
  for (const token of ["--primary", "--ring", "--kova-message-accent"]) {
    if (values.interfaceAccent) root.style.setProperty(token, values.interfaceAccent);
    else root.style.removeProperty(token);
  }
  if (values.interfaceAccent) {
    root.style.setProperty(
      "--kova-message-accent-text",
      readableTextColor(values.interfaceAccent, "#ffffff"),
    );
  } else {
    root.style.removeProperty("--kova-message-accent-text");
  }
  applyReadableColors(root, values);
  root.style.setProperty("--kova-reading-size", `${values.readingSize}px`);
  // One shared column token preserves the saved 680/760/900 preferences.
  root.style.setProperty("--kova-reading-width", `${values.readingWidth}px`);
  root.dataset.kovaDensity = values.density;
  root.dataset.kovaMotion = values.motion;
  root.dataset.kovaContrast = values.contrast;
}
