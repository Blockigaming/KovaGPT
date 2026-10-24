export const DOCUMENT_EXPORT_PATH: "/api/document-export";
export const MAX_DOCUMENT_EXPORT_BYTES: number;
export const MAX_DOCUMENT_EXPORT_FORM_BYTES: number;
export const DOCUMENT_EXPORT_TYPES: Readonly<
  Record<"md" | "html" | "txt" | "pdf" | "docx" | "xlsx" | "pptx", string>
>;
export type DocumentDeliveryFormat = keyof typeof DOCUMENT_EXPORT_TYPES;
export function safeExportDeliveryFilename(
  filename: string,
  format: DocumentDeliveryFormat,
): string;
export function encodeDocumentExportBytes(bytes: Uint8Array): string;
