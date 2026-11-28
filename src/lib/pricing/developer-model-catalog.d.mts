export type DeveloperCatalogRow = {
  id: string;
  capability: string;
  reasoning_efforts: string[];
  web_search: boolean;
  inline_image_input: boolean;
  image_edits: boolean;
};
export function developerCatalogRows(value: unknown): {
  pricingVersion: string;
  rows: DeveloperCatalogRow[];
};
export function filterDeveloperCatalog(
  rows: DeveloperCatalogRow[],
  query: string,
  capability: string,
): DeveloperCatalogRow[];
