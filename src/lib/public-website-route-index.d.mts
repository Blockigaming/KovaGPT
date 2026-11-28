export type WebsiteRoute = Readonly<{ path: string; title: string; indexable: boolean }>;
export const PUBLIC_WEBSITE_ROUTE_INDEX: readonly WebsiteRoute[];
export const PUBLIC_WEBSITE_ROUTE_BY_PATH: ReadonlyMap<string, WebsiteRoute>;
export const PUBLIC_WEBSITE_INDEXABLE_PATHS: readonly string[];
export const PUBLIC_WEBSITE_FOOTER: readonly Readonly<{
  label: string;
  links: readonly Readonly<{ label: string; to: string }>[];
}>[];
