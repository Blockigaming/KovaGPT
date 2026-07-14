import { useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

/**
 * Chart pipeline: detects fenced ```kova-chart {json} ``` blocks emitted by
 * the model and renders them as real Recharts visualizations. Any block that
 * fails to parse is left as a plain code block so users still see something,
 * and the model can retry with the invalid_chart_data category.
 */

export type ChartSpec = {
  type: "line" | "bar" | "area" | "pie";
  title?: string;
  xKey?: string;
  keys?: string[];
  colors?: string[];
  data: Array<Record<string, string | number>>;
};

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
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (!Array.isArray(obj.data) || obj.data.length === 0) return null;
    if (!["line", "bar", "area", "pie"].includes(obj.type)) return null;
    return obj as ChartSpec;
  } catch {
    return null;
  }
}

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const xKey = spec.xKey ?? "name";
  const keys = useMemo(() => {
    if (spec.keys && spec.keys.length > 0) return spec.keys;
    const first = spec.data[0] ?? {};
    return Object.keys(first).filter((k) => k !== xKey);
  }, [spec, xKey]);
  const colors = spec.colors && spec.colors.length > 0 ? spec.colors : DEFAULT_COLORS;

  return (
    <figure className="my-4 overflow-hidden rounded-2xl border border-border bg-card p-3 sm:p-4">
      {spec.title && (
        <figcaption className="mb-2 text-sm font-semibold text-foreground">
          {spec.title}
        </figcaption>
      )}
      <div className="h-56 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === "pie" ? (
            <PieChart>
              <Tooltip />
              <Legend />
              <Pie
                data={spec.data}
                dataKey={keys[0] ?? "value"}
                nameKey={xKey}
                outerRadius="75%"
                label
              >
                {spec.data.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : spec.type === "bar" ? (
            <BarChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey={xKey} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              {keys.map((k, i) => (
                <Bar key={k} dataKey={k} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          ) : spec.type === "area" ? (
            <AreaChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey={xKey} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              {keys.map((k, i) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={colors[i % colors.length]}
                  fill={colors[i % colors.length]}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey={xKey} stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              {keys.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/**
 * Splits assistant markdown around ```kova-chart``` fences. Returns an array
 * of parts where each part is either a text chunk or a parsed ChartSpec.
 */
export function extractCharts(
  content: string,
): Array<{ kind: "text"; value: string } | { kind: "chart"; spec: ChartSpec }> {
  const re = /```kova-chart\s*\n([\s\S]*?)```/g;
  const parts: Array<{ kind: "text"; value: string } | { kind: "chart"; spec: ChartSpec }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: "text", value: content.slice(lastIndex, match.index) });
    }
    const spec = parseChartSpec(match[1].trim());
    if (spec) {
      parts.push({ kind: "chart", spec });
    } else {
      // Preserve the block as text so the user sees the raw payload rather
      // than a silently-dropped chart.
      parts.push({ kind: "text", value: match[0] });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < content.length) {
    parts.push({ kind: "text", value: content.slice(lastIndex) });
  }
  if (parts.length === 0) parts.push({ kind: "text", value: content });
  return parts;
}
