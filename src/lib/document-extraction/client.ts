import {
  PdfTextUnavailableError,
  validateDocumentExtractionResult,
  validatePdfMetadata,
  type DocumentExtractionResult,
} from "./pdf-metadata.mjs";

const INPUT_BYTES = 10 * 1024 * 1024;
export async function extractDocumentFile(
  file: File,
  signal?: AbortSignal,
): Promise<DocumentExtractionResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!/^(pdf|docx|xlsx|pptx)$/u.test(extension))
    throw new Error("This document format is unsupported.");
  if (file.size > INPUT_BYTES) throw new Error("Documents must be at most 10 MB.");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const bytes = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./document-extraction.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(
      () => fail(new Error("Document extraction took too long. Split the document and try again.")),
      15_000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => fail(new Error("Document extraction is unavailable in this browser."));
    worker.onmessage = (event) => {
      const result = event.data;
      // PDF.js emits a transport-ready event when its handler loads inside a worker.
      // Only our result envelope can settle this extraction.
      if (result?.kind !== "document-extraction-result") return;
      cleanup();
      const validated =
        result?.ok === true
          ? validateDocumentExtractionResult(result, extension === "pdf")
          : undefined;
      if (validated) resolve(validated);
      else {
        const message =
          typeof result?.error === "string" && result.error.length <= 2_000
            ? result.error
            : "Document extraction failed.";
        const pdf =
          result?.ok === false && extension === "pdf" ? validatePdfMetadata(result.pdf) : undefined;
        reject(
          pdf && !pdf.pages.some((page) => page.status === "extracted")
            ? new PdfTextUnavailableError(message, pdf)
            : new Error(message),
        );
      }
    };
    worker.postMessage({ bytes, extension }, [bytes]);
  });
}
