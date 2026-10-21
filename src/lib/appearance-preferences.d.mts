export type AppearancePreferences = {
  mode: "dark" | "light" | "system";
  readingSize: 16 | 18 | 20;
  readingWidth: 680 | 760 | 900;
  density: "comfortable" | "compact";
  motion: "full" | "reduced";
};
export const APPEARANCE_DEFAULTS: Readonly<AppearancePreferences>;
export function resetAppearance<T>(settings: T): T & AppearancePreferences;
export function appearanceValues(settings: Partial<AppearancePreferences>): AppearancePreferences;
export function applyReadingPreferences(
  root: HTMLElement,
  settings: Partial<AppearancePreferences>,
): void;
