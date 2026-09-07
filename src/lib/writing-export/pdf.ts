import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import regularFontUrl from "@/assets/document-fonts/DejaVuSans.ttf?url";
import boldFontUrl from "@/assets/document-fonts/DejaVuSans-Bold.ttf?url";
import {
  parseDocumentBlocks,
  safeDocumentFilename,
  downloadBytes,
  validateDocumentInput,
} from "./common";

type FontBytes = { regular: Uint8Array; bold: Uint8Array };
async function loadFonts(): Promise<FontBytes> {
  const load = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), credentials: "omit" });
    if (!response.ok) throw new Error("PDF fonts could not be loaded. Retry or use DOCX.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 2_000_000 || bytes.byteLength < 1000)
      throw new Error("PDF font data is unavailable.");
    return bytes;
  };
  const [regular, bold] = await Promise.all([load(regularFontUrl), load(boldFontUrl)]);
  return { regular, bold };
}
export function wrapPdfText(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.replaceAll("\t", "    ").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/u).filter(Boolean)) {
      if (font.widthOfTextAtSize(line + word, size) <= width) {
        line += word;
        continue;
      }
      if (line.trim()) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (!word.trim()) continue;
      if (font.widthOfTextAtSize(word, size) <= width) {
        line = word;
        continue;
      }
      for (const point of word) {
        if (font.widthOfTextAtSize(line + point, size) > width && line) {
          lines.push(line);
          line = "";
        }
        line += point;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export async function createDocumentPdf(
  title: string,
  markdown: string,
  providedFonts?: FontBytes,
) {
  validateDocumentInput(title, markdown);
  const source = parseDocumentBlocks(markdown);
  const bytes = providedFonts ?? (await loadFonts());
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes.regular, { subset: true });
  const bold = await pdf.embedFont(bytes.bold, { subset: true });
  const boldSupported = new Set(bold.getCharacterSet());
  const supported = new Set(font.getCharacterSet().filter((point) => boldSupported.has(point)));
  const unsupported = [
    ...new Set(Array.from(title + "\n" + source.map((block) => block.text).join("\n"))),
  ].filter((point) => !/\s/u.test(point) && !supported.has(point.codePointAt(0)!));
  if (unsupported.length)
    throw new Error(
      "This PDF font cannot represent some document characters. Use DOCX to preserve them.",
    );
  pdf.setTitle(title || "Document");
  pdf.setCreator("KovaGPT");
  const width = 612,
    height = 792,
    margin = 54,
    usable = width - margin * 2;
  let page!: PDFPage,
    y = 0;
  const newPage = () => {
    if (pdf.getPageCount() >= 400)
      throw new Error("PDF export is limited to 400 pages. Split this document.");
    page = pdf.addPage([width, height]);
    y = height - margin;
  };
  const ensure = (heightNeeded: number) => {
    if (y - heightNeeded < margin) newPage();
  };
  const drawLines = (lines: string[], size: number, selected = font, indent = 0) => {
    const lineHeight = size * 1.45;
    for (const line of lines) {
      ensure(lineHeight);
      if (line)
        page.drawText(line, {
          x: margin + indent,
          y: y - size,
          font: selected,
          size,
          color: rgb(0.12, 0.14, 0.18),
        });
      y -= lineHeight;
    }
  };
  newPage();
  drawLines(wrapPdfText(title || "Document", bold, 22, usable), 22, bold);
  y -= 18;
  for (const block of source) {
    if (block.kind === "table" && block.rows?.length) {
      const cells = block.rows[0].length,
        cellWidth = usable / cells,
        size = 9,
        lineHeight = 13;
      if (cellWidth < 25) throw new Error("This table is too wide for PDF. Use DOCX or XLSX.");
      for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex++) {
        const selected = rowIndex === 0 ? bold : font;
        const wrapped = block.rows[rowIndex].map((cell) =>
          wrapPdfText(cell, selected, size, cellWidth - 10),
        );
        const lineCount = Math.max(...wrapped.map((cell) => cell.length));
        let start = 0;
        while (start < lineCount) {
          ensure(lineHeight + 10);
          const count = Math.min(lineCount - start, Math.floor((y - margin - 10) / lineHeight));
          if (count < 1) {
            newPage();
            continue;
          }
          const rowHeight = count * lineHeight + 10;
          for (let col = 0; col < cells; col++) {
            page.drawRectangle({
              x: margin + col * cellWidth,
              y: y - rowHeight,
              width: cellWidth,
              height: rowHeight,
              borderColor: rgb(0.78, 0.8, 0.83),
              borderWidth: 0.5,
              ...(rowIndex === 0 ? { color: rgb(0.93, 0.95, 0.97) } : {}),
            });
            for (let rowLine = 0; rowLine < count; rowLine++) {
              const line = wrapped[col][start + rowLine];
              if (line)
                page.drawText(line, {
                  x: margin + col * cellWidth + 5,
                  y: y - 5 - size - rowLine * lineHeight,
                  font: selected,
                  size,
                });
            }
          }
          y -= rowHeight;
          start += count;
        }
      }
      y -= 12;
      continue;
    }
    const size =
      block.kind === "heading"
        ? Math.max(12, 19 - (block.level ?? 1) * 2)
        : block.kind === "code"
          ? 9
          : 11;
    const selected = block.kind === "heading" ? bold : font;
    const indent = ["list", "quote", "code"].includes(block.kind) ? 14 : 0;
    const text =
      (block.kind === "list"
        ? block.ordered
          ? `${block.number}. `
          : "• "
        : block.kind === "quote"
          ? "“"
          : "") +
      block.text +
      (block.kind === "quote" ? "”" : "");
    ensure(size * (block.kind === "heading" ? 3.5 : 1.5));
    drawLines(wrapPdfText(text, selected, size, usable - indent), size, selected, indent);
    y -= block.kind === "heading" ? 6 : 9;
  }
  for (const [index, sheet] of pdf.getPages().entries())
    sheet.drawText(`${index + 1} / ${pdf.getPageCount()}`, {
      x: margin,
      y: 28,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  return pdf.save();
}
export async function exportDocumentPdf(title: string, markdown: string) {
  const bytes = await createDocumentPdf(title, markdown);
  downloadBytes(bytes, "application/pdf", safeDocumentFilename(title, "pdf"));
  return bytes;
}
