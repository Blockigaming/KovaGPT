import { extractOfficeDocument, DocumentExtractionError } from "./office.mjs";

// All parsing happens in this disposable worker. Its parent terminates it after
// 15 seconds, on abort, or after one result; no document bytes are cached.
self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; extension: string }>) => {
  try {
    const { bytes, extension } = event.data;
    let result: { text: string; note: string };
    if (extension === "pdf") {
      // The PDF parser's fake-worker transport stays inside OUR worker. Loading
      // its message handler first prevents nested workers or fallback on the UI thread.
      await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      const [{ getDocument }, { extractPdfDocument }] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("./pdf"),
      ]);
      result = await extractPdfDocument(new Uint8Array(bytes), getDocument);
    } else result = extractOfficeDocument(new Uint8Array(bytes), extension);
    self.postMessage({ kind: "document-extraction-result", ok: true, ...result });
  } catch (error) {
    // Parser internals can contain private XML. Only our fixed errors leave the worker.
    self.postMessage({
      kind: "document-extraction-result",
      ok: false,
      error:
        error instanceof DocumentExtractionError
          ? error.message
          : "This document could not be safely extracted. Try a plain-text copy.",
    });
  }
};
