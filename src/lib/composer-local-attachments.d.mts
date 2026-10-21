export const LOCAL_PASTE_THRESHOLD: number;
export const LOCAL_PASTE_MAX_CHARACTERS: number;
export const LOCAL_PASTE_MAX_BYTES: number;
export const ATTACHMENT_PREVIEW_CHARACTERS: number;
export function utf8TextBytes(text: string): number;
export function prepareLocalPaste(text: string): { text: string; size: number };
export function attachmentPreviewWindow(
  text: string,
  requestedStart?: number,
): { text: string; start: number; end: number; total: number };
export function pasteAttachmentIntoDraft(
  current: string,
  text: string,
  origin?: { original: string; start: number; end: number },
): string;
