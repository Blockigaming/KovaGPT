export function safeDocumentFilename(title: string, extension: string) {
  const base =
    title
      .normalize("NFKC")
      .split("")
      .filter((character) => character.codePointAt(0)! >= 32 && !'\\/:*?"<>|'.includes(character))
      .join("")
      .trim()
      .slice(0, 120) || "document";
  return `${base}.${extension}`;
}
export type Block = {
  kind: "heading" | "paragraph" | "list" | "quote" | "code" | "table";
  text: string;
  level?: number;
  rows?: string[][];
  ordered?: boolean;
  number?: number;
};
export const MAX_DOCUMENT_CHARS = 200_000;
export function validateDocumentInput(title: string, markdown: string) {
  if (
    typeof title !== "string" ||
    typeof markdown !== "string" ||
    title.length > 500 ||
    markdown.length > MAX_DOCUMENT_CHARS
  )
    throw new Error(
      "Export supports a title up to 500 characters and a document up to 200,000 characters.",
    );
  // XML 1.0/PDF content must not contain controls or unpaired surrogates.
  // eslint-disable-next-line no-control-regex -- reject XML 1.0 forbidden control characters
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff]/u.test(title + markdown))
    throw new Error(
      "The document contains invalid text. Remove control characters before exporting.",
    );
}
function tableCells(line: string) {
  const value = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return value.split(/(?<!\\)\|/u).map((cell) => cell.trim().replaceAll("\\|", "|"));
}
export function parseDocumentBlocks(markdown: string): Block[] {
  validateDocumentInput("", markdown);
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let code: string[] | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("```")) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^(\d+)[.)]\s+/.exec(line);
      if (
        ordered &&
        (!Number.isSafeInteger(Number(ordered[1])) || Number(ordered[1]) > 1_000_000_000)
      )
        throw new Error("A list number exceeds the supported range.");
      blocks.push({
        kind: "list",
        text: line.replace(/^(?:[-*+]|\d+[.)])\s+/, ""),
        ordered: Boolean(ordered),
        ...(ordered ? { number: Number(ordered[1]) } : {}),
      });
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({ kind: "quote", text: line.slice(2) });
      continue;
    }
    if (
      line.includes("|") &&
      lines[index + 1]?.includes("|") &&
      tableCells(lines[index + 1]).every((cell) => /^:?-{3,}:?$/u.test(cell))
    ) {
      const rows = [tableCells(line)];
      if (tableCells(lines[index + 1]).length !== rows[0].length)
        throw new Error("Table header and separator columns must match.");
      index += 1;
      while (lines[index + 1]?.trim() && lines[index + 1].includes("|"))
        rows.push(tableCells(lines[++index]));
      const width = rows[0].length;
      if (width > 20 || rows.length > 5000 || rows.some((row) => row.length !== width))
        throw new Error("Tables must have consistent columns, up to 20 columns and 5,000 rows.");
      blocks.push({ kind: "table", text: rows.map((row) => row.join(" | ")).join("\n"), rows });
      continue;
    }
    if (line.trim()) blocks.push({ kind: "paragraph", text: line });
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks;
}
export function downloadBytes(bytes: Uint8Array, type: string, filename: string) {
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    const completedUrl = url;
    url = null;
    window.setTimeout(() => URL.revokeObjectURL(completedUrl), 1_000);
  } finally {
    anchor?.remove();
    if (url) URL.revokeObjectURL(url);
  }
}
