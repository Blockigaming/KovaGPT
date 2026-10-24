// Appearance is a bounded slice of principal-scoped device preferences.
// Never use the full Settings default to reset it: that would clear responses.
export const APPEARANCE_DEFAULTS = Object.freeze({
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
    mode: ["dark", "light", "system"].includes(settings.mode) ? settings.mode : "dark",
    readingSize: [16, 18, 20].includes(settings.readingSize) ? settings.readingSize : 16,
    readingWidth: [680, 760, 900].includes(settings.readingWidth) ? settings.readingWidth : 760,
    density: settings.density === "compact" ? "compact" : "comfortable",
    motion: settings.motion === "reduced" ? "reduced" : "full",
  };
}

export function applyReadingPreferences(root, settings) {
  const values = appearanceValues(settings);
  root.style.setProperty("--kova-reading-size", `${values.readingSize}px`);
  // One shared column token preserves the saved 680/760/900 preferences.
  root.style.setProperty("--kova-reading-width", `${values.readingWidth}px`);
  root.dataset.kovaDensity = values.density;
  root.dataset.kovaMotion = values.motion;
}
