export type WebsitePage = Readonly<{
  path: string;
  title: string;
  description: string;
  sections: readonly Readonly<{ title: string; body: string; points: readonly string[] }>[];
  related: readonly Readonly<{ label: string; to: string }>[];
  indexable: boolean;
  availability?: string;
  review?: string;
}>;
export const PUBLIC_WEBSITE_PAGES: readonly WebsitePage[];
export const PUBLIC_WEBSITE_PAGE_BY_PATH: ReadonlyMap<string, WebsitePage>;
export const PUBLIC_WEBSITE_INDEXABLE_PATHS: readonly string[];
export const PUBLIC_WEBSITE_FOOTER: readonly Readonly<{
  label: string;
  links: readonly Readonly<{ label: string; to: string }>[];
}>[];
