export function normalizeLinkPreviewUrl(raw: unknown): string | null;
export const COMPOSER_LINK_MARKER: string;
export type ComposerLinkToken = { raw: string; url: string; start: number; end: number };
export function firstLinkPreviewToken(
  text: unknown,
  options?: { requireBareDelimiter?: boolean },
): ComposerLinkToken | null;
export function linkPreviewTokens(
  text: unknown,
  options?: { requireBareDelimiter?: boolean },
): ComposerLinkToken[];
export function firstLinkPreviewUrl(text: unknown): string | null;
export type ComposerLinkDisplay = {
  text: string;
  positions: { offset: number; token: ComposerLinkToken }[];
};
export function composerLinkDisplay(
  draft: string,
  collapsed: ComposerLinkToken[],
): ComposerLinkDisplay;
export function canonicalComposerOffset(display: ComposerLinkDisplay, offset: number): number;
export function composerTextChange(
  previous: string,
  next: string,
  caret: number,
): { start: number; end: number; text: string };
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
