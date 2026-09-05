export type DocumentPage = { pageNumber: number; text: string; charStart: number; charEnd: number };
export type DocumentExtraction = {
  fileId: string;
  category: "pdf" | "text" | "markdown" | "code" | "json";
  pageCount: number;
  pages: DocumentPage[];
  scannedPdf: boolean;
  passwordProtected: boolean;
  unsupportedReason?: string;
};
export function extractTextDocument(
  fileId: string,
  text: string,
  category: DocumentExtraction["category"] = "text",
): DocumentExtraction {
  if (text.length > 500_000)
    throw new Error(
      "Document text exceeds 500,000 characters. Split the document; nothing has been truncated.",
    );
  const normalized = text.replace(/\r\n/g, "\n");
  return {
    fileId,
    category,
    pageCount: 1,
    pages: [{ pageNumber: 1, text: normalized, charStart: 0, charEnd: normalized.length }],
    scannedPdf: false,
    passwordProtected: false,
  };
}
export function describePdfFailure(
  reason: "scanned" | "password" | "oversized" | "unsupported",
): DocumentExtraction {
  return {
    fileId: "unavailable",
    category: "pdf",
    pageCount: 0,
    pages: [],
    scannedPdf: reason === "scanned",
    passwordProtected: reason === "password",
    unsupportedReason:
      reason === "scanned"
        ? "This PDF appears scanned. OCR is not configured, so text extraction is unavailable."
        : reason === "password"
          ? "This PDF is password protected."
          : reason === "oversized"
            ? "This PDF exceeds the configured size limit."
            : "This PDF format is unsupported.",
  };
}
export function chunkDocument(extraction: DocumentExtraction, maxChars = 1800) {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 500_000)
    throw new Error("Invalid document chunk size.");
  return extraction.pages.flatMap((page) => {
    const chunks: Array<{ pageNumber: number; text: string; citation: string }> = [];
    for (let i = 0; i < page.text.length; i += maxChars) {
      const text = page.text.slice(i, i + maxChars).trim();
      if (text)
        chunks.push({ pageNumber: page.pageNumber, text, citation: `p. ${page.pageNumber}` });
    }
    return chunks;
  });
}
