import { boundedDocumentText, DOCUMENT_INPUT_BYTES, DocumentExtractionError } from "./office.mjs";
import {
  PDF_MAX_PAGES,
  pdfPageSection,
  formatPdfPageNumbers,
  type PdfPageObservation,
} from "./pdf-metadata.mjs";
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
    if (
      !Number.isInteger(document.numPages) ||
      document.numPages < 1 ||
      document.numPages > PDF_MAX_PAGES
    )
      throw new DocumentExtractionError("PDF extraction supports up to 100 pages.");
    const pages: PdfPageObservation[] = [];
    const sections: string[] = [];
    let items = 0;
    for (let index = 1; index <= document.numPages; index++) {
      let page: Awaited<ReturnType<typeof document.getPage>> | undefined;
      let reader: ReadableStreamDefaultReader | undefined;
      let observation: PdfPageObservation;
      try {
        page = await document.getPage(index);
        reader = page.streamTextContent().getReader();
        let value = "";
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
        observation = value.trim()
          ? { pageNumber: index, status: "extracted", text: value.trim() }
          : { pageNumber: index, status: "no_text" };
      } catch (error) {
        // Resource-limit errors still fail the entire document. A real page-read
        // failure records no partial text or parser error details for that page.
        if (
          error instanceof DocumentExtractionError ||
          (error instanceof Error && error.name === "PasswordException")
        )
          throw error;
        observation = { pageNumber: index, status: "failed" };
      } finally {
        await reader?.cancel().catch(() => undefined);
        page?.cleanup();
      }
      pages.push(observation);
      sections.push(pdfPageSection(observation));
      boundedDocumentText(sections);
    }
    const pdf = { pageCount: document.numPages, pages };
    if (!pages.some((page) => page.status === "extracted"))
      throw Object.assign(
        new DocumentExtractionError(
          pages.some((page) => page.status === "failed")
            ? "No PDF text is available. Some page reads failed; see the page details. OCR is not available."
            : "This PDF has no extractable text. Pages may be blank or scanned; OCR is not available.",
        ),
        { pdf },
      );
    const failed = pages.filter((page) => page.status === "failed").map((page) => page.pageNumber);
    const empty = pages.filter((page) => page.status === "no_text").map((page) => page.pageNumber);
    return {
      text: boundedDocumentText(sections),
      note: [
        failed.length
          ? `Text extraction failed on pages ${formatPdfPageNumbers(failed)}; successful page text is available.`
          : "",
        empty.length
          ? `No extractable text on pages ${formatPdfPageNumbers(empty)}; these pages may be blank or scanned.`
          : "",
        "Extracted PDF text with page markers; reading order may vary. Images, annotations and scanned-page OCR are not included.",
      ]
        .filter(Boolean)
        .join(" "),
      pdf,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw new DocumentExtractionError("This PDF is password protected. Upload an unlocked copy.");
    throw error;
  } finally {
    await task.destroy();
  }
}
