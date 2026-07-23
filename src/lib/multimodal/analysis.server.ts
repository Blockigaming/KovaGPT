import { createToolActivityEvent, type ToolActivityEvent } from "@/lib/ai/activity.server";
export type AnalysisJobStatus =
  "queued" | "preparing" | "running" | "rendering" | "complete" | "failed" | "canceled";
export type ColumnKind = "number" | "date" | "boolean" | "text" | "empty";
export type AnalysisTable = {
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  caption: string;
};
export type ChartType = "bar" | "line" | "area" | "scatter" | "pie" | "histogram" | "table" | "kpi";
export type ChartSpec = {
  type: ChartType;
  title: string;
  data: Array<Record<string, string | number | boolean | null>>;
  xField?: string;
  yFields?: string[];
  seriesField?: string;
  labels?: Record<string, string>;
  units?: Record<string, string>;
  sourceFileId: string;
  filters?: string[];
  notes: string[];
  accessibilityDescription: string;
};
export type AnalysisArtifact = {
  kind: "csv" | "json" | "markdown" | "chart" | "summary";
  title: string;
  mimeType: string;
  content: string;
};
export type AnalysisJob = {
  id: string;
  userId: string;
  sourceFileIds: string[];
  prompt: string;
  status: AnalysisJobStatus;
  events: ToolActivityEvent[];
  summary?: string;
  tables: AnalysisTable[];
  charts: ChartSpec[];
  artifacts: AnalysisArtifact[];
  userLogs: string[];
  internalLogRef?: string;
};
export function parseCsv(text: string, maxRows = 5000): AnalysisTable {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, maxRows + 1);
  const headers = splitCsvLine(lines[0] ?? "").map((h, i) => h || `Column ${i + 1}`);
  const rows = lines
    .slice(1)
    .map((line) =>
      Object.fromEntries(
        splitCsvLine(line).map((value, i) => [headers[i] ?? `Column ${i + 1}`, value]),
      ),
    );
  return {
    title: "CSV preview",
    columns: headers,
    rows,
    caption: `${rows.length} rows loaded from CSV.`,
  };
}
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
export function inferColumnKinds(table: AnalysisTable): Record<string, ColumnKind> {
  const result: Record<string, ColumnKind> = {};
  for (const column of table.columns) {
    const values = table.rows
      .map((row) => row[column])
      .filter((value) => value !== "" && value != null);
    if (!values.length) result[column] = "empty";
    else if (values.every((value) => !Number.isNaN(Number(value)))) result[column] = "number";
    else if (values.every((value) => !Number.isNaN(Date.parse(String(value)))))
      result[column] = "date";
    else if (values.every((value) => /^(true|false|yes|no)$/i.test(String(value))))
      result[column] = "boolean";
    else result[column] = "text";
  }
  return result;
}
export function profileDataset(table: AnalysisTable) {
  const kinds = inferColumnKinds(table);
  const missing = Object.fromEntries(
    table.columns.map((column) => [
      column,
      table.rows.filter((row) => row[column] === "" || row[column] == null).length,
    ]),
  );
  const duplicateRows =
    table.rows.length - new Set(table.rows.map((row) => JSON.stringify(row))).size;
  return {
    rowCount: table.rows.length,
    columnCount: table.columns.length,
    kinds,
    missing,
    duplicateRows,
  };
}
export function groupByCount(table: AnalysisTable, column: string): AnalysisTable {
  const counts = new Map<string, number>();
  for (const row of table.rows)
    counts.set(
      String(row[column] ?? "(missing)"),
      (counts.get(String(row[column] ?? "(missing)")) ?? 0) + 1,
    );
  return {
    title: `Count by ${column}`,
    columns: [column, "count"],
    rows: [...counts.entries()].map(([key, count]) => ({ [column]: key, count })),
    caption: `Grouped ${table.rows.length} rows by ${column}.`,
  };
}
export function chartFromTable(
  table: AnalysisTable,
  sourceFileId: string,
  xField: string,
  yField: string,
): ChartSpec {
  return {
    type: "bar",
    title: `${yField} by ${xField}`,
    data: table.rows.slice(0, 200),
    xField,
    yFields: [yField],
    sourceFileId,
    notes: ["Large datasets are sampled to the first 200 rows for rendering."],
    accessibilityDescription: `Bar chart showing ${yField} by ${xField}.`,
  };
}
export function createAnalysisJob(
  userId: string,
  sourceFileIds: string[],
  prompt: string,
): AnalysisJob {
  return {
    id: `analysis-${crypto.randomUUID()}`,
    userId,
    sourceFileIds,
    prompt: prompt.slice(0, 2000),
    status: "queued",
    events: [createToolActivityEvent("data_analysis", "Queued analysis job", "pending")],
    tables: [],
    charts: [],
    artifacts: [],
    userLogs: [
      "Arbitrary Python execution is unavailable; using deterministic built-in analysis operations.",
    ],
  };
}
