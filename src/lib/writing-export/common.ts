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
};
export function parseDocumentBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let code: string[] | null = null;
  for (const line of lines) {
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
      blocks.push({ kind: "list", text: line.replace(/^(?:[-*+]|\d+[.)])\s+/, "") });
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({ kind: "quote", text: line.slice(2) });
      continue;
    }
    if (line.includes("|") && line.trim().startsWith("|")) {
      const rows = [
        line
          .split("|")
          .slice(1, -1)
          .map((x) => x.trim()),
      ];
      blocks.push({ kind: "table", text: line, rows });
      continue;
    }
    if (line.trim()) blocks.push({ kind: "paragraph", text: line });
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks;
}
export function downloadBytes(bytes: Uint8Array, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
