// Lightweight runtime theme overrides driven by user settings.
// Stored as hex colors and converted to OKLCH-compatible values via CSS variables.

export type ThemeColors = {
  background: string;
  card: string;
  primary: string;
  primaryForeground: string;
  accent: string;
};

export const DEFAULT_THEME: ThemeColors = {
  background: "#ffffff",
  card: "#f7f7f8",
  primary: "#0a0a0a",
  primaryForeground: "#ffffff",
  accent: "#ececef",
};

const VAR_MAP: Record<keyof ThemeColors, string> = {
  background: "--background",
  card: "--card",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  accent: "--accent",
};

/** Apply colors to :root as CSS variables. Safe to call repeatedly. */
export function applyThemeColors(colors: Partial<ThemeColors>) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(colors)) {
    if (!v) continue;
    const cssVar = VAR_MAP[k as keyof ThemeColors];
    if (cssVar) root.style.setProperty(cssVar, v);
  }
}

export function resetThemeColors() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const cssVar of Object.values(VAR_MAP)) {
    root.style.removeProperty(cssVar);
  }
}
