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

export const OFFICE_EXPORT_NOTES = {
  docx: "DOCX supports headings, flat lists, quotes, code blocks, tables and simple inline bold, italic, code and HTTP(S) links up to 8,192 address characters. Nested Markdown, images and raw HTML are retained as text where unsupported; layout may differ from Paper.",
  pdf: "PDF supports headings, flat lists, quotes, code blocks and tables. Body text supports simple bold and HTTP(S) link labels with visible addresses. Other inline Markdown and table formatting remain literal; unsupported font characters stop export rather than disappear. Use Paper print for browser-rendered Markdown.",
  xlsx: "XLSX exports narrative text and separate table sheets. Values are text, never formulas. Markdown styling remains literal; this is not a document-layout export.",
  pptx: "PPTX exports a paginated text outline. Inline Markdown remains literal; tables become text rows. It does not preserve document layout or rich formatting.",
};
export type InlineDocumentRun = {
  text: string;
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
  link?: string;
};
/** Deliberately bounded subset. Unsupported syntax remains visible source text. */
export type InlineParseDiagnostics = { workUnits: number; urlParses: number };
export const INLINE_DOCUMENT_WORK_BOUND = 16;
export function documentInlineRuns(
  text: string,
  diagnostics?: InlineParseDiagnostics,
): InlineDocumentRun[] {
  if (typeof text !== "string" || text.length > MAX_DOCUMENT_CHARS)
    throw new Error("Inline export exceeds the document limit.");
  const stats = diagnostics ?? { workUnits: 0, urlParses: 0 };
  stats.workUnits = 0;
  stats.urlParses = 0;
  const n = text.length,
    escaped = new Uint8Array(n);
  let escape = false;
  for (let i = 0; i < n; i++) {
    stats.workUnits++;
    escaped[i] = escape ? 1 : 0;
    escape = text[i] === "\\" ? !escape : false;
  }
  // Suffix indexes avoid rescanning unmatched delimiters. Storage and scan work
  // are linear in the already bounded document size.
  const star = new Int32Array(n + 1),
    tick = new Int32Array(n + 1),
    bracket = new Int32Array(n + 1),
    paren = new Int32Array(n + 1),
    line = new Int32Array(n + 1),
    space = new Int32Array(n + 1);
  star[n] = tick[n] = bracket[n] = paren[n] = line[n] = space[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    stats.workUnits++;
    star[i] = !escaped[i] && text[i] === "*" ? i : star[i + 1];
    tick[i] = !escaped[i] && text[i] === "`" ? i : tick[i + 1];
    bracket[i] = !escaped[i] && text[i] === "]" ? i : bracket[i + 1];
    paren[i] = !escaped[i] && text[i] === ")" ? i : paren[i + 1];
    line[i] = text[i] === "\n" || text[i] === "\r" ? i : line[i + 1];
    space[i] = /\s/u.test(text[i]) ? i : space[i + 1];
  }
  const runs: InlineDocumentRun[] = [];
  let literal = 0,
    i = 0;
  const emit = (end: number, run: InlineDocumentRun) => {
    if (literal < i) {
      runs.push({ text: text.slice(literal, i) });
      stats.workUnits += i - literal;
    }
    runs.push(run);
    stats.workUnits += run.text.length;
    i = end;
    literal = end;
  };
  while (i < n) {
    stats.workUnits++;
    if (escaped[i]) {
      i++;
      continue;
    }
    if (text[i] === "*" || text[i] === "`") {
      const bold = text[i] === "*" && text[i + 1] === "*",
        width = bold ? 2 : 1,
        start = i + width;
      const end = (text[i] === "`" ? tick : star)[Math.min(start, n)];
      if (end > start && end < n && line[start] > end && (!bold || text[end + 1] === "*")) {
        emit(end + width, {
          text: text.slice(start, end),
          ...(text[i] === "`" ? { code: true } : bold ? { bold: true } : { italics: true }),
        });
        continue;
      }
    }
    if (text[i] === "[" && text[i - 1] !== "!") {
      const close = bracket[i + 1];
      if (close < n && close > i + 1 && line[i + 1] > close && text[close + 1] === "(") {
        const start = close + 2,
          end = paren[Math.min(start, n)];
        if (
          end < n &&
          end > start &&
          end - start <= 8192 &&
          space[start] > end &&
          (text.startsWith("https://", start) || text.startsWith("http://", start))
        ) {
          stats.workUnits += end - start;
          stats.urlParses++;
          try {
            const url = new URL(text.slice(start, end));
            if (url.username || url.password) throw new Error("credentials");
            stats.workUnits += url.href.length;
            emit(end + 1, { text: text.slice(i + 1, close), link: url.href });
            continue;
          } catch {
            // A failed candidate is retained literally as one span. Retrying its
            // same closing bracket from every nested '[' would be quadratic.
            i = end + 1;
            continue;
          }
        }
      }
    }
    i++;
  }
  if (literal < n) {
    runs.push({ text: text.slice(literal) });
    stats.workUnits += n - literal;
  }
  return runs;
}
