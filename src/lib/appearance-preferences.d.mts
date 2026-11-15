export type AppearancePreferences = {
  interfaceColors: Record<string, string>;
  interfaceFont: "system" | "serif" | "mono";
  interfaceSize: number;
  settingsNavigationWidth: number;
  interfaceAccent: string;
  mode: "dark" | "light" | "system";
  readingSize: 16 | 18 | 20;
  readingWidth: 680 | 760 | 900;
  density: "comfortable" | "compact";
  motion: "full" | "reduced";
  contrast: "system" | "high";
};
export const APPEARANCE_DEFAULTS: Readonly<AppearancePreferences>;
export function resetAppearance<T>(settings: T): T & AppearancePreferences;
export function appearanceValues(settings: Partial<AppearancePreferences>): AppearancePreferences;
export function applyReadingPreferences(
  root: HTMLElement,
  settings: Partial<AppearancePreferences>,
): void;
