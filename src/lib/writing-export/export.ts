import { downloadBytes, safeDocumentFilename } from "./common";
export type DocumentExportFormat = "pdf" | "docx" | "xlsx" | "pptx";
export async function createDocumentFile(
  format: DocumentExportFormat,
  title: string,
  content: string,
) {
  const writers = {
    pdf: async () => (await import("./pdf")).createDocumentPdf(title, content),
    docx: async () => (await import("./docx")).createDocumentDocx(title, content),
    xlsx: async () => (await import("./xlsx")).createDocumentXlsx(title, content),
    pptx: async () => (await import("./pptx")).createDocumentPptx(title, content),
  };
  const types = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  const bytes = await writers[format]();
  return { bytes, type: types[format], filename: safeDocumentFilename(title, format) };
}
export async function downloadDocument(
  format: DocumentExportFormat,
  title: string,
  content: string,
  isCurrent: () => boolean = () => true,
) {
  const { bytes, type, filename } = await createDocumentFile(format, title, content);
  if (!isCurrent()) return false;
  downloadBytes(bytes, type, filename);
  return true;
}
