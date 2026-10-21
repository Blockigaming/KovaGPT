import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { load } from "../helpers/document-writers.mjs";
import * as metadata from "../../src/lib/document-extraction/pdf-metadata.mjs";
const { extractPdfDocument } = load("src/lib/document-extraction/pdf.ts");
const bytes = new TextEncoder().encode("%PDF-fixture");
const extracted = (pageNumber, text) => ({ pageNumber, status: "extracted", text });
const sample = {
  pageCount: 4,
  pages: [
    extracted(1, "Keep [Page 99]\nmarker-like document text"),
    { pageNumber: 2, status: "no_text" },
    { pageNumber: 3, status: "failed" },
    extracted(4, "Last page"),
  ],
};

function parserFixture(pages, { count = pages.length } = {}) {
  const calls = { read: [], cancel: [], cleanup: [], destroy: 0 };
  return {
    calls,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: count,
        getPage: async (number) => {
          calls.read.push(number);
          const value = pages[number - 1];
          if (value?.getPageError) throw new Error("Private parser details");
          return {
            streamTextContent: () => ({
              getReader: () => {
                let index = 0;
                return {
                  read: async () => {
                    if (value?.streamError && index > 0)
                      throw new Error("Private partial-page details");
                    if (index++ > 0) return { done: true };
                    return {
                      done: false,
                      value: { items: value?.items ?? [{ str: value?.text ?? "", hasEOL: true }] },
                    };
                  },
                  cancel: async () => {
                    calls.cancel.push(number);
                  },
                };
              },
            }),
            cleanup: () => calls.cleanup.push(number),
          };
        },
      }),
      destroy: async () => {
        calls.destroy++;
      },
    }),
  };
}

test("real local PDF parser reports authoritative count, text sections and empty pages", async () => {
  const file = await PDFDocument.create();
  const font = await file.embedFont(StandardFonts.Helvetica);
  file.addPage().drawText("One [Page 99] is document text", { x: 20, y: 100, font });
  file.addPage();
  file.addPage().drawText("Three", { x: 20, y: 100, font });
  const result = await extractPdfDocument(await file.save(), getDocument);
  assert.equal(result.pdf.pageCount, 3);
  assert.deepEqual(
    result.pdf.pages.map((page) => page.status),
    ["extracted", "no_text", "extracted"],
  );
  assert.match(result.pdf.pages[0].text, /\[Page 99\]/);
  assert.equal(metadata.validateDocumentExtractionResult(result, true).pdf.pageCount, 3);
});

test("actual getPage and streamed page errors retain bounded successful pages without private errors or partial page text", async () => {
  const fixture = parserFixture([
    { text: "One" },
    { getPageError: true },
    { text: "discard private partial", streamError: true },
    { text: "" },
    { text: "Five" },
  ]);
  const result = await extractPdfDocument(bytes, fixture.getDocument);
  assert.deepEqual(
    result.pdf.pages.map((page) => page.status),
    ["extracted", "failed", "failed", "no_text", "extracted"],
  );
  assert.doesNotMatch(result.text, /private|Private|discard/);
  assert.match(result.text, /\[Page 2\]\n\[Text extraction failed/);
  assert.deepEqual(fixture.calls.read, [1, 2, 3, 4, 5]);
  assert.deepEqual(fixture.calls.cancel, [1, 3, 4, 5]);
  assert.deepEqual(fixture.calls.cleanup, [1, 3, 4, 5]);
  assert.equal(fixture.calls.destroy, 1);
});

test("no-text PDFs remain unsendable with true empty observations, distinct from failed pages", async () => {
  for (const [pages, statuses, message] of [
    [[{}, {}], ["no_text", "no_text"], /blank or scanned/],
    [[{ getPageError: true }, {}], ["failed", "no_text"], /page reads failed/],
  ]) {
    const fixture = parserFixture(pages);
    await assert.rejects(extractPdfDocument(bytes, fixture.getDocument), (error) => {
      assert.match(error.message, message);
      assert.deepEqual(
        error.pdf.pages.map((page) => page.status),
        statuses,
      );
      assert.ok(metadata.validatePdfMetadata(error.pdf));
      return true;
    });
    assert.equal(fixture.calls.destroy, 1);
  }
});

test("10 MB, 100-page, character, UTF-8 and element budgets remain hard document errors", async () => {
  let started = false;
  await assert.rejects(
    extractPdfDocument(new Uint8Array(10 * 1024 * 1024 + 1), () => {
      started = true;
    }),
    /10 MB/,
  );
  assert.equal(started, false);
  const hundred = parserFixture(Array.from({ length: 100 }, () => ({ text: "Text" })));
  assert.equal((await extractPdfDocument(bytes, hundred.getDocument)).pdf.pageCount, 100);
  for (const [fixture, message] of [
    [parserFixture([], { count: 101 }), /100 pages/],
    [parserFixture([], { count: 0 }), /100 pages/],
    [parserFixture([{ text: "x".repeat(80_001) }]), /80,000/],
    [parserFixture([{ text: "中".repeat(70_000) }]), /200 KB/],
    [
      parserFixture([{ items: Array.from({ length: 50_001 }, () => ({ str: "" })) }]),
      /too many text elements/,
    ],
  ]) {
    await assert.rejects(extractPdfDocument(bytes, fixture.getDocument), message);
    assert.equal(fixture.calls.destroy, 1);
  }
});

test("password-protected document failures retain the explicit unlocked-copy message and destroy parser", async () => {
  let destroyed = false;
  const error = Object.assign(new Error("secret"), { name: "PasswordException" });
  await assert.rejects(
    extractPdfDocument(bytes, () => ({
      promise: Promise.reject(error),
      destroy: async () => {
        destroyed = true;
      },
    })),
    /password protected.*unlocked copy/,
  );
  assert.equal(destroyed, true);
});

test("result validation rejects invented, unbounded, reordered or inconsistent page data", () => {
  const result = { text: metadata.pdfDocumentText(sample), note: "PDF extraction", pdf: sample };
  assert.deepEqual(metadata.validateDocumentExtractionResult(result, true), result);
  for (const invalid of [
    undefined,
    { pageCount: 101, pages: [] },
    { ...sample, pageCount: 3 },
    { ...sample, pages: sample.pages.toReversed() },
    { pageCount: 1, pages: [{ pageNumber: 1, status: "scanned" }] },
    { pageCount: 1, pages: [{ pageNumber: 1, status: "no_text", text: "invented" }] },
    { pageCount: 1, pages: [extracted(1, "")] },
    { pageCount: 1, pages: [extracted(1, "x".repeat(80_001))] },
    { pageCount: 1, pages: [extracted(1, "中".repeat(70_000))] },
  ])
    assert.equal(metadata.validatePdfMetadata(invalid), undefined);
  for (const invalid of [
    { ...result, text: "different" },
    { ...result, note: "x".repeat(2001) },
    { text: "[Page 1]\nFake", note: "No metadata" },
    {
      text: "[Page 1]\n[No extractable text on this page]",
      note: "Empty",
      pdf: { pageCount: 1, pages: [{ pageNumber: 1, status: "no_text" }] },
    },
  ])
    assert.equal(metadata.validateDocumentExtractionResult(invalid, true), undefined);
  assert.deepEqual(metadata.validateDocumentExtractionResult({ text: "Office", note: "Text" }), {
    text: "Office",
    note: "Text",
  });
});

test("page ranges use parser-owned sections, include explicit submission scope and preserve the full source for restore", () => {
  const before = structuredClone(sample);
  const selection = metadata.selectPdfPages(sample, "4, 1, 4");
  assert.deepEqual(selection.pageNumbers, [1, 4]);
  assert.match(
    selection.text,
    /^Selected PDF extracted text: pages 1, 4 of 4\. Other pages are not included\./,
  );
  assert.match(selection.text, /Keep \[Page 99\]/);
  assert.doesNotMatch(selection.text, /\[Page [23]\]/);
  assert.deepEqual(sample, before);
  assert.match(metadata.pdfDocumentText(sample), /\[Page 2\]/);
  assert.equal(metadata.formatPdfPageNumbers([5, 1, 3, 2, 2]), "1-3, 5");
  for (const value of [
    "",
    "0",
    "5",
    "4-1",
    "-1",
    "1.5",
    "1,,4",
    "1-999",
    "1;4",
    "1-2",
    "3",
    "x".repeat(401),
  ])
    assert.throws(() => metadata.selectPdfPages(sample, value));
  const closeToLimit = { pageCount: 1, pages: [extracted(1, "x".repeat(79_990))] };
  assert.ok(metadata.validatePdfMetadata(closeToLimit));
  assert.throws(() => metadata.selectPdfPages(closeToLimit, "1"), /including its page labels/);
});
