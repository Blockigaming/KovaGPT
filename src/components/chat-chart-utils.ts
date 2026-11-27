import { responseFences } from "../lib/response-fences.mjs";
import {
  calendarCells,
  chordLayout,
  gridFromRows,
  numbersOf,
  pathHierarchy,
} from "../lib/chart-extra-math.mjs";

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
  "waterfall",
  "range",
] as const;
/** Extended families, each with its own data shape; they render in ChatChartExtra. */
export const EXTRA_CHART_TYPES = [
  "grouped-bar",
  "diverging-bar",
  "dot",
  "lollipop",
  "strip",
  "slope",
  "bump",
  "streamgraph",
  "sparkline",
  "small-multiples",
  "polar-area",
  "connected-scatter",
  "density",
  "box",
  "violin",
  "ridgeline",
  "calendar-heatmap",
  "sunburst",
  "icicle",
  "alluvial",
  "chord",
  "timeline",
  "gantt",
  "ohlc",
  "volume",
  "error-bars",
  "confidence-band",
  "interval",
  "function",
  "contour",
  "surface",
  "mesh",
  "scatter-3d",
  "vector-field",
  "choropleth",
  "point-map",
  "route-map",
  "density-map",
  "combo",
] as const;
export type ExtraChartType = (typeof EXTRA_CHART_TYPES)[number];
export type ChartType = (typeof CHART_TYPES)[number] | ExtraChartType;
export const isExtraChartType = (type: string): type is ExtraChartType =>
  (EXTRA_CHART_TYPES as readonly string[]).includes(type);

const num = (value: unknown) => typeof value === "number" && Number.isFinite(value);

/** Does the data fit the extended type's shape? Mirrors what ChatChartExtra needs. */
export function extraChartFits(spec: ChartSpec): boolean {
  const xKey = spec.xKey ?? "name";
  const keys = spec.keys?.length
    ? spec.keys
    : [...new Set(spec.data.flatMap((row) => Object.keys(row)))].filter(
        (key) => key !== xKey && spec.data.some((row) => num(row[key])),
      );
  const rows = spec.data;
  const all = (fields: string[]) => rows.every((row) => fields.every((field) => num(row[field])));
  switch (spec.type) {
    case "strip":
    case "box":
    case "violin":
    case "density":
    case "ridgeline":
      return keys.length > 0 && keys.some((key) => numbersOf(rows, key).length >= 2);
    case "slope":
      return keys.length >= 2 && rows.every((row) => num(row[keys[0]]) && num(row[keys[1]]));
    case "connected-scatter":
    case "function":
      return rows.every((row) => num(row[xKey])) && keys.length > 0;
    case "polar-area":
      return !!keys[0] && rows.every((row) => !num(row[keys[0]]) || (row[keys[0]] as number) >= 0);
    case "calendar-heatmap":
      return !!keys[0] && !!calendarCells(rows, xKey, keys[0]);
    case "sunburst":
    case "icicle":
      return !!keys[0] && !!pathHierarchy(rows, xKey, keys[0]);
    case "alluvial":
      return !!sankeyData({ ...spec, type: "sankey" });
    case "chord":
      return !!chordLayout(rows);
    case "timeline":
      return rows.every(
        (row) => num(row.date) || /^\d{4}-\d{2}-\d{2}/.test(String(row.date ?? row.start ?? "")),
      );
    case "gantt":
      return rows.every(
        (row) =>
          (num(row.start) && num(row.end) && (row.end as number) >= (row.start as number)) ||
          (/^\d{4}-\d{2}-\d{2}/.test(String(row.start)) &&
            /^\d{4}-\d{2}-\d{2}/.test(String(row.end)) &&
            String(row.end) >= String(row.start)),
      );
    case "ohlc":
    case "volume":
      return !!candlestickRows({ ...spec, type: "candlestick" });
    case "error-bars":
      return !!keys[0] && rows.every((row) => num(row.error) || Array.isArray(row.error));
    case "confidence-band":
    case "interval":
      return rows.every(
        (row) => all(["low", "high"]) && (row.high as number) >= (row.low as number),
      );
    case "contour":
    case "surface":
    case "mesh":
      return !!gridFromRows(rows);
    case "scatter-3d":
      return all(["x", "y", "z"]);
    case "vector-field":
      return all(["x", "y", "dx", "dy"]);
    case "choropleth":
      return !!keys[0] && rows.every((row) => typeof row[xKey] === "string");
    case "point-map":
    case "route-map":
    case "density-map":
      return rows.every(
        (row) =>
          num(row.lat) &&
          num(row.lon ?? row.lng) &&
          Math.abs(row.lat as number) <= 90 &&
          Math.abs((row.lon ?? row.lng) as number) <= 180,
      );
    default:
      return keys.length > 0;
  }
}

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

export function rangeChartRows(spec: ChartSpec, key?: string) {
  const labelKey = spec.xKey ?? "name";
  let total = 0;
  const rows = [];
  for (const [index, row] of spec.data.entries()) {
    const label = String(row[labelKey] ?? index + 1);
    if (spec.type === "waterfall") {
      const value = row[key ?? "value"];
      if (typeof value !== "number") return null;
      const next = total + value;
      if (!Number.isFinite(next)) return null;
      rows.push({ label, interval: [Math.min(total, next), Math.max(total, next)], detail: value });
      total = next;
    } else {
      const { low, high } = row;
      if (
        typeof low !== "number" ||
        typeof high !== "number" ||
        high < low ||
        !Number.isFinite(high - low)
      )
        return null;
      rows.push({ label, interval: [low, high], detail: high - low });
    }
  }
  return rows.length ? rows : null;
}

export function parseChartSpec(raw: string): ChartSpec | null {
  if (raw.length > 64_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const object = value as Partial<ChartSpec>;
    if (
      !(
        (CHART_TYPES as readonly string[]).includes(object.type as string) ||
        isExtraChartType(String(object.type))
      ) ||
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
    // Data that doesn't match its requested family still draws: it falls back to the
    // closest general chart (bar when there are numbers, otherwise the data table).
    if (isExtraChartType(spec.type) && !extraChartFits(spec)) return { ...spec, type: "bar" };
    if (["waterfall", "range"].includes(spec.type) && !rangeChartRows(spec, spec.keys?.[0]))
      return null;
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
