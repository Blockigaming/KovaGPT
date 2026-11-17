export const VOICE_SETTINGS_SEARCH_TERMS: string;
export function settingsSearchMatches(
  item: { v: string; label: string; keywords?: readonly string[] },
  query: string,
  description?: string,
): boolean;
