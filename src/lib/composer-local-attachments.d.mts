export const LOCAL_PASTE_THRESHOLD: number;
export const LOCAL_PASTE_MAX_CHARACTERS: number;
export const LOCAL_PASTE_MAX_BYTES: number;
export const ATTACHMENT_PREVIEW_CHARACTERS: number;
export const PASTE_CARD_MIN_CHARACTERS: number;
export const PASTE_CARD_MIN_LINES: number;
export const PASTED_TEXT_MAX_CHARACTERS: number;
export const PASTED_TEXT_MAX_PER_MESSAGE: number;
export function shouldCardPaste(text: string): boolean;
export function isFreePastedText(text: string): boolean;
export function pastePreviewSnippet(text: string): string;
export function utf8TextBytes(text: string): number;
export function summarizeLocalPaste(text: string): string;
export function prepareLocalPaste(text: string): { text: string; size: number; summary: string };
export function attachmentPreviewWindow(
  text: string,
  requestedStart?: number,
): { text: string; start: number; end: number; total: number };
export function pasteAttachmentIntoDraft(
  current: string,
  text: string,
  origin?: { original: string; start: number; end: number },
): string;
