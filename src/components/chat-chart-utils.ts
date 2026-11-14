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
  "candlestick",
  "histogram",
  "percent-stacked-bar",
  "funnel",
  "bubble",
  "treemap",
  "sankey",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export type ChartSpec = {
  type: ChartType;
  title?: string;
  xKey?: string;
  keys?: string[];
  sizeKey?: string;
  colors?: string[];
  data: Array<Record<string, string | number>>;
};

export function candlestickRows(spec: ChartSpec) {
  const labelKey = spec.xKey ?? "name";
  const rows = spec.data.map((row, index) => {
    const { open, high, low, close } = row;
    if (
      typeof open !== "number" ||
      typeof high !== "number" ||
      typeof low !== "number" ||
      typeof close !== "number" ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    )
      return null;
    return { label: String(row[labelKey] ?? index + 1), open, high, low, close };
  });
  return rows.length && rows.length <= 100 && rows.every((row) => row !== null) ? rows : null;
}

export function histogramRows(spec: ChartSpec, key: string) {
  const values = spec.data
    .map((row) => row[key])
    .filter((value): value is number => typeof value === "number");
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const count = min === max ? 1 : Math.min(16, Math.ceil(Math.sqrt(values.length)));
  const bins = Array.from({ length: count }, (_, index) => ({
    range: `Bin ${index + 1}`,
    lower: min * (1 - index / count) + max * (index / count),
    upper: min * (1 - (index + 1) / count) + max * ((index + 1) / count),
    count: 0,
  }));
  const scale = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const start = min / scale;
  const span = max / scale - start;
  for (const value of values) {
    const bin =
      span === 0
        ? 0
        : Math.max(0, Math.min(count - 1, Math.floor(((value / scale - start) / span) * count)));
    bins[bin].count += 1;
  }
  return bins;
}

export function sankeyData(spec: ChartSpec) {
  if (!spec.data.length || spec.data.length > 80) return null;
  const nodes: { name: string }[] = [];
  const names = new Map<string, number>();
  const links: { source: number; target: number; value: number }[] = [];
  const outbound = new Map<number, number[]>();
  const indegrees: number[] = [];
  const nodeId = (name: string) => {
    const existing = names.get(name);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push({ name });
    names.set(name, index);
    indegrees.push(0);
    return index;
  };
  const edges = new Set<string>();
  for (const row of spec.data) {
    if (
      typeof row.source !== "string" ||
      typeof row.target !== "string" ||
      typeof row.value !== "number" ||
      row.value <= 0 ||
      row.value > 1e12
    )
      return null;
    const from = row.source.trim();
    const to = row.target.trim();
    if (!from || !to || from === to || from.length > 80 || to.length > 80) return null;
    const source = nodeId(from);
    const target = nodeId(to);
    const edge = source + ":" + target;
    if (nodes.length > 32 || edges.has(edge)) return null;
    edges.add(edge);
    links.push({ source, target, value: row.value });
    const children = outbound.get(source) ?? [];
    children.push(target);
    outbound.set(source, children);
    indegrees[target]++;
  }
  const queue = indegrees.flatMap((degree, index) => (degree === 0 ? [index] : []));
  for (let visit = 0; visit < queue.length; visit++) {
    for (const neighbor of outbound.get(queue[visit]) ?? []) {
      indegrees[neighbor]--;
      if (indegrees[neighbor] === 0) queue.push(neighbor);
    }
  }
  return queue.length === nodes.length ? { nodes, links } : null;
}

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
      (object.sizeKey !== undefined &&
        (typeof object.sizeKey !== "string" ||
          !object.sizeKey.trim() ||
          object.sizeKey.length > 120)) ||
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
    const spec = object as ChartSpec;
    if (spec.type === "candlestick" && !candlestickRows(spec)) return null;
    if (spec.type === "sankey" && !sankeyData(spec)) return null;
    return spec;
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
