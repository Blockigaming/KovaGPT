// Theme mode toggle. The full palette lives in src/styles/visual-tokens.css under
// :root (light) and .dark (dark). This module only flips the .dark class
// on <html> based on user preference or system setting.

export type ThemeMode = "light" | "dark" | "system";

export const DEFAULT_THEME_COLOR = "#191919";
export const PHONE_THEME_QUERY =
  "(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)";
export const PHONE_DARK_THEME_COLOR = "#111111";
export const LIGHT_THEME_COLOR = "#ffffff";

const STORAGE_KEY = "kova-theme-mode";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const isDark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", isDark);
  syncThemeColor();
  // Drop the pre-paint CSSOM override in the same task as the class update, so
  // later light/dark changes use the original stylesheet without a bright frame.
  (window as Window & { __kovaRestoreThemeSelectors?: () => void }).__kovaRestoreThemeSelectors?.();
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function syncThemeColor() {
  const dark = document.documentElement.classList.contains("dark");
  const phone = window.matchMedia?.(PHONE_THEME_QUERY).matches;
  const color = dark ? (phone ? PHONE_DARK_THEME_COLOR : DEFAULT_THEME_COLOR) : LIGHT_THEME_COLOR;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

export function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "dark";
}

// ----- Deprecated, kept for backward compatibility -----
// Older versions allowed per-color customization; we now use a single
// light/dark mode toggle. These exports keep existing stored Settings
// from crashing the app on load. They are no-ops.

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

/** @deprecated use applyThemeMode */
export function applyThemeColors(_colors?: Partial<ThemeColors>) {
  /* no-op: colors come from CSS variables now */
}

/** @deprecated use applyThemeMode */
export function resetThemeColors() {
  /* no-op */
}
