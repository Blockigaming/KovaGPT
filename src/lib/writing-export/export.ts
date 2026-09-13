import { downloadBytes, safeDocumentFilename } from "./common";
export type DocumentExportFormat = "pdf" | "docx" | "xlsx" | "pptx";
export async function downloadDocument(
  format: DocumentExportFormat,
  title: string,
  content: string,
  isCurrent: () => boolean = () => true,
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
  if (!isCurrent()) return false;
  downloadBytes(bytes, types[format], safeDocumentFilename(title, format));
  return true;
}
