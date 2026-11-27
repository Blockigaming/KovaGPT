import type { WebsitePage } from "./public-website-catalog.mjs";

export type DeveloperReferenceEntry = {
  slug: string;
  title: string;
  request: string;
  behavior: string;
  path?: string;
  methods?: string[];
};
export const DEVELOPER_ENDPOINTS: DeveloperReferenceEntry[];
export const DEVELOPER_GUIDES: DeveloperReferenceEntry[];
export const DEVELOPER_REFERENCE: DeveloperReferenceEntry[];
export const DEVELOPER_REFERENCE_BY_SLUG: Map<string, DeveloperReferenceEntry>;
export function developerReferencePage(entry: DeveloperReferenceEntry): WebsitePage;
