# Document exports and text extraction

Writing and writing Canvas offer Markdown, PDF, DOCX, XLSX and PPTX downloads.
All generation runs from the user's current document. Format code and fonts load
on demand; these operations do not call an AI provider or activate a service.

| Format | Supported output                                                                                                                                            | Explicit limits                                                                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF    | Measured wrapping, multiple Letter pages, headings, lists, code, quotes and bordered tables; embedded subset DejaVu Sans fonts                              | 400 pages. Latin, Greek and Cyrillic are covered by the bundled fonts. Missing glyphs produce an error with a DOCX alternative, never question-mark replacement.                      |
| DOCX   | Editable paragraphs, headings, actual Word tables with fixed column geometry, real lists and Unicode text                                                   | Markdown block structure is supported; inline Markdown and external images are not a full rich-document conversion.                                                                   |
| XLSX   | Editable literal text cells; narrative on a Document sheet and each Markdown table on its own sheet; wrapping, row heights, frozen header and print fitting | 50 sheets, 5,000 rows per sheet, 32,767 characters per cell, plus a stricter display-height bound. A cell that cannot display fully is rejected. Formulas supplied as text stay text. |
| PPTX   | Editable widescreen slides containing a literal outline of all source text, split across slides                                                             | 200 slides; this is a text outline, not a designed presentation or generated narrative.                                                                                               |

All exports reject titles over 500 characters, source text over 200,000 characters,
invalid XML controls and malformed Markdown tables. They fail explicitly when a
format limit is exceeded. No writer silently truncates the input. Existing HTML
and source downloads remain available. Downloads check the initiating principal
and document generation again after asynchronous preparation.

## Uploads

The composer accepts `.pdf`, `.docx`, `.xlsx` and `.pptx` files up to 10 MiB.
It extracts **text only** inside a disposable browser Worker. The attachment is
named `<original filename>.extracted.txt`, has its actual extracted text size,
and clearly states the limitations. Original binary bytes are never attached
to the model request. For signed-in users with attachment saving enabled outside
Temporary Chat, the original is separately saved to private Library storage,
alongside the extracted text. A save failure is shown with an account-bound retry;
it does not pretend that the original was retained. See `library-original-files.md`.

- PDF: up to 100 pages and 50,000 text items, with page markers. Reading order can
  vary. No scanned-page OCR, password unlocking, annotations or images.
- DOCX: body paragraph and table text. Hidden runs, deleted runs and field
  instructions are excluded. Headers, comments, images and layout are omitted.
- PPTX: up to 100 slides, in presentation order, with slide markers. Speaker
  notes, images, animation and layout are omitted.
- XLSX: up to 50 sheets and 25,000 cells, with sheet names and cell addresses.
  Formula results are explicitly labeled as cached; formulas are never executed
  or recalculated. External data, charts and formatting are omitted.

Extracted output is bounded to 80,000 characters and 200,000 UTF-8 bytes. ZIPs
are streamed in small compressed chunks, with 2 MiB per XML part, 12 MiB expanded
XML total and 2,000-entry limits. Duplicate or traversing entries, macros,
embedded active objects, DTD/entity declarations and excessive XML depth/count
are rejected. External relationships are never fetched. Legacy `.doc`, `.xls`,
`.ppt`, encrypted archives and scanned-only PDFs fail with actionable messages.

The worker is terminated after one result, after 15 seconds, on explicit removal,
on principal change or on unmount. Raw document bytes and extracted bodies are
not cached or logged by the parser. Only fixed application errors leave the
worker; parser diagnostics that could contain private XML are replaced with a
generic error. Ordinary chat and Library retention still apply once the user
sends or saves extracted text.

## Paste

Rich HTML paste is read through an inert detached template. Only text, heading,
list, emphasis and line/table separation are converted to plain Markdown text;
scripts, handlers, resource URLs and hidden elements are excluded. The prepared
text is shown as a choice before inserting. Pasted text over 10,000 characters
can instead be attached in full, with **Revert to message text** available until
the user dismisses the offer or sends/removes the attachment. No paste offer is
saved in browser storage. The same 80,000-character / 200 KB text bound applies;
oversized paste is rejected explicitly without truncation.

## Verification and maintenance

Unit tests round-trip the actual PDF/Office output and cover Unicode, tables,
full-text preservation, formula-like text, ZIP bombs/traversal, XML entities,
hidden Word text and explicit bounds. `tests/integration/document-pipeline.test.mjs`
opens the production extraction module in Chromium, exercises all four formats,
checks abort/error privacy, and verifies inert rich-paste conversion. Run after
a clean production build; no provider or production credentials are used.
PDF and LibreOffice-rendered DOCX/XLSX/PPTX samples were inspected during source QA.

Pinned library and format references:

- [pdf-lib document and embedded-font API](https://pdf-lib.js.org/docs/api/classes/pdfdocument)
- [docx Packer and OOXML output](https://docx.js.org/api/classes/Packer.html)
- [PDF.js loading and text API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [Microsoft PresentationML structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)
- [fflate streaming ZIP API](https://github.com/101arrowz/fflate)

The font license is included beside the two bundled font files. Dependencies are
pinned in the lockfile; the package audit at implementation reported no known
vulnerabilities. Recheck that gate when updating the libraries.
