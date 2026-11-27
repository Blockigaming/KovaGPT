export const VOICE_SETTINGS_SEARCH_TERMS: string;
export function settingsSearchMatches(
  item: { v: string; label: string; keywords?: readonly string[] },
  query: string,
  description?: string,
): boolean;

export function settingsSearchParts(value: string, query: string): { text: string; match: boolean }[];
export function settingsSearchHint(
  item: { v: string; label: string; keywords?: readonly string[] },
  query: string,
  description?: string,
  topics?: string,
): string;
