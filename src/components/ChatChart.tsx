import { useMemo, useRef, useState } from "react";
import { BarChart3, Copy, Download, Table2 } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export type ChartType = "line" | "bar" | "pie" | "donut" | "scatter";
export type ChartSpec = {
  type: ChartType;
  title?: string;
  xKey?: string;
  keys?: string[];
  colors?: string[];
  data: Array<Record<string, string | number>>;
};
const TYPES: ChartType[] = ["bar", "line", "pie", "donut", "scatter"];
const DEFAULT_COLORS = [
  "hsl(var(--primary))",
  "#6366f1",
  "#ec4899",
  "#10b981",
  "#f59e0b",
  "#0ea5e9",
];

export function parseChartSpec(raw: string): ChartSpec | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const object = value as Partial<ChartSpec>;
    if (
      !TYPES.includes(object.type as ChartType) ||
      !Array.isArray(object.data) ||
      object.data.length === 0 ||
      object.data.some((row) => !row || typeof row !== "object" || Array.isArray(row))
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

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const xKey = spec.xKey ?? "name";
  const keys = useMemo(
    () =>
      spec.keys?.length
        ? spec.keys
        : Object.keys(spec.data[0] ?? {}).filter(
            (key) => key !== xKey && spec.data.some((row) => typeof row[key] === "number"),
          ),
    [spec, xKey],
  );
  const [type, setType] = useState<ChartType>(spec.type);
  const [table, setTable] = useState(false);
  const figureRef = useRef<HTMLElement>(null);
  const colors = spec.colors?.length ? spec.colors : DEFAULT_COLORS;
  const save = (content: string, mime: string, extension: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${spec.title ?? "chart"}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
      <XAxis dataKey={xKey} stroke="hsl(var(--muted-foreground))" fontSize={12} />
      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
      <Tooltip />
      <Legend />
    </>
  );

  return (
    <figure
      ref={figureRef}
      className="my-4 overflow-hidden rounded-2xl border border-border bg-card p-3 sm:p-4"
      aria-label={spec.title ? `Interactive chart: ${spec.title}` : "Interactive chart"}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <figcaption className="mr-auto text-sm font-semibold">{spec.title ?? "Chart"}</figcaption>
        <label className="sr-only" htmlFor={`chart-type-${spec.title ?? "data"}`}>
          Chart type
        </label>
        <select
          id={`chart-type-${spec.title ?? "data"}`}
          value={type}
          onChange={(event) => setType(event.target.value as ChartType)}
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
        >
          {TYPES.map((item) => (
            <option key={item} value={item}>
              {item[0].toUpperCase() + item.slice(1)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setTable((value) => !value)}
          aria-pressed={table}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 hover:bg-accent"
        >
          <Table2 className="h-4 w-4" /> Table
        </button>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(chartToCsv(spec));
            toast.success("Chart data copied");
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 hover:bg-accent"
        >
          <Copy className="h-4 w-4" /> Copy
        </button>
        <button
          type="button"
          onClick={() => save(chartToCsv(spec), "text/csv", "csv")}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 hover:bg-accent"
        >
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>
      {keys.length === 0 ? (
        <div role="alert" className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
          This chart has no numeric series to display. The source data is preserved below.
        </div>
      ) : (
        <div
          className="h-56 w-full sm:h-72"
          role="img"
          aria-label={`${type} chart with ${spec.data.length} data points`}
        >
          <ResponsiveContainer width="100%" height="100%">
            {type === "pie" || type === "donut" ? (
              <PieChart>
                <Tooltip />
                <Legend />
                <Pie
                  data={spec.data}
                  dataKey={keys[0]}
                  nameKey={xKey}
                  innerRadius={type === "donut" ? "45%" : 0}
                  outerRadius="75%"
                  label
                >
                  {spec.data.map((_, index) => (
                    <Cell key={index} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
              </PieChart>
            ) : type === "bar" ? (
              <BarChart data={spec.data}>
                {axes}
                {keys.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={colors[index % colors.length]}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            ) : type === "scatter" ? (
              <ScatterChart>
                {axes}
                {keys.slice(0, 1).map((key, index) => (
                  <Scatter
                    key={key}
                    name={key}
                    data={spec.data}
                    dataKey={key}
                    fill={colors[index]}
                  />
                ))}
              </ScatterChart>
            ) : (
              <LineChart data={spec.data}>
                {axes}
                {keys.map((key, index) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      {(table || keys.length === 0) && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Data used in {spec.title ?? "chart"}</caption>
            <thead>
              <tr>
                {Object.keys(spec.data[0] ?? {}).map((column) => (
                  <th key={column} scope="col" className="border-b px-2 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spec.data.map((row, index) => (
                <tr key={index} tabIndex={0} className="focus-within:bg-accent hover:bg-muted/50">
                  {Object.keys(spec.data[0] ?? {}).map((column) => (
                    <td key={column} className="border-b px-2 py-2">
                      {row[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5" /> Generated only from the structured data in this
        response.
      </p>
    </figure>
  );
}

export function extractCharts(
  content: string,
): Array<{ kind: "text"; value: string } | { kind: "chart"; spec: ChartSpec }> {
  const pattern = /```kova-chart\s*\n([\s\S]*?)```/g;
  const parts: Array<{ kind: "text"; value: string } | { kind: "chart"; spec: ChartSpec }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex)
      parts.push({ kind: "text", value: content.slice(lastIndex, match.index) });
    const spec = parseChartSpec(match[1].trim());
    parts.push(spec ? { kind: "chart", spec } : { kind: "text", value: match[0] });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < content.length) parts.push({ kind: "text", value: content.slice(lastIndex) });
  if (!parts.length) parts.push({ kind: "text", value: content });
  return parts;
}
