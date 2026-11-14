import { responseFences } from "../lib/response-fences.mjs";

export const CHART_TYPES = [
  "bar",
  "line",
  "pie",
  "donut",
  "scatter",
  "horizontal-bar",
  "stacked-bar",
  "step",
  "area",
  "stacked-area",
  "heatmap",
  "radar",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export type ChartSpec = {
  type: ChartType;
  title?: string;
  xKey?: string;
  keys?: string[];
  colors?: string[];
  data: Array<Record<string, string | number>>;
};

export function parseChartSpec(raw: string): ChartSpec | null {
  if (raw.length > 64_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const object = value as Partial<ChartSpec>;
    if (
      !CHART_TYPES.includes(object.type as ChartType) ||
      !Array.isArray(object.data) ||
      object.data.length === 0 ||
      object.data.length > 500 ||
      (object.title !== undefined && typeof object.title !== "string") ||
      (object.xKey !== undefined && typeof object.xKey !== "string") ||
      (object.keys !== undefined &&
        (!Array.isArray(object.keys) ||
          object.keys.length > 24 ||
          new Set(object.keys).size !== object.keys.length ||
          object.keys.some((key) => typeof key !== "string" || !key.trim() || key.length > 120))) ||
      (object.colors !== undefined &&
        (!Array.isArray(object.colors) ||
          object.colors.some(
            (color) =>
              typeof color !== "string" ||
              !/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color),
          ))) ||
      object.data.some(
        (row) =>
          !row ||
          typeof row !== "object" ||
          Array.isArray(row) ||
          Object.keys(row).length > 25 ||
          Object.values(row).some((cell) => typeof cell !== "string" && !Number.isFinite(cell)),
      )
    )
      return null;
    return object as ChartSpec;
  } catch {
    return null;
  }
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function chartToCsv(spec: ChartSpec) {
  const columns = [...new Set(spec.data.flatMap((row) => Object.keys(row)))];
  return [
    columns.join(","),
    ...spec.data.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(",")),
  ].join("\n");
}

export function extractCharts(
  content: string,
): Array<{ kind: "text"; value: string } | { kind: "chart"; spec: ChartSpec }> {
  if (!content.includes("kova-chart") || content.length > 128 * 1024)
    return [{ kind: "text", value: content }];
  const parts: Array<{ kind: "text"; value: string } | { kind: "chart"; spec: ChartSpec }> = [];
  let lastIndex = 0;
  let count = 0;
  for (const { info, start, body, end } of responseFences(content)) {
    if (count === 8) break;
    if (info !== "kova-chart" || body.length > 64_000) continue;
    const spec = parseChartSpec(body);
    if (!spec) continue;
    if (start > lastIndex) parts.push({ kind: "text", value: content.slice(lastIndex, start) });
    parts.push({ kind: "chart", spec });
    lastIndex = end;
    count += 1;
  }
  if (lastIndex < content.length) parts.push({ kind: "text", value: content.slice(lastIndex) });
  if (!parts.length) parts.push({ kind: "text", value: content });
  return parts;
}
