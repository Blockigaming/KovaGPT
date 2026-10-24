export type PdfPageObservation =
  | { pageNumber: number; status: "extracted"; text: string }
  | { pageNumber: number; status: "no_text" | "failed"; text?: never };
export type PdfExtractionMetadata = { pageCount: number; pages: PdfPageObservation[] };
export type DocumentExtractionResult = { text: string; note: string; pdf?: PdfExtractionMetadata };
export const PDF_MAX_PAGES: number;
export function boundedPdfText(text: unknown): text is string;
export function pdfPageSection(page: PdfPageObservation): string;
export function pdfDocumentText(pdf: PdfExtractionMetadata): string;
export function validatePdfMetadata(value: unknown): PdfExtractionMetadata | undefined;
export function validateDocumentExtractionResult(
  value: unknown,
  requirePdf?: boolean,
): DocumentExtractionResult | undefined;
export class PdfTextUnavailableError extends Error {
  pdf: PdfExtractionMetadata;
  constructor(message: string, pdf: PdfExtractionMetadata);
}
export function formatPdfPageNumbers(numbers: number[]): string;
export function selectPdfPages(
  value: PdfExtractionMetadata,
  input: string,
): { pageNumbers: number[]; text: string };
