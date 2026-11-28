import { useId, useMemo, useState } from "react";
import { BarChart3, Copy, Download, Pin, PinOff, Table2 } from "lucide-react";
import { useLayout } from "@/hooks/use-mobile";
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
  ResponsiveContainer,
} from "recharts";
import {
  CHART_TYPES,
  isExtraChartType,
  candlestickRows,
  chartToCsv,
  histogramRows,
  sankeyData,
  rangeChartRows,
  type ChartSpec,
  type ChartType,
} from "./chat-chart-utils";
import { ChatChartExtra } from "./ChatChartExtra";
import "./chat-chart.css";

const chartNames = {
  "horizontal-bar": "Horizontal bar",
  "stacked-bar": "Stacked bar",
  "stacked-area": "Stacked area",
  "percent-stacked-bar": "100% stacked bar",
} as const;

const DEFAULT_COLORS = ["#3b82f6", "#14b8a6", "#a78bfa", "#f59e0b", "#22c55e", "#ef4444"];
const CHART_PALETTES = {
  blue: DEFAULT_COLORS,
  teal: ["#14b8a6", "#3b82f6", "#22c55e", "#a78bfa", "#f59e0b", "#ef4444"],
  violet: ["#a78bfa", "#3b82f6", "#14b8a6", "#f59e0b", "#22c55e", "#ef4444"],
  warm: ["#f59e0b", "#ef4444", "#ec4899", "#a78bfa", "#3b82f6", "#14b8a6"],
} as const;
type ChartPalette = keyof typeof CHART_PALETTES | "original";

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
  const { isMobile, interaction } = useLayout();
  const tooltipTrigger = interaction === "touch" ? "click" : "hover";
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
  // Picture-in-picture: the chart floats in a corner while the chat scrolls, then returns.
  const [pinned, setPinned] = useState(false);
  const chartTypeId = useId();
  const paletteId = useId();
  const [palette, setPalette] = useState<ChartPalette>("original");
  const colors =
    palette === "original"
      ? spec.colors?.length
        ? spec.colors
        : DEFAULT_COLORS
      : [...CHART_PALETTES[palette]];
  const circular = type === "pie" || type === "donut";
  const legendLabels = circular
    ? spec.data.map((row, index) => String(row[xKey] ?? `Item ${index + 1}`))
    : type === "scatter" || type === "bubble"
      ? keys.filter((key) => type !== "bubble" || (key !== xKey && key !== sizeKey)).slice(0, 1)
      : keys;
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
  // Extended families keep their own shape; the picker offers only that type.
  const extra = isExtraChartType(type) ? type : null;
  const reserved = new Set([
    "lat",
    "lon",
    "lng",
    "x",
    "y",
    "z",
    "dx",
    "dy",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "error",
    "start",
    "end",
    "date",
  ]);
  const extraKeys = spec.keys?.length ? keys : keys.filter((key) => !reserved.has(key));
  const displayTypes: ChartType[] = isExtraChartType(spec.type)
    ? [spec.type]
    : CHART_TYPES.filter(
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
        fontSize={isMobile ? 11 : 12}
        minTickGap={isMobile ? 16 : 5}
        tickFormatter={(value) => {
          const label = String(value);
          return !horizontal && !scatter && isMobile && label.length > 12
            ? `${label.slice(0, 11)}…`
            : label;
        }}
      />
      <YAxis
        dataKey={horizontal ? xKey : type === "bubble" ? bubbleY : scatter ? keys[0] : undefined}
        type={horizontal ? "category" : "number"}
        stroke="var(--muted-foreground)"
        fontSize={12}
        tickFormatter={percent ? (value: number) => `${Math.round(value * 100)}%` : undefined}
      />
      <Tooltip
        trigger={tooltipTrigger}
        isAnimationActive={false}
        formatter={percent ? (value: number) => String(value) : undefined}
      />
    </>
  );
  const tooltip = <Tooltip trigger={tooltipTrigger} isAnimationActive={false} />;

  return (
    <>
      {pinned && (
        <div className="kova-chart-pinned-placeholder my-4 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {spec.title ?? "Chart"} is pinned to the corner.{" "}
          <button type="button" className="underline" onClick={() => setPinned(false)}>
            Return it here
          </button>
        </div>
      )}
      <figure
        className="kova-chart my-4 overflow-hidden rounded-2xl bg-card p-3 sm:p-4"
        data-pinned={pinned || undefined}
        aria-label={spec.title ? `Interactive chart: ${spec.title}` : "Interactive chart"}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <figcaption className="mr-auto basis-full break-words text-sm font-semibold sm:basis-auto">
            {spec.title ?? "Chart"}
          </figcaption>
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
                    : (item[0].toUpperCase() + item.slice(1)).replaceAll("-", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="sr-only" htmlFor={paletteId}>
            Chart colors
          </label>
          <Select value={palette} onValueChange={(value) => setPalette(value as ChartPalette)}>
            <SelectTrigger id={paletteId} className="min-h-11 w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="original">Default colors</SelectItem>
              <SelectItem value="blue">Blue</SelectItem>
              <SelectItem value="teal">Teal</SelectItem>
              <SelectItem value="violet">Violet</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setPinned((value) => !value)}
            aria-pressed={pinned}
            aria-label={pinned ? "Return chart to the conversation" : "Pin chart while scrolling"}
            title={pinned ? "Return to conversation" : "Pin while scrolling"}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 hover:bg-accent"
          >
            {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
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
        {extra ? (
          <ChatChartExtra spec={spec} type={extra} colors={colors} xKey={xKey} keys={extraKeys} />
        ) : type === "sankey" && flow ? (
          <div className="h-64 w-full sm:h-80" role="img" aria-label="Sankey flow diagram">
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={flow}
                nodePadding={6}
                nodeWidth={14}
                node={{ fill: colors[0] }}
                link={{ stroke: colors[0], strokeOpacity: 0.35 }}
              >
                {tooltip}
              </Sankey>
            </ResponsiveContainer>
          </div>
        ) : candles ? (
          <CandlePlot rows={candles} />
        ) : noCompatibleSeries ? null : type === "heatmap" ? (
          <ChartHeatmap spec={spec} xKey={xKey} keys={keys} />
        ) : (
          <div
            className="kova-chart-layout"
            data-compact-legend={legendLabels.length > 8 ? "true" : undefined}
          >
            <div
              className="h-56 w-full min-w-0 sm:h-72"
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
                      trigger={tooltipTrigger}
                      isAnimationActive={false}
                      formatter={(value: number | number[], name, item) => {
                        if (type === "waterfall" && item.payload)
                          return [String(item.payload.detail), "Change"];
                        return [Array.isArray(value) ? value.join(" to ") : value, name];
                      }}
                    />
                    <Bar isAnimationActive={false} dataKey="interval" name="Range">
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
                    {tooltip}
                  </Treemap>
                ) : type === "histogram" ? (
                  <BarChart data={histogram} barCategoryGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="range" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip
                      trigger={tooltipTrigger}
                      isAnimationActive={false}
                      labelFormatter={(label, payload) => {
                        const bin = payload[0]?.payload;
                        return bin
                          ? `${label}: ${Number(bin.lower.toPrecision(4))} to ${Number(bin.upper.toPrecision(4))}`
                          : label;
                      }}
                    />
                    <Bar isAnimationActive={false} dataKey="count" name="Count" fill={colors[0]} />
                  </BarChart>
                ) : type === "funnel" ? (
                  <FunnelChart>
                    {tooltip}
                    <Funnel
                      isAnimationActive={false}
                      data={spec.data}
                      dataKey={keys[0]}
                      nameKey={xKey}
                      fill={colors[0]}
                    />
                  </FunnelChart>
                ) : type === "radar" ? (
                  <RadarChart data={spec.data}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis
                      dataKey={xKey}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    />
                    <PolarRadiusAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    {tooltip}
                    {keys.map((key, index) => (
                      <Radar
                        isAnimationActive={false}
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
                    {tooltip}
                    <Pie
                      isAnimationActive={false}
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
                        isAnimationActive={false}
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
                        isAnimationActive={false}
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
                    {type === "bubble" && (
                      <ZAxis type="number" dataKey={sizeKey} range={[30, 360]} />
                    )}
                    {(type === "bubble" && bubbleY ? [bubbleY] : keys.slice(0, 1)).map(
                      (key, index) => (
                        <Scatter
                          isAnimationActive={false}
                          key={key}
                          name={key}
                          data={spec.data}
                          dataKey={key}
                          fill={colors[index]}
                        />
                      ),
                    )}
                  </ScatterChart>
                ) : (
                  <LineChart data={spec.data}>
                    {axes}
                    {keys.map((key, index) => (
                      <Line
                        isAnimationActive={false}
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
            <ul className="kova-chart-legend" aria-label="Chart legend">
              {legendLabels.map((label, index) => (
                <li key={`${index}:${label}`}>
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: colors[index % colors.length] }}
                  />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(table || (!extra && noCompatibleSeries) || type === "sankey") && (
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
    </>
  );
}
