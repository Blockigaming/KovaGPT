export function normalizeLinkPreviewUrl(raw: unknown): string | null;
export function firstLinkPreviewUrl(text: unknown): string | null;
export function isOnlyLink(text: unknown, url: string): boolean;
export function siteNameForLink(url: string): string;
export function fallbackLinkTitle(url: string): string;
export function cleanLinkTitle(input: unknown): string;
export function readPageLinkMetadata(
  html: string,
  url: string,
): {
  title: string;
  siteName: string;
  iconUrl: string | null;
};
