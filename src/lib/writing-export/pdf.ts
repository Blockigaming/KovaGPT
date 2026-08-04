import { parseDocumentBlocks, safeDocumentFilename, downloadBytes } from "./common";
const ascii = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[()\\]/g, "\\$&");
export async function createDocumentPdf(title: string, markdown: string) {
  const lines = [
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
  let content = "BT /F1 11 Tf 50 790 Td 14 TL ";
  for (const line of lines) content += `(${ascii(line)}) Tj T* `;
  content += "ET";
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
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
