import { useId, useMemo, useRef, useState } from "react";
import { BarChart3, Copy, Download, Table2 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sankey,
  Treemap,
  ZAxis,
  FunnelChart,
  Funnel,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  AreaChart,
  Area,
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
import {
  CHART_TYPES,
  candlestickRows,
  chartToCsv,
  histogramRows,
  sankeyData,
  rangeChartRows,
  type ChartSpec,
  type ChartType,
} from "./chat-chart-utils";
const chartNames = {
  "horizontal-bar": "Horizontal bar",
  "stacked-bar": "Stacked bar",
  "stacked-area": "Stacked area",
  "percent-stacked-bar": "100% stacked bar",
} as const;

const DEFAULT_COLORS = ["var(--primary)", "#6366f1", "#ec4899", "#10b981", "#f59e0b", "#0ea5e9"];

function ChartHeatmap({ spec, xKey, keys }: { spec: ChartSpec; xKey: string; keys: string[] }) {
  const values = spec.data.flatMap((row) =>
    keys.map((key) => row[key]).filter((value): value is number => typeof value === "number"),
  );
  const min = values.reduce((current, value) => Math.min(current, value), Infinity);
  const max = values.reduce((current, value) => Math.max(current, value), -Infinity);
  const scale = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const span = max / scale - min / scale;
  return (
    <div
      role="region"
      aria-label="Scrollable heatmap"
      tabIndex={0}
      className="max-h-96 overflow-auto"
    >
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{spec.title ?? "Chart"} heatmap</caption>
        <thead>
          <tr>
            <th scope="col" className="p-2">
              {xKey}
            </th>
            {keys.map((key) => (
              <th key={key} scope="col" className="p-2">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.data.map((row, index) => (
            <tr key={index}>
              <th scope="row" className="p-2 font-medium">
                {row[xKey] ?? index + 1}
              </th>
              {keys.map((key) => {
                const value = row[key];
                const ratio =
                  typeof value === "number"
                    ? max === min
                      ? 0.5
                      : (value / scale - min / scale) / span
                    : 0;
                return (
                  <td
                    key={key}
                    className="border border-border p-2 tabular-nums"
                    style={{
                      backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(ratio * 32)}%, var(--card))`,
                    }}
                  >
                    {typeof value === "number" ? value : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandlePlot({ rows }: { rows: NonNullable<ReturnType<typeof candlestickRows>> }) {
  const low = Math.min(...rows.map((row) => row.low));
  const high = Math.max(...rows.map((row) => row.high));
  const scale = Math.max(Math.abs(high), Math.abs(low)) || 1;
  const span = high / scale - low / scale;
  const y = (value: number) =>
    span === 0 ? 100 : 188 - ((value / scale - low / scale) / span) * 172;
  const distance = 560 / rows.length;
  return (
    <svg
      viewBox="0 0 600 205"
      className="block h-auto w-full"
      role="img"
      aria-label="Candlestick plot"
    >
      <path d="M20 10V192H580" fill="none" stroke="var(--border)" />
      {rows.map(({ label, open, high, low, close }, index) => {
        const x = 20 + distance * (index + 0.5);
        const width = Math.min(distance * 0.65, 24);
        const top = Math.min(y(open), y(close));
        const increased = close >= open;
        return (
          <g
            key={index}
            className={
              increased
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }
          >
            <title>{`${label}: Open ${open}, High ${high}, Low ${low}, Close ${close}`}</title>
            <line x1={x} x2={x} y1={y(high)} y2={y(low)} stroke="currentColor" />
            <rect
              x={x - width / 2}
              y={top}
              width={width}
              height={Math.max(1, Math.abs(y(open) - y(close)))}
              fill={increased ? "var(--card)" : "currentColor"}
              stroke="currentColor"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const xKey = spec.xKey ?? "name";
  const sizeKey = spec.sizeKey ?? "size";
  const keys = useMemo(
    () =>
      spec.keys?.length
        ? spec.keys.filter((key) => spec.data.some((row) => typeof row[key] === "number"))
        : Object.keys(spec.data[0] ?? {}).filter(
            (key) =>
              key !== xKey &&
              (spec.type !== "bubble" || key !== sizeKey) &&
              spec.data.some((row) => typeof row[key] === "number"),
          ),
    [spec, xKey, sizeKey],
  );
  const numericX = spec.data.every((row) => typeof row[xKey] === "number");
  const [type, setType] = useState<ChartType>(
    spec.type === "scatter" && !numericX ? "line" : spec.type,
  );
  const [table, setTable] = useState(false);
  const figureRef = useRef<HTMLElement>(null);
  const chartTypeId = useId();
  const colors = spec.colors?.length ? spec.colors : DEFAULT_COLORS;
  const save = (content: string, mime: string, extension: string) => {
    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      url = URL.createObjectURL(new Blob([content], { type: mime }));
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${spec.title ?? "chart"}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      const completedUrl = url;
      url = null;
      window.setTimeout(() => URL.revokeObjectURL(completedUrl), 1_000);
    } catch {
      if (url) URL.revokeObjectURL(url);
      toast.error("Could not download the chart data. Try copying it instead.");
    } finally {
      anchor?.remove();
    }
  };
  const candles = type === "candlestick" ? candlestickRows(spec) : null;
  const flow = sankeyData(spec);
  const waterfall = rangeChartRows(
    { ...spec, type: "waterfall" },
    spec.type === "waterfall" ? spec.keys?.[0] : keys[0],
  );
  const range = rangeChartRows({ ...spec, type: "range" });
  const intervals = type === "waterfall" ? waterfall : type === "range" ? range : null;
  const percent = type === "percent-stacked-bar";
  const nonNegative = spec.data.every((row) =>
    keys.every((key) => typeof row[key] !== "number" || row[key] >= 0),
  );
  const histogram = type === "histogram" && keys[0] ? histogramRows(spec, keys[0]) : [];
  const horizontal = type === "horizontal-bar";
  const scatter = type === "scatter" || type === "bubble";
  const bubbleY = keys.find((key) => key !== sizeKey && key !== xKey);
  const hasBubble =
    numericX &&
    bubbleY &&
    spec.data.every(
      (row) =>
        typeof row[bubbleY] === "number" && typeof row[sizeKey] === "number" && row[sizeKey] >= 0,
    );
  const tree = keys[0]
    ? spec.data.flatMap((row, index) => {
        const size = row[keys[0]];
        return typeof size === "number" && size > 0
          ? [{ name: String(row[xKey] ?? index + 1), size }]
          : [];
      })
    : [];
  const noCompatibleSeries =
    !keys.length ||
    (["percent-stacked-bar", "funnel", "treemap"].includes(type) && !nonNegative) ||
    (type === "treemap" && !tree.length) ||
    (type === "bubble" && !hasBubble);
  const displayTypes = CHART_TYPES.filter(
    (candidate) =>
      (candidate !== "scatter" || numericX) &&
      (candidate !== "bubble" || hasBubble) &&
      (candidate !== "treemap" || tree.length > 0) &&
      (candidate !== "candlestick" || !!candlestickRows(spec)) &&
      (candidate !== "sankey" || !!flow) &&
      (candidate !== "waterfall" || !!waterfall) &&
      (candidate !== "range" || !!range) &&
      (!["percent-stacked-bar", "funnel", "treemap"].includes(candidate) || nonNegative),
  );
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
      <XAxis
        dataKey={horizontal ? undefined : xKey}
        type={horizontal || scatter ? "number" : "category"}
        stroke="var(--muted-foreground)"
        fontSize={12}
      />
      <YAxis
        dataKey={horizontal ? xKey : type === "bubble" ? bubbleY : scatter ? keys[0] : undefined}
        type={horizontal ? "category" : "number"}
        stroke="var(--muted-foreground)"
        fontSize={12}
        tickFormatter={percent ? (value: number) => `${Math.round(value * 100)}%` : undefined}
      />
      <Tooltip formatter={percent ? (value: number) => String(value) : undefined} />
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
        <label className="sr-only" htmlFor={chartTypeId}>
          Chart type
        </label>
        <Select value={type} onValueChange={(value) => setType(value as ChartType)}>
          <SelectTrigger id={chartTypeId} className="min-h-11 w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {displayTypes.map((item) => (
              <SelectItem key={item} value={item}>
                {item in chartNames
                  ? chartNames[item as keyof typeof chartNames]
                  : item[0].toUpperCase() + item.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setTable((value) => !value)}
          aria-pressed={table}
          className="inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-lg px-2 hover:bg-accent"
        >
          <Table2 className="h-4 w-4" /> Table
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(chartToCsv(spec));
              toast.success("Chart data copied");
            } catch {
              toast.error("Could not copy the chart data. Try downloading the CSV instead.");
            }
          }}
          className="inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-lg px-2 hover:bg-accent"
        >
          <Copy className="h-4 w-4" /> Copy
        </button>
        <button
          type="button"
          onClick={() => save(chartToCsv(spec), "text/csv", "csv")}
          className="inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-lg px-2 hover:bg-accent"
        >
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>
      {type === "sankey" && flow ? (
        <div className="h-64 w-full sm:h-80" role="img" aria-label="Sankey flow diagram">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={flow}
              nodePadding={6}
              nodeWidth={14}
              node={{ fill: colors[0] }}
              link={{ stroke: colors[0], strokeOpacity: 0.35 }}
            >
              <Tooltip />
            </Sankey>
          </ResponsiveContainer>
        </div>
      ) : candles ? (
        <CandlePlot rows={candles} />
      ) : noCompatibleSeries ? (
        <div role="alert" className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
          This chart has no compatible numeric series. The source data is preserved below.
        </div>
      ) : type === "heatmap" ? (
        <ChartHeatmap spec={spec} xKey={xKey} keys={keys} />
      ) : (
        <div
          className="h-56 w-full sm:h-72"
          role="img"
          aria-label={`${type} chart with ${spec.data.length} data points`}
        >
          <ResponsiveContainer width="100%" height="100%">
            {intervals ? (
              <BarChart data={intervals}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis domain={["auto", "auto"]} fontSize={12} />
                <Tooltip
                  formatter={(value: number | number[], name, item) => {
                    if (type === "waterfall" && item.payload)
                      return [String(item.payload.detail), "Change"];
                    return [Array.isArray(value) ? value.join(" to ") : value, name];
                  }}
                />
                <Bar dataKey="interval" name="Range">
                  {intervals.map((item, index) => (
                    <Cell
                      key={index}
                      fill={
                        type === "waterfall" && item.detail < 0
                          ? "var(--destructive)"
                          : colors[index % colors.length]
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : type === "treemap" ? (
              <Treemap
                data={tree}
                dataKey="size"
                nameKey="name"
                fill={colors[0]}
                stroke="var(--card)"
                isAnimationActive={false}
              >
                <Tooltip />
              </Treemap>
            ) : type === "histogram" ? (
              <BarChart data={histogram} barCategoryGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="range" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip
                  labelFormatter={(label, payload) => {
                    const bin = payload[0]?.payload;
                    return bin
                      ? `${label}: ${Number(bin.lower.toPrecision(4))} to ${Number(bin.upper.toPrecision(4))}`
                      : label;
                  }}
                />
                <Bar dataKey="count" name="Count" fill={colors[0]} />
              </BarChart>
            ) : type === "funnel" ? (
              <FunnelChart>
                <Tooltip />
                <Funnel data={spec.data} dataKey={keys[0]} nameKey={xKey} fill={colors[0]} />
              </FunnelChart>
            ) : type === "radar" ? (
              <RadarChart data={spec.data}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis
                  dataKey={xKey}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                />
                <PolarRadiusAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {keys.map((key, index) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={colors[index % colors.length]}
                    stroke={colors[index % colors.length]}
                    fillOpacity={0.18}
                  />
                ))}
              </RadarChart>
            ) : type === "pie" || type === "donut" ? (
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
            ) : type === "bar" || type === "stacked-bar" || percent || horizontal ? (
              <BarChart
                data={spec.data}
                layout={horizontal ? "vertical" : "horizontal"}
                stackOffset={percent ? "expand" : undefined}
              >
                {axes}
                {keys.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={colors[index % colors.length]}
                    stackId={type === "stacked-bar" || percent ? "series" : undefined}
                    radius={type === "bar" ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            ) : type === "area" || type === "stacked-area" ? (
              <AreaChart data={spec.data}>
                {axes}
                {keys.map((key, index) => (
                  <Area
                    key={key}
                    dataKey={key}
                    stackId={type === "stacked-area" ? "series" : undefined}
                    stroke={colors[index % colors.length]}
                    fill={colors[index % colors.length]}
                    fillOpacity={0.28}
                  />
                ))}
              </AreaChart>
            ) : scatter ? (
              <ScatterChart>
                {axes}
                {type === "bubble" && <ZAxis type="number" dataKey={sizeKey} range={[30, 360]} />}
                {(type === "bubble" && bubbleY ? [bubbleY] : keys.slice(0, 1)).map((key, index) => (
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
                    type={type === "step" ? "stepAfter" : "monotone"}
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
      {(table || noCompatibleSeries || type === "sankey") && (
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
