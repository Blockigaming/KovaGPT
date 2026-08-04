export const PREVIEW_LIMITS = {
  bytes: 5_000_000,
  csvRows: 2000,
  csvColumns: 200,
  cellChars: 10_000,
  jsonNodes: 20_000,
};
export function sanitizeMarkup(value) {
  return String(value)
    .replace(/<\s*(script|object|embed|iframe|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|object|embed|iframe|style)[^>]*\/?\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])\s*(javascript:|data:text\/html)[\s\S]*?\2/gi, ' $1="#"');
}
export function parseCsv(text, limits = PREVIEW_LIMITS) {
  const sample = String(text).slice(0, 10000),
    candidates = [",", "\t", ";", "|"];
  const score = (delimiter) => {
    let count = 0,
      quoted = false;
    for (const char of sample) {
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count++;
    }
    return count;
  };
  const delimiter = candidates.sort((a, b) => score(b) - score(a))[0];
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    malformed = 0;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i] ?? "\n";
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.slice(0, limits.cellChars));
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.slice(0, limits.cellChars));
      if (row.some(Boolean)) rows.push(row.slice(0, limits.csvColumns));
      row = [];
      cell = "";
      if (rows.length > limits.csvRows) break;
    } else cell += char;
  }
  if (quoted) malformed++;
  const headers = rows.shift() ?? [];
  malformed += rows.filter((item) => item.length !== headers.length).length;
  return {
    delimiter,
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
    malformed,
    truncated: rows.length >= limits.csvRows,
  };
}
export function textDiff(before, after, ignoreWhitespace = false) {
  const normalize = (value) => (ignoreWhitespace ? value.trim().replace(/\s+/g, " ") : value);
  const left = String(before).split("\n"),
    right = String(after).split("\n"),
    max = Math.max(left.length, right.length),
    lines = [];
  let added = 0,
    removed = 0,
    modified = 0;
  for (let i = 0; i < max; i++) {
    const a = left[i],
      b = right[i];
    if (a === undefined) {
      added++;
      lines.push({ kind: "added", after: b, line: i + 1 });
    } else if (b === undefined) {
      removed++;
      lines.push({ kind: "removed", before: a, line: i + 1 });
    } else if (normalize(a) !== normalize(b)) {
      modified++;
      lines.push({ kind: "changed", before: a, after: b, line: i + 1 });
    } else lines.push({ kind: "same", before: a, after: b, line: i + 1 });
  }
  return { lines, added, removed, modified };
}
export function jsonDiff(before, after, path = "$") {
  const changes = [];
  if (Object.is(before, after)) return changes;
  if (typeof before !== typeof after || before === null || after === null) {
    changes.push({ path, kind: "type_or_value", before, after });
    return changes;
  }
  if (typeof before !== "object") {
    changes.push({ path, kind: "changed", before, after });
    return changes;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const next = `${path}${Array.isArray(after) ? `[${key}]` : `.${key}`}`;
    if (!(key in before)) changes.push({ path: next, kind: "added", after: after[key] });
    else if (!(key in after)) changes.push({ path: next, kind: "removed", before: before[key] });
    else changes.push(...jsonDiff(before[key], after[key], next));
  }
  return changes;
}
export function csvDiff(before, after, keyColumn) {
  const a = parseCsv(before),
    b = parseCsv(after),
    addedColumns = b.headers.filter((x) => !a.headers.includes(x)),
    removedColumns = a.headers.filter((x) => !b.headers.includes(x));
  const keyIndexA = keyColumn ? a.headers.indexOf(keyColumn) : -1,
    keyIndexB = keyColumn ? b.headers.indexOf(keyColumn) : -1;
  const key = (row, index, which) => (which >= 0 ? row[which] : String(index));
  const mapA = new Map(a.rows.map((row, index) => [key(row, index, keyIndexA), row])),
    mapB = new Map(b.rows.map((row, index) => [key(row, index, keyIndexB), row]));
  let addedRows = 0,
    removedRows = 0,
    changedCells = 0;
  for (const [id, row] of mapB) {
    if (!mapA.has(id)) addedRows++;
    else
      row.forEach((cell, index) => {
        if (cell !== mapA.get(id)?.[index]) changedCells++;
      });
  }
  for (const id of mapA.keys()) if (!mapB.has(id)) removedRows++;
  return {
    addedColumns,
    removedColumns,
    addedRows,
    removedRows,
    changedCells,
    keyColumn: keyColumn ?? null,
  };
}
