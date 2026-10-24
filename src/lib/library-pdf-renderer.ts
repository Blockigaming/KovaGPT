import { getDocument, PDFWorker } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { bundledPreviewFontFactory, type PreviewRenderer } from "./library-document-preview";
import { bundledPreviewFonts } from "./library-pdf-fonts";

// Loaded only after the user requests a preview. Explicitly supply a dedicated
// local module worker: PDF.js must never fall back to parsing on the UI thread.
export function createLibraryPdfRenderer(): PreviewRenderer {
  const port = new Worker(workerUrl, { type: "module" });
  let worker: PDFWorker;
  try {
    worker = PDFWorker.create({ port, verbosity: 0 });
  } catch (error) {
    port.terminate();
    throw error;
  }
  return {
    getDocument: (options, onUnavailableResource) =>
      getDocument({
        ...options,
        worker,
        BinaryDataFactory: bundledPreviewFontFactory(bundledPreviewFonts, onUnavailableResource),
      }),
    destroy: () => {
      worker.destroy();
      port.terminate();
    },
  };
}
