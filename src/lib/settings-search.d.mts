export function normalizeSettingsSearch(value: unknown): string;
export function matchesSettingsSearch(
  item: {
    id?: string;
    label?: string;
    keywords?: readonly string[];
    description?: string;
    groups?: readonly string[];
  },
  query: string,
): boolean;
