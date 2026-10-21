import { useId, useState } from "react";
import {
  formatPdfPageNumbers,
  type PdfExtractionMetadata,
} from "@/lib/document-extraction/pdf-metadata.mjs";

/** Controls only the local extracted text; it never re-reads or renders PDF bytes. */
export function ComposerPdfPages({
  pdf,
  selectedPages,
  disabled,
  onSelect,
}: {
  pdf: PdfExtractionMetadata;
  selectedPages?: number[];
  disabled: boolean;
  onSelect: (input: string | null) => string | undefined;
}) {
  const id = useId();
  const available = pdf.pages
    .filter((page) => page.status === "extracted")
    .map((page) => page.pageNumber);
  const empty = pdf.pages
    .filter((page) => page.status === "no_text")
    .map((page) => page.pageNumber);
  const failed = pdf.pages
    .filter((page) => page.status === "failed")
    .map((page) => page.pageNumber);
  const [input, setInput] = useState(formatPdfPageNumbers(selectedPages ?? available));
  const [error, setError] = useState<string | undefined>();
  const apply = (value: string | null) => {
    if (disabled) return;
    const nextError = onSelect(value);
    setError(nextError);
    if (value === null && !nextError) setInput(formatPdfPageNumbers(available));
  };
  return (
    <section aria-label="PDF extracted text pages" className="space-y-3 text-sm">
      <p>
        {pdf.pageCount} PDF {pdf.pageCount === 1 ? "page" : "pages"} · {available.length} with
        extracted text
      </p>
      {available.length > 0 && <p>Available text pages: {formatPdfPageNumbers(available)}</p>}
      {empty.length > 0 && (
        <p>
          No extractable text on pages {formatPdfPageNumbers(empty)}. These pages may be blank or
          scanned; this does not mean a page read failed. OCR is not available.
        </p>
      )}
      {failed.length > 0 && (
        <p role="status">
          Text extraction failed on pages {formatPdfPageNumbers(failed)}.{" "}
          {available.length
            ? "Successful pages remain available."
            : "No successful text pages are available."}
        </p>
      )}
      <p id={`${id}-scope`}>
        {selectedPages
          ? `Sending extracted text from pages ${formatPdfPageNumbers(selectedPages)} of ${pdf.pageCount} only.`
          : available.length
            ? "All available extracted text is attached, with markers for pages without available text."
            : "No extracted text can be sent from this PDF."}{" "}
        Selection changes this message only. The full local extraction is kept for Restore while
        this attachment is in the composer. Saved Library copies are unchanged. This is a text
        preview, not an original PDF preview.
      </p>
      {available.length > 0 && (
        <>
          <label htmlFor={`${id}-range`}>Text pages to send</label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
            id={`${id}-range`}
            type="text"
            value={input}
            maxLength={400}
            placeholder="1-3, 5"
            disabled={disabled}
            aria-describedby={`${id}-scope${error ? ` ${id}-error` : ""}`}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setInput(event.target.value);
              setError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply(input);
              }
            }}
          />
          <div className="spec400-dialog-footer flex-wrap">
            <button
              type="button"
              className="spec400-toolbar-button"
              disabled={disabled}
              onClick={() => apply(input)}
            >
              Use selected pages
            </button>
            <button
              type="button"
              className="spec400-toolbar-button"
              disabled={disabled || !selectedPages}
              onClick={() => apply(null)}
            >
              Restore full extraction
            </button>
          </div>
          {error && (
            <p id={`${id}-error`} role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
