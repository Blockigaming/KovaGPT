export const EMPTY_DOCUMENT_TITLE: { title: string };
export function isDocumentTitle(v: unknown): v is { title: string };
export function formatDocumentSelection(
  text: string,
  start: number,
  end: number,
  action: string,
  url?: string,
): { text: string; start: number; end: number };
