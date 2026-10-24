# Synthetic PDF page and resource samples

These fixed local files contain fictional interface-review material only. They contain no account data, links, scripts, forms, or external fetch URLs. Use them only in the isolated private review. Never send a chat or upload to a live account merely to inspect them.

The committed bytes are reproduced by `review-kit/pdf-page-review-samples.mjs` and checked against the installed `pdfjs-dist` parser in `tests/unit/pdf-page-review-coverage.test.mjs`.

## Composer extraction

- `synthetic-all-blank.pdf`: two genuinely blank pages. Extraction returns two `no_text` observations and no sendable text. Inspect the error/preview; there must be no page selector and no automatic Library save.
- `synthetic-text-blank-failed.pdf`: three pages. The real extraction result is `extracted`, `no_text`, `failed`, in that order. Page 3 contains a deliberately malformed non-stream Form XObject. Only page 1 can be selected; selecting pages 2 or 3 must fail without changing the full original extraction. The readable first page explicitly labels this fictional material.
- `synthetic-all-page-reads-failed.pdf`: both pages contain the same bounded malformed Form resource. Real extraction returns two `failed` observations and no sendable text. No page selector or automatic Library save should appear.

No OCR or Office-rendering support is implied. Failed-plus-blank is also generated and checked in tests; it is not an additional native handoff file.

## Original-preview resource checks

The dedicated `library-pdf-resource-review` scenario appends three labeled resource records without changing the existing Library samples. Open each record and use its normal Original / Extracted text controls. Its saved text is independently authored fictional material, not a claim that the parser extracted it from the original. Exact original and detail reads are owner/generation-bound. All Library server mutations are denied; reset recreates the same records. Version history is explicitly unsupported for these records.

- `synthetic-large-mediabox.pdf`: one valid 14,400 by 14,400 point page. The installed preview helper scales it to a 1,224 by 1,224 canvas, below its 1,500,000-pixel cap. Text remains visibly rendered.
- `synthetic-101-page-limit.pdf`: 101 pages. Both extraction and original preview reject it at the existing 100-page limit. A synthetic Library record may retain separately saved text; check that Extracted text remains accessible after original preview is rejected. Do not equate original-preview failure with loss of saved text.
- `synthetic-unsupported-cmap.pdf`: one page containing a font that requires the named CMap `90ms-RKSJ-H.bcmap`. The actual resource guard rejects that request without external fetch. The installed PDF.js renderer resolves with an entirely white fallback canvas, rather than rejecting. This is an explicit fidelity limitation. Do not record it as a successfully faithful preview or an observed UI error.

## Exact proof boundaries

The malformed Form resource reliably fails text extraction. The installed renderer nevertheless suppresses its operator-list error and resolves a white page. Consequently, these real bytes do not demonstrate the UI's render-error state.

The actual original-preview component's getPage/render rejection, canvas cleanup, private-error suppression, disposal and explicit Retry are tested separately through the real preview helper with bounded injected parser failures. Those are component/contract tests, not claimed failures of these real render bytes.

Additional tests exercise real PDFs at exactly 10 MB, rejection at one byte over, malformed/oversized bundled-font envelopes, and the existing page, text, element, deadline, cancellation and scratch-canvas limits. No provider, account storage or remote resource is involved.
