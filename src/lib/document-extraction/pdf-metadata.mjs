// Parser-owned page boundaries. Document text is never parsed to infer pages.
export const PDF_MAX_PAGES = 100;
const MAX_CHARS = 80_000;
const MAX_BYTES = 200_000;
export const boundedPdfText = (text) =>
  typeof text === "string" &&
  text.length <= MAX_CHARS &&
  new TextEncoder().encode(text).length <= MAX_BYTES;

export function pdfPageSection(page) {
  return `[Page ${page.pageNumber}]\n${
    page.status === "extracted"
      ? page.text
      : page.status === "no_text"
        ? "[No extractable text on this page]"
        : "[Text extraction failed for this page]"
  }`;
}

export function pdfDocumentText(pdf) {
  return pdf.pages.map(pdfPageSection).join("\n\n");
}

export function validatePdfMetadata(value) {
  if (
    !value ||
    !Number.isInteger(value.pageCount) ||
    value.pageCount < 1 ||
    value.pageCount > PDF_MAX_PAGES ||
    !Array.isArray(value.pages) ||
    value.pages.length !== value.pageCount
  )
    return undefined;
  const pages = [];
  let totalChars = 0;
  for (let index = 0; index < value.pages.length; index++) {
    const page = value.pages[index];
    if (!page || page.pageNumber !== index + 1) return undefined;
    if (page.status === "extracted") {
      if (!boundedPdfText(page.text) || !page.text.trim()) return undefined;
      totalChars += page.text.length;
      if (totalChars > MAX_CHARS) return undefined;
      pages.push({ pageNumber: index + 1, status: "extracted", text: page.text });
    } else if (page.status === "no_text" || page.status === "failed") {
      if (page.text !== undefined) return undefined;
      pages.push({ pageNumber: index + 1, status: page.status });
    } else return undefined;
  }
  const pdf = { pageCount: value.pageCount, pages };
  return boundedPdfText(pdfDocumentText(pdf)) ? pdf : undefined;
}

export function validateDocumentExtractionResult(value, requirePdf = false) {
  if (
    !value ||
    !boundedPdfText(value.text) ||
    !value.text.trim() ||
    typeof value.note !== "string" ||
    value.note.length > 2_000
  )
    return undefined;
  if (value.pdf !== undefined || requirePdf) {
    const pdf = validatePdfMetadata(value.pdf);
    if (
      !pdf ||
      !pdf.pages.some((page) => page.status === "extracted") ||
      pdfDocumentText(pdf) !== value.text
    )
      return undefined;
    return { text: value.text, note: value.note, pdf };
  }
  return { text: value.text, note: value.note };
}

export class PdfTextUnavailableError extends Error {
  constructor(message, pdf) {
    super(message);
    this.name = "PdfTextUnavailableError";
    this.pdf = pdf;
  }
}

export function formatPdfPageNumbers(numbers) {
  const values = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges = [];
  for (let index = 0; index < values.length; index++) {
    const start = values[index];
    let end = start;
    while (values[index + 1] === end + 1) end = values[++index];
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return ranges.join(", ");
}

export function selectPdfPages(value, input) {
  const pdf = validatePdfMetadata(value);
  if (!pdf) throw new Error("PDF page information is unavailable. Attach the PDF again.");
  if (typeof input !== "string" || input.length > 400 || !input.trim())
    throw new Error("Enter available text pages, for example 1-3, 5.");
  const selected = new Set();
  for (const part of input.split(",")) {
    const match = /^\s*([1-9]\d{0,2})(?:\s*-\s*([1-9]\d{0,2}))?\s*$/u.exec(part);
    if (!match) throw new Error("Use page numbers or ranges, for example 1-3, 5.");
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    if (start > end || end > pdf.pageCount)
      throw new Error(`Choose pages between 1 and ${pdf.pageCount}, in ascending ranges.`);
    for (let number = start; number <= end; number++) selected.add(number);
  }
  const pageNumbers = [...selected].sort((a, b) => a - b);
  const unavailable = pageNumbers.filter((number) => pdf.pages[number - 1].status !== "extracted");
  if (unavailable.length)
    throw new Error(
      `No available extracted text for pages ${formatPdfPageNumbers(unavailable)}. Choose only available text pages.`,
    );
  const scope = `Selected PDF extracted text: pages ${formatPdfPageNumbers(pageNumbers)} of ${pdf.pageCount}. Other pages are not included.`;
  const text = `${scope}\n\n${pageNumbers.map((number) => pdfPageSection(pdf.pages[number - 1])).join("\n\n")}`;
  if (!boundedPdfText(text))
    throw new Error(
      "This selection exceeds the text limit including its page labels. Choose fewer pages or restore the full extraction.",
    );
  return { pageNumbers, text };
}
