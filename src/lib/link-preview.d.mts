export function normalizeLinkPreviewUrl(raw: unknown): string | null;
export const COMPOSER_LINK_MARKER: string;
export type ComposerLinkToken = { raw: string; url: string; start: number; end: number };
export function firstLinkPreviewToken(text: unknown): ComposerLinkToken | null;
export function firstLinkPreviewUrl(text: unknown): string | null;
export function toComposerLinkDisplay(text: string, rawLink: string | null): string;
export function fromComposerLinkDisplay(display: string, rawLink: string | null): string;
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
