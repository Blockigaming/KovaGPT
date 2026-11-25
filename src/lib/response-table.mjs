/** Plain-text cell values of a Markdown table's hast node, for sorting, filtering and export. */
export function tableModelFromHast(node) {
  const text = (value) =>
    value.type === "text"
      ? value.value
      : value.type === "element"
        ? value.children.map(text).join("")
        : "";
  const rows = [];
  const visit = (value) => {
    if (value.type !== "element") return;
    if (value.tagName === "tr")
      rows.push(
        value.children
          .filter(
            (cell) => cell.type === "element" && (cell.tagName === "td" || cell.tagName === "th"),
          )
          .map((cell) => text(cell).trim()),
      );
    else value.children.forEach(visit);
  };
  visit(node);
  const [header = [], ...body] = rows;
  return { header, rows: body };
}

const NUMBER = /^[-+]?[$€£¥]?\s*[-+]?\d[\d,]*(?:\.\d+)?\s*(?:%|[kKmMbB])?$/u;
function numeric(value) {
  const trimmed = value.trim();
  if (!NUMBER.test(trimmed)) return null;
  const negative = /^-|^[$€£¥]\s*-|^\+?[$€£¥]?-/.test(trimmed);
  const digits = trimmed.replace(/[^\d.]/g, "");
  const scale = /[kK]$/.test(trimmed)
    ? 1e3
    : /[mM]$/.test(trimmed)
      ? 1e6
      : /[bB]$/.test(trimmed)
        ? 1e9
        : 1;
  const number = Number(digits) * scale;
  return Number.isFinite(number) ? (negative ? -number : number) : null;
}

/** Numbers (with currency, commas, %, k/m/b) sort numerically; everything else naturally. */
export function compareCells(a = "", b = "", locale = undefined) {
  const x = numeric(a);
  const y = numeric(b);
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return a.localeCompare(b, locale, { numeric: true, sensitivity: "base" });
}

/** CSV (RFC 4180 quoting) or TSV text; formula-leading cells are neutralised for spreadsheets. */
export function rowsToDelimited(rows, delimiter = ",") {
  return rows
    .map((row) =>
      row
        .map((raw) => {
          let cell = String(raw ?? "");
          if (/^[=+\-@\t\r]/.test(cell) && numeric(cell) === null) cell = `'${cell}`;
          if (delimiter === "\t") return cell.replace(/[\t\r\n]+/g, " ");
          return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
        })
        .join(delimiter),
    )
    .join(delimiter === "," ? "\r\n" : "\n");
}
