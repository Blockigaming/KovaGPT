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
  };
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
  for (const token of ["--primary", "--ring"]) {
    if (values.interfaceAccent) root.style.setProperty(token, values.interfaceAccent);
    else root.style.removeProperty(token);
  }
  root.style.setProperty("--kova-reading-size", `${values.readingSize}px`);
  // One shared column token preserves the saved 680/760/900 preferences.
  root.style.setProperty("--kova-reading-width", `${values.readingWidth}px`);
  root.dataset.kovaDensity = values.density;
  root.dataset.kovaMotion = values.motion;
}
