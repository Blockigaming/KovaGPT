import { parseDocumentBlocks, safeDocumentFilename, downloadBytes } from "./common";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const TOP_MARGIN = 790;
const LINES_PER_PAGE = 52;

const ascii = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[()\\]/g, "\\$&");

function buildLines(title: string, markdown: string) {
  return [
    title,
    "",
    ...parseDocumentBlocks(markdown).flatMap((b) => {
      const prefix =
        b.kind === "heading" ? "# " : b.kind === "list" ? "- " : b.kind === "quote" ? "> " : "";
      const text = prefix + b.text;
      const out: string[] = [];
      for (let i = 0; i < text.length; i += 85) out.push(text.slice(i, i + 85));
      return [...out, ""];
    }),
  ].slice(0, 3000);
}

function pageStream(lines: string[]) {
  let content = `BT /F1 11 Tf 50 ${TOP_MARGIN} Td 14 TL `;
  for (const line of lines) content += `(${ascii(line)}) Tj T* `;
  return `${content}ET`;
}

export async function createDocumentPdf(title: string, markdown: string) {
  const lines = buildLines(title, markdown);
  const pages = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
  const fontObjectId = 3 + pages * 2;
  const pageObjectIds = Array.from({ length: pages }, (_, index) => 3 + index * 2);
  const contentObjectIds = Array.from({ length: pages }, (_, index) => 4 + index * 2);
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`,
  ];

  for (let index = 0; index < pages; index++) {
    const content = pageStream(lines.slice(index * LINES_PER_PAGE, (index + 1) * LINES_PER_PAGE));
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }

  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}
export async function exportDocumentPdf(title: string, markdown: string) {
  const bytes = await createDocumentPdf(title, markdown);
  downloadBytes(bytes, "application/pdf", safeDocumentFilename(title, "pdf"));
  return bytes;
}
