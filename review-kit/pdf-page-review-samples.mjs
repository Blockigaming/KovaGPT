/** Fixed, fictional local PDF bytes. No account content, URLs, scripts or network. */
import { PDFDocument, PDFDict, PDFName, PDFString } from "pdf-lib";

export const PDF_PAGE_REVIEW_SAMPLES = Object.freeze({
  blank: Object.freeze({
    name: "synthetic-all-blank.pdf",
    statuses: Object.freeze(["no_text", "no_text"]),
  }),
  mixed: Object.freeze({
    name: "synthetic-text-blank-failed.pdf",
    statuses: Object.freeze(["extracted", "no_text", "failed"]),
  }),
  "all-failed": Object.freeze({
    name: "synthetic-all-page-reads-failed.pdf",
    statuses: Object.freeze(["failed", "failed"]),
  }),
  "failed-and-blank": Object.freeze({
    name: "synthetic-failed-and-blank.pdf",
    statuses: Object.freeze(["failed", "no_text"]),
  }),
});
const fixedDate = new Date("2026-01-01T00:00:00.000Z");
async function document(title) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor("Fictional local interface review");
  pdf.setSubject("Synthetic PDF parser and preview coverage; no account content");
  pdf.setCreationDate(fixedDate);
  pdf.setModificationDate(fixedDate);
  return pdf;
}
function failedPage(pdf, page) {
  // A Form XObject must be a stream. This deliberately bounded dictionary is not
  // one, so PDF.js stopAtErrors rejects this page's text extraction. The installed
  // renderer suppresses that error and produces a blank fallback. Invalid Flate
  // data is deliberately NOT used: the installed text parser tolerates it as blank.
  const xobjects = PDFDict.withContext(pdf.context);
  xobjects.set(
    PDFName.of("SyntheticBrokenForm"),
    pdf.context.obj({ Type: "XObject", Subtype: "Form" }),
  );
  page.node.set(PDFName.of("Resources"), pdf.context.obj({ XObject: xobjects }));
  page.node.set(
    PDFName.of("Contents"),
    pdf.context.register(pdf.context.stream("/SyntheticBrokenForm Do")),
  );
}
export async function syntheticPdfPageReviewSample(kind) {
  const sample = Object.hasOwn(PDF_PAGE_REVIEW_SAMPLES, kind)
    ? PDF_PAGE_REVIEW_SAMPLES[kind]
    : null;
  if (!sample) throw new Error("Choose a fixed synthetic PDF page-review sample.");
  const pdf = await document(`Synthetic local review: ${kind}`);
  for (const status of sample.statuses) {
    const page = pdf.addPage([400, 280]);
    if (status === "extracted") {
      page.drawText("Synthetic local PDF review", { x: 28, y: 224, size: 18 });
      page.drawText("Page 1 contains fictional text. Page 2 is blank.", {
        x: 28,
        y: 192,
        size: 12,
      });
      page.drawText("Page 3 has a deliberately malformed Form resource.", {
        x: 28,
        y: 170,
        size: 12,
      });
      page.drawText("No OCR, account storage, scripts or provider calls.", {
        x: 28,
        y: 140,
        size: 12,
      });
    } else if (status === "failed") failedPage(pdf, page);
  }
  return pdf.save({ useObjectStreams: false });
}

/** A real PDF requiring a named, non-bundled CMap. Test bytes only, never fetched. */
export async function syntheticCmapDependentPdf() {
  const pdf = await document("Synthetic local review: unsupported CMap resource");
  const page = pdf.addPage([400, 280]);
  const descriptor = pdf.context.register(
    pdf.context.obj({
      Type: "FontDescriptor",
      FontName: "HeiseiMin-W3",
      Flags: 4,
      FontBBox: [0, -200, 1000, 900],
      ItalicAngle: 0,
      Ascent: 880,
      Descent: -120,
      CapHeight: 700,
      StemV: 80,
    }),
  );
  const descendant = pdf.context.register(
    pdf.context.obj({
      Type: "Font",
      Subtype: "CIDFontType0",
      BaseFont: "HeiseiMin-W3",
      CIDSystemInfo: {
        Registry: PDFString.of("Adobe"),
        Ordering: PDFString.of("Japan1"),
        Supplement: 6,
      },
      FontDescriptor: descriptor,
      DW: 1000,
    }),
  );
  const font = pdf.context.register(
    pdf.context.obj({
      Type: "Font",
      Subtype: "Type0",
      BaseFont: "HeiseiMin-W3",
      Encoding: "90ms-RKSJ-H",
      DescendantFonts: [descendant],
    }),
  );
  page.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { SyntheticCJK: font } }));
  page.node.set(
    PDFName.of("Contents"),
    pdf.context.register(
      pdf.context.stream("BT /SyntheticCJK 20 Tf 28 180 Td <82B182F182C982BF82CD> Tj ET"),
    ),
  );
  return pdf.save({ useObjectStreams: false });
}

export async function syntheticLargeMediaBoxPdf() {
  const pdf = await document("Synthetic local review: large valid MediaBox");
  const page = pdf.addPage([14400, 14400]);
  page.drawText("Synthetic large-page review", { x: 1000, y: 13000, size: 288 });
  page.drawText("14400 x 14400 point MediaBox; preview must scale safely.", {
    x: 1000,
    y: 12400,
    size: 180,
  });
  return pdf.save({ useObjectStreams: false });
}
export async function syntheticPageLimitPdf() {
  const pdf = await document("Synthetic local review: 101-page limit");
  for (let number = 1; number <= 101; number++) {
    const page = pdf.addPage([400, 280]);
    if (number === 1) page.drawText("Synthetic 101-page limit sample", { x: 28, y: 224, size: 16 });
  }
  return pdf.save({ useObjectStreams: false });
}
export const PDF_RESOURCE_REVIEW_SAMPLES = Object.freeze({
  "large-mediabox": Object.freeze({
    name: "synthetic-large-mediabox.pdf",
    create: syntheticLargeMediaBoxPdf,
  }),
  "page-limit": Object.freeze({
    name: "synthetic-101-page-limit.pdf",
    create: syntheticPageLimitPdf,
  }),
  "unsupported-cmap": Object.freeze({
    name: "synthetic-unsupported-cmap.pdf",
    create: syntheticCmapDependentPdf,
  }),
});
