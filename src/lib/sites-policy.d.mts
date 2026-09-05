export const SITE_LIMITS: Readonly<{
  files: number;
  fileBytes: number;
  versionBytes: number;
  bodyBytes: number;
  sites: number;
  versions: number;
  viewers: number;
}>;
export const SITE_TYPES: Readonly<Record<string, string>>;
export class SiteInputError extends Error {
  code: string;
  constructor(code?: string);
}
export function siteUuid(value: unknown): string;
export function siteSlug(value: unknown): string;
export function sitePath(value: unknown): { path: string; type: string };
export function sha256(value: string | BufferSource): Promise<string>;
export type SiteFile = { path: string; type: string; base64: string; size: number; sha256: string };
export function inspectSiteFiles(
  value: unknown,
): Promise<{ files: SiteFile[]; bytes: number; manifestSha256: string }>;
export type SiteHosting = { appOrigin: string; assetOrigin: string; assetHost: string };
export function siteHostingConfig(env?: Record<string, string | undefined>): SiteHosting | null;
export function siteOrigin(config: SiteHosting, siteId: string): string;
export function siteAssetRequest(
  request: Request,
  config: SiteHosting | null,
): { siteId: string; url: URL } | null;
