import type { WebsitePage } from "./public-website-catalog.mjs";

export type DeveloperReferenceEntry = {
  slug: string;
  title: string;
  request: string;
  behavior: string;
  path?: string;
  methods?: string[];
  searchText?: string;
};
export const DEVELOPER_ENDPOINTS: DeveloperReferenceEntry[];
export const DEVELOPER_GUIDES: DeveloperReferenceEntry[];
export const DEVELOPER_REFERENCE: DeveloperReferenceEntry[];
export const DEVELOPER_REFERENCE_BY_SLUG: Map<string, DeveloperReferenceEntry>;
export function developerReferencePage(entry: DeveloperReferenceEntry): WebsitePage;
export const DEVELOPER_BASELINE_PATHS: string[];
export const DEVELOPER_DEDICATED_PATHS: string[];
export const DEVELOPER_PAGE_PATHS: string[];
export const DEVELOPER_SOURCE_HISTORY: {
  date: string;
  commit: string;
  title: string;
  change: string;
}[];
