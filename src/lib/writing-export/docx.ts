import { parseDocumentBlocks, safeDocumentFilename, downloadBytes } from "./common";
const enc = new TextEncoder();
function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function u16(n: number) {
  return [n & 255, (n >>> 8) & 255];
}
function u32(n: number) {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}
function zip(files: Record<string, string>) {
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name),
      d = enc.encode(text),
      crc = crc32(d);
    const local = [
      ...u32(0x04034b50),
      ...u16(20),
      0,
      0,
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(d.length),
      ...u32(d.length),
      ...u16(n.length),
      0,
      0,
      ...n,
      ...d,
    ];
    chunks.push(...local);
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      0,
      0,
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(d.length),
      ...u32(d.length),
      ...u16(n.length),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...u32(offset),
      ...n,
    );
    offset += local.length;
  }
  const start = chunks.length;
  chunks.push(
    ...central,
    ...u32(0x06054b50),
    0,
    0,
    0,
    0,
    ...u16(Object.keys(files).length),
    ...u16(Object.keys(files).length),
    ...u32(central.length),
    ...u32(start),
    0,
    0,
  );
  return new Uint8Array(chunks);
}
const xml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export async function createDocumentDocx(title: string, markdown: string) {
  const paras = [
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${xml(title)}</w:t></w:r></w:p>`,
    ...parseDocumentBlocks(markdown).map(
      (b) =>
        `<w:p>${b.kind === "heading" ? `<w:pPr><w:pStyle w:val="Heading${Math.min(b.level ?? 1, 3)}"/></w:pPr>` : ""}<w:r>${b.kind === "code" ? '<w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr>' : ""}<w:t xml:space="preserve">${xml((b.kind === "list" ? "• " : b.kind === "quote" ? "> " : "") + b.text)}</w:t></w:r></w:p>`,
    ),
  ].join("");
  return zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr/></w:body></w:document>`,
  });
}
export async function exportDocumentDocx(title: string, markdown: string) {
  const bytes = await createDocumentDocx(title, markdown);
  downloadBytes(
    bytes,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    safeDocumentFilename(title, "docx"),
  );
  return bytes;
}
