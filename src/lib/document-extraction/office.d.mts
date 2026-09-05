export const DOCUMENT_INPUT_BYTES: number;
export const DOCUMENT_TEXT_CHARS: number;
export function readOfficeXml(bytes: Uint8Array): Map<string, string>;
export function boundedDocumentText(sections: string[]): string;
export function extractOfficeDocument(
  bytes: Uint8Array,
  extension: string,
): { text: string; note: string };

export class DocumentExtractionError extends Error {}
