import { boundedDocumentText, DOCUMENT_INPUT_BYTES, DocumentExtractionError } from "./office.mjs";
import type { getDocument as GetDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractPdfDocument(bytes: Uint8Array, getDocument: typeof GetDocument) {
  if (
    bytes.length > DOCUMENT_INPUT_BYTES ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  )
    throw new DocumentExtractionError("This is not a supported PDF, or it exceeds 10 MB.");
  const task = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
    maxImageSize: 0,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    enableXfa: false,
  });
  try {
    const document = await task.promise;
    if (document.numPages > 100)
      throw new DocumentExtractionError("PDF extraction supports up to 100 pages.");
    const sections: string[] = [];
    let hasText = false,
      items = 0;
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const reader = page.streamTextContent().getReader();
      let value = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const item of chunk.value.items)
            if ("str" in item) {
              if (++items > 50_000)
                throw new DocumentExtractionError("The PDF has too many text elements.");
              value += item.str + (item.hasEOL ? "\n" : " ");
            }
          boundedDocumentText([...sections, `[Page ${index}]\n${value}`]);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        page.cleanup();
      }
      if (value.trim()) hasText = true;
      sections.push(`[Page ${index}]\n${value.trim() || "[No extractable text on this page]"}`);
    }
    if (!hasText)
      throw new DocumentExtractionError(
        "This PDF has no extractable text. OCR for scanned pages is not available.",
      );
    return {
      text: boundedDocumentText(sections),
      note: "Extracted PDF text with page markers; reading order may vary. Images, annotations and scanned-page OCR are not included.",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw new DocumentExtractionError("This PDF is password protected. Upload an unlocked copy.");
    throw error;
  } finally {
    await task.destroy();
  }
}
