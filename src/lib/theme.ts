// Theme mode toggle. The full palette lives in src/styles.css under
// :root (light) and .dark (dark). This module only flips the .dark class
// on <html> based on user preference or system setting.

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "kova-theme-mode";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const isDark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", isDark);
  // Drop the pre-paint CSSOM override in the same task as the class update, so
  // later light/dark changes use the original stylesheet without a bright frame.
  (window as Window & { __kovaRestoreThemeSelectors?: () => void }).__kovaRestoreThemeSelectors?.();
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
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
