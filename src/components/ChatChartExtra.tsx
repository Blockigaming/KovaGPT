import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Sankey,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  boxStats,
  calendarCells,
  chordLayout,
  contourLevels,
  contourSegments,
  dayNumber,
  gridFromRows,
  jitter,
  kernelDensity,
  normaliser,
  numbersOf,
  partition,
  pathHierarchy,
  project3d,
  rankRows,
} from "@/lib/chart-extra-math.mjs";
import { sankeyData, type ChartSpec, type ExtraChartType } from "./chat-chart-utils";

type Props = {
  spec: ChartSpec;
  type: ExtraChartType;
  colors: string[];
  xKey: string;
  keys: string[];
};

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 12 };
const GRID = <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />;
const TIP = (
  <Tooltip
    contentStyle={{
      background: "var(--popover)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      color: "var(--popover-foreground)",
      fontSize: 13,
    }}
  />
);

function Frame({
  label,
  children,
  tall = false,
}: {
  label: string;
  children: ReactNode;
  tall?: boolean;
}) {
  return (
    <div
      className={`kova-chart-extra ${tall ? "h-96" : "h-72 sm:h-80"} w-full`}
      role="img"
      aria-label={label}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

function Svg({
  label,
  viewBox,
  children,
  note,
}: {
  label: string;
  viewBox: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div dir="ltr" className="kova-chart-extra w-full">
      <svg
        viewBox={viewBox}
        className="block h-auto w-full max-h-[28rem]"
        role="img"
        aria-label={label}
      >
        {children}
      </svg>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

const fmt = (value: number) =>
  Math.abs(value) >= 1e4 || (Math.abs(value) < 0.01 && value !== 0)
    ? value.toExponential(2)
    : Number(value.toFixed(2)).toLocaleString();

/* ---------------- Distributions ---------------- */

function BoxPlot({ spec, keys, colors, violin }: Props & { violin?: boolean }) {
  const series = keys
    .map((key) => ({ key, values: numbersOf(spec.data, key) }))
    .filter((item) => item.values.length >= 2);
  const all = series.flatMap((item) => item.values);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const y = (value: number) => 270 - ((value - min) / (max - min || 1)) * 240;
  const band = 560 / series.length;
  return (
    <Svg label={`${violin ? "Violin" : "Box"} plot of ${keys.join(", ")}`} viewBox="0 0 620 300">
      <path d="M40 20V270H600" fill="none" stroke="var(--border)" />
      {[min, (min + max) / 2, max].map((tick) => (
        <text
          key={tick}
          x={34}
          y={y(tick) + 4}
          textAnchor="end"
          fontSize="11"
          fill="var(--muted-foreground)"
        >
          {fmt(tick)}
        </text>
      ))}
      {series.map(({ key, values }, index) => {
        const stats = boxStats(values)!;
        const cx = 40 + band * index + band / 2;
        const color = colors[index % colors.length];
        const half = Math.min(36, band / 3);
        const density = violin ? kernelDensity(values, 40, [min, max]) : [];
        const peak = Math.max(...density.map((point) => point.density), 1e-12);
        return (
          <g key={key}>
            <title>
              {`${key}: min ${fmt(stats.min)}, Q1 ${fmt(stats.q1)}, median ${fmt(stats.median)}, Q3 ${fmt(stats.q3)}, max ${fmt(stats.max)}, n=${stats.count}`}
            </title>
            {violin && (
              <path
                d={[
                  ...density.map(
                    (p, i) => `${i ? "L" : "M"}${cx - (p.density / peak) * half * 1.4} ${y(p.x)}`,
                  ),
                  ...[...density]
                    .reverse()
                    .map((p) => `L${cx + (p.density / peak) * half * 1.4} ${y(p.x)}`),
                  "Z",
                ].join("")}
                fill={color}
                fillOpacity={0.25}
                stroke={color}
              />
            )}
            <line x1={cx} x2={cx} y1={y(stats.max)} y2={y(stats.q3)} stroke={color} />
            <line x1={cx} x2={cx} y1={y(stats.q1)} y2={y(stats.min)} stroke={color} />
            <rect
              x={cx - half / (violin ? 3 : 1)}
              width={(half * 2) / (violin ? 3 : 1)}
              y={y(stats.q3)}
              height={Math.max(1, y(stats.q1) - y(stats.q3))}
              fill={violin ? "var(--card)" : color}
              fillOpacity={violin ? 1 : 0.3}
              stroke={color}
              rx={3}
            />
            <line
              x1={cx - half / (violin ? 3 : 1)}
              x2={cx + half / (violin ? 3 : 1)}
              y1={y(stats.median)}
              y2={y(stats.median)}
              stroke={color}
              strokeWidth={2.5}
            />
            {!violin &&
              stats.outliers.map((value, i) => (
                <circle key={i} cx={cx} cy={y(value)} r={3} fill="none" stroke={color} />
              ))}
            <text x={cx} y={290} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">
              {key}
            </text>
          </g>
        );
      })}
    </Svg>
  );
}

function DensityPlot({ spec, keys, colors, ridgeline }: Props & { ridgeline?: boolean }) {
  const series = keys
    .map((key) => ({ key, values: numbersOf(spec.data, key) }))
    .filter((item) => item.values.length >= 2);
  const all = series.flatMap((item) => item.values);
  const domain: [number, number] = [Math.min(...all), Math.max(...all)];
  const curves = series.map((item) => ({
    ...item,
    points: kernelDensity(item.values, 64, domain),
  }));
  if (!ridgeline) {
    const rows = curves[0]?.points.map((point, index) =>
      Object.fromEntries([["x", point.x], ...curves.map((c) => [c.key, c.points[index].density])]),
    );
    return (
      <Frame label={`Density of ${keys.join(", ")}`}>
        <AreaChart data={rows}>
          {GRID}
          <XAxis
            dataKey="x"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickCount={7}
            tickFormatter={fmt}
            tick={AXIS}
          />
          <YAxis tick={AXIS} tickFormatter={fmt} />
          {TIP}
          {curves.map((curve, index) => (
            <Area
              key={curve.key}
              dataKey={curve.key}
              type="monotone"
              stroke={colors[index % colors.length]}
              fill={colors[index % colors.length]}
              fillOpacity={0.2}
            />
          ))}
        </AreaChart>
      </Frame>
    );
  }
  const step = 220 / Math.max(1, curves.length);
  const peak = Math.max(...curves.flatMap((c) => c.points.map((p) => p.density)), 1e-12);
  const x = (value: number) => 90 + ((value - domain[0]) / (domain[1] - domain[0] || 1)) * 500;
  return (
    <Svg label={`Ridgeline of ${keys.join(", ")}`} viewBox="0 0 620 300">
      {curves.map((curve, index) => {
        const base = 60 + step * index + step;
        const color = colors[index % colors.length];
        const d = curve.points
          .map((p, i) => `${i ? "L" : "M"}${x(p.x)} ${base - (p.density / peak) * step * 1.8}`)
          .join("");
        return (
          <g key={curve.key}>
            <title>{`${curve.key}: ${curve.values.length} observations`}</title>
            <path
              d={`${d}L${x(domain[1])} ${base}L${x(domain[0])} ${base}Z`}
              fill={color}
              fillOpacity={0.35}
              stroke={color}
            />
            <text x={82} y={base - 2} textAnchor="end" fontSize="12" fill="var(--muted-foreground)">
              {curve.key}
            </text>
          </g>
        );
      })}
      <text x={x(domain[0])} y={292} fontSize="11" fill="var(--muted-foreground)">
        {fmt(domain[0])}
      </text>
      <text x={x(domain[1])} y={292} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">
        {fmt(domain[1])}
      </text>
    </Svg>
  );
}

function StripPlot({ spec, keys, colors }: Props) {
  const points = keys.flatMap((key, group) =>
    numbersOf(spec.data, key).map((value, index) => ({
      x: group + 1 + jitter(index * 31 + group) * 0.5,
      y: value,
      key,
    })),
  );
  return (
    <Frame label={`Strip plot of ${keys.join(", ")}`}>
      <ScatterChart>
        {GRID}
        <XAxis
          type="number"
          dataKey="x"
          domain={[0.4, keys.length + 0.6]}
          ticks={keys.map((_, i) => i + 1)}
          tickFormatter={(v: number) => keys[v - 1] ?? ""}
          tick={AXIS}
        />
        <YAxis type="number" dataKey="y" tick={AXIS} />
        {TIP}
        {keys.map((key, index) => (
          <Scatter
            key={key}
            name={key}
            data={points.filter((p) => p.key === key)}
            fill={colors[index % colors.length]}
            fillOpacity={0.7}
          />
        ))}
      </ScatterChart>
    </Frame>
  );
}

/* ---------------- Cartesian variants ---------------- */

function Cartesian({ spec, type, xKey, keys, colors }: Props) {
  const color = (index: number) => colors[index % colors.length];
  const data = type === "bump" ? rankRows(spec.data, xKey, keys) : spec.data;
  switch (type) {
    case "grouped-bar":
    case "diverging-bar":
      return (
        <Frame label={`${type === "grouped-bar" ? "Grouped" : "Diverging"} bar chart`}>
          <BarChart
            data={data}
            layout={type === "diverging-bar" ? "vertical" : "horizontal"}
            stackOffset={type === "diverging-bar" && keys.length > 1 ? "sign" : undefined}
          >
            {GRID}
            {type === "diverging-bar" ? (
              <XAxis type="number" tick={AXIS} />
            ) : (
              <XAxis dataKey={xKey} tick={AXIS} />
            )}
            {type === "diverging-bar" ? (
              <YAxis type="category" dataKey={xKey} tick={AXIS} width={96} />
            ) : (
              <YAxis tick={AXIS} />
            )}
            {type === "diverging-bar" && <ReferenceLine x={0} stroke="var(--muted-foreground)" />}
            {TIP}
            {keys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={color(index)}
                stackId={type === "diverging-bar" && keys.length > 1 ? "d" : undefined}
                radius={type === "grouped-bar" ? [4, 4, 0, 0] : undefined}
              >
                {type === "diverging-bar" && keys.length === 1
                  ? data.map((row, i) => (
                      <Cell key={i} fill={Number(row[key]) < 0 ? "#ef4444" : color(0)} />
                    ))
                  : null}
              </Bar>
            ))}
          </BarChart>
        </Frame>
      );
    case "dot":
    case "lollipop":
      return (
        <Frame label={`${type === "dot" ? "Dot" : "Lollipop"} chart`}>
          <ComposedChart data={data}>
            {GRID}
            <XAxis dataKey={xKey} tick={AXIS} />
            <YAxis tick={AXIS} />
            {TIP}
            {type === "lollipop" &&
              keys
                .slice(0, 1)
                .map((key) => (
                  <Bar
                    key={`stem-${key}`}
                    dataKey={key}
                    barSize={3}
                    fill={color(0)}
                    legendType="none"
                  />
                ))}
            {keys.map((key, index) => (
              <Line
                key={key}
                dataKey={key}
                stroke="none"
                dot={{ r: 6, fill: color(index), stroke: color(index) }}
                activeDot={{ r: 8 }}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </Frame>
      );
    case "slope": {
      const [before, after] = keys;
      const rows = [
        Object.fromEntries([
          ["stage", before],
          ...data.map((row) => [String(row[xKey]), row[before]]),
        ]),
        Object.fromEntries([
          ["stage", after],
          ...data.map((row) => [String(row[xKey]), row[after]]),
        ]),
      ];
      return (
        <Frame label={`Slope chart from ${before} to ${after}`}>
          <LineChart data={rows} margin={{ left: 20, right: 60 }}>
            <XAxis dataKey="stage" tick={AXIS} padding={{ left: 30, right: 30 }} />
            <YAxis tick={AXIS} />
            {TIP}
            {data.map((row, index) => (
              <Line
                key={String(row[xKey])}
                dataKey={String(row[xKey])}
                stroke={color(index)}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </Frame>
      );
    }
    case "bump":
      return (
        <Frame label="Bump chart of rankings">
          <LineChart data={data}>
            {GRID}
            <XAxis dataKey={xKey} tick={AXIS} />
            <YAxis
              reversed
              allowDecimals={false}
              domain={[1, keys.length]}
              tick={AXIS}
              label={{
                value: "Rank",
                angle: -90,
                position: "insideLeft",
                fill: "var(--muted-foreground)",
              }}
            />
            {TIP}
            {keys.map((key, index) => (
              <Line
                key={key}
                dataKey={key}
                stroke={color(index)}
                strokeWidth={3}
                dot={{ r: 5 }}
                type="monotone"
              />
            ))}
          </LineChart>
        </Frame>
      );
    case "streamgraph":
      return (
        <Frame label="Streamgraph">
          <AreaChart data={data} stackOffset="wiggle">
            <XAxis dataKey={xKey} tick={AXIS} />
            <YAxis hide />
            {TIP}
            {keys.map((key, index) => (
              <Area
                key={key}
                dataKey={key}
                stackId="s"
                type="basis"
                stroke="none"
                fill={color(index)}
                fillOpacity={0.85}
              />
            ))}
          </AreaChart>
        </Frame>
      );
    case "connected-scatter":
    case "function":
      return (
        <Frame label={type === "function" ? "Function plot" : "Connected scatter plot"}>
          <LineChart
            data={[...data].sort((a, b) =>
              type === "function" ? Number(a[xKey]) - Number(b[xKey]) : 0,
            )}
          >
            {GRID}
            <XAxis type="number" dataKey={xKey} domain={["dataMin", "dataMax"]} tick={AXIS} />
            <YAxis tick={AXIS} />
            <ReferenceLine y={0} stroke="var(--border)" />
            {TIP}
            {keys.map((key, index) => (
              <Line
                key={key}
                dataKey={key}
                stroke={color(index)}
                strokeWidth={2}
                dot={type === "connected-scatter" ? { r: 4 } : false}
                type={type === "function" ? "monotone" : "linear"}
              />
            ))}
          </LineChart>
        </Frame>
      );
    case "combo":
      return (
        <Frame label="Combined bar and line chart">
          <ComposedChart data={data}>
            {GRID}
            <XAxis dataKey={xKey} tick={AXIS} />
            <YAxis yAxisId="left" tick={AXIS} />
            {keys.length > 1 && <YAxis yAxisId="right" orientation="right" tick={AXIS} />}
            {TIP}
            <Bar yAxisId="left" dataKey={keys[0]} fill={color(0)} radius={[4, 4, 0, 0]} />
            {keys.slice(1).map((key, index) => (
              <Line
                key={key}
                yAxisId="right"
                dataKey={key}
                stroke={color(index + 1)}
                strokeWidth={2}
              />
            ))}
          </ComposedChart>
        </Frame>
      );
    case "error-bars":
      return (
        <Frame label="Bar chart with error bars">
          <BarChart data={data}>
            {GRID}
            <XAxis dataKey={xKey} tick={AXIS} />
            <YAxis tick={AXIS} />
            {TIP}
            <Bar dataKey={keys[0]} fill={color(0)} fillOpacity={0.75} radius={[4, 4, 0, 0]}>
              <ErrorBar dataKey="error" width={8} strokeWidth={1.5} stroke="var(--foreground)" />
            </Bar>
          </BarChart>
        </Frame>
      );
    case "confidence-band": {
      const rows = data.map((row) => ({ ...row, band: [row.low, row.high] }));
      return (
        <Frame label="Line with confidence band">
          <ComposedChart data={rows}>
            {GRID}
            <XAxis dataKey={xKey} tick={AXIS} />
            <YAxis tick={AXIS} />
            {TIP}
            <Area dataKey="band" stroke="none" fill={color(0)} fillOpacity={0.2} name="Interval" />
            <Line dataKey={keys[0]} stroke={color(0)} strokeWidth={2} dot={false} />
          </ComposedChart>
        </Frame>
      );
    }
    case "interval": {
      const rows = data.map((row) => {
        const low = Number(row.low);
        const high = Number(row.high);
        const mid = typeof row[keys[0]] === "number" ? Number(row[keys[0]]) : (low + high) / 2;
        return { ...row, estimate: mid, error: [mid - low, high - mid] };
      });
      return (
        <Frame label="Interval plot">
          <ScatterChart>
            {GRID}
            <XAxis type="category" dataKey={xKey} allowDuplicatedCategory={false} tick={AXIS} />
            <YAxis type="number" dataKey="estimate" tick={AXIS} />
            {TIP}
            <Scatter data={rows} fill={color(0)}>
              <ErrorBar dataKey="error" direction="y" width={10} stroke={color(0)} />
            </Scatter>
          </ScatterChart>
        </Frame>
      );
    }
    default:
      return null;
  }
}

function SmallMultiples({ spec, xKey, keys, colors, sparkline }: Props & { sparkline?: boolean }) {
  return (
    <div
      className={sparkline ? "kova-sparklines" : "grid grid-cols-2 gap-3 sm:grid-cols-3"}
      role="list"
      aria-label={sparkline ? "Sparklines" : "Small multiples"}
    >
      {keys.map((key, index) => {
        const values = numbersOf(spec.data, key);
        const last = values.at(-1);
        const first = values[0];
        return (
          <div
            key={key}
            role="listitem"
            className={sparkline ? "kova-sparkline-row" : "rounded-xl border border-border p-2"}
          >
            <span className="text-xs font-medium">{key}</span>
            <div className={sparkline ? "h-8 w-32" : "h-28 w-full"} aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spec.data}>
                  {!sparkline && <XAxis dataKey={xKey} tick={{ ...AXIS, fontSize: 10 }} />}
                  {!sparkline && <YAxis tick={{ ...AXIS, fontSize: 10 }} width={32} />}
                  <Line
                    dataKey={key}
                    stroke={colors[index % colors.length]}
                    strokeWidth={sparkline ? 1.5 : 2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {sparkline && last !== undefined && (
              <span className="text-xs tabular-nums">
                {fmt(last)}{" "}
                {first !== undefined && first !== 0 && (
                  <span className={last >= first ? "text-emerald-500" : "text-red-500"}>
                    {last >= first ? "▲" : "▼"}{" "}
                    {fmt(Math.abs(((last - first) / Math.abs(first)) * 100))}%
                  </span>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Circular, hierarchy, flow ---------------- */

const arcPath = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) => {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`;
  if (a1 - a0 >= 2 * Math.PI - 1e-6) a1 = a0 + 2 * Math.PI - 1e-6;
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
};

function PolarArea({ spec, xKey, keys, colors }: Props) {
  const rows = spec.data.filter(
    (row) => typeof row[keys[0]] === "number" && Number(row[keys[0]]) >= 0,
  );
  const max = Math.max(...rows.map((row) => Number(row[keys[0]])), 1e-12);
  const step = (2 * Math.PI) / rows.length;
  return (
    <Svg label="Polar area chart" viewBox="0 0 320 320">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={160} cy={160} r={140 * f} fill="none" stroke="var(--border)" />
      ))}
      {rows.map((row, index) => (
        <path
          key={index}
          d={arcPath(
            160,
            160,
            0,
            140 * Math.sqrt(Number(row[keys[0]]) / max),
            step * index,
            step * (index + 1) - 0.01,
          )}
          fill={colors[index % colors.length]}
          fillOpacity={0.75}
          stroke="var(--card)"
        >
          <title>{`${row[xKey]}: ${fmt(Number(row[keys[0]]))}`}</title>
        </path>
      ))}
    </Svg>
  );
}

function Hierarchy({ spec, xKey, keys, colors, sunburst }: Props & { sunburst?: boolean }) {
  const root = pathHierarchy(spec.data, xKey, keys[0]);
  if (!root) return null;
  const { nodes, depth } = partition(root);
  const topColor = (path: string) => {
    const top = path.split("/")[0];
    return colors[
      Math.max(
        0,
        root.children.findIndex((child) => child.name === top),
      ) % colors.length
    ];
  };
  if (sunburst) {
    const ring = 150 / (depth + 0.5);
    return (
      <Svg label="Sunburst chart" viewBox="0 0 340 340">
        {nodes.map((node) => (
          <path
            key={node.path}
            d={arcPath(
              170,
              170,
              ring * (node.depth - 0.5),
              ring * (node.depth + 0.5) - 1,
              node.x0 * 2 * Math.PI,
              node.x1 * 2 * Math.PI - 0.004,
            )}
            fill={topColor(node.path)}
            fillOpacity={1 - (node.depth - 1) * 0.2}
            stroke="var(--card)"
          >
            <title>{`${node.path}: ${fmt(node.value)} (${fmt((node.value / root.value) * 100)}%)`}</title>
          </path>
        ))}
        <text x={170} y={174} textAnchor="middle" fontSize="13" fill="var(--foreground)">
          {fmt(root.value)}
        </text>
      </Svg>
    );
  }
  const height = 280 / depth;
  return (
    <Svg label="Icicle chart" viewBox="0 0 620 290">
      {nodes.map((node) => {
        const x = 10 + node.x0 * 600;
        const w = Math.max(0, (node.x1 - node.x0) * 600 - 1);
        const y = 5 + (node.depth - 1) * height;
        return (
          <g key={node.path}>
            <rect
              x={x}
              y={y}
              width={w}
              height={height - 2}
              rx={3}
              fill={topColor(node.path)}
              fillOpacity={1 - (node.depth - 1) * 0.2}
            >
              <title>{`${node.path}: ${fmt(node.value)}`}</title>
            </rect>
            {w > 50 && (
              <text
                x={x + 6}
                y={y + 16}
                fontSize="12"
                fill="#000"
                stroke="#fff"
                strokeWidth={3}
                strokeOpacity={0.55}
                paintOrder="stroke"
              >
                {node.name.length * 7 > w - 10
                  ? `${node.name.slice(0, Math.max(1, Math.floor((w - 16) / 7)))}…`
                  : node.name}
              </text>
            )}
          </g>
        );
      })}
    </Svg>
  );
}

function Chord({ spec, colors }: Props) {
  const layout = chordLayout(spec.data);
  if (!layout) return null;
  const r = 130;
  const point = (a: number, radius = r) =>
    `${170 + radius * Math.sin(a)} ${170 - radius * Math.cos(a)}`;
  return (
    <Svg label="Chord diagram" viewBox="0 0 340 340">
      {layout.ribbons.map((ribbon, index) => (
        <path
          key={index}
          d={`M${point(ribbon.from[0])}A${r} ${r} 0 0 1 ${point(ribbon.from[1])}Q170 170 ${point(ribbon.to[0])}A${r} ${r} 0 0 1 ${point(ribbon.to[1])}Q170 170 ${point(ribbon.from[0])}Z`}
          fill={colors[ribbon.group % colors.length]}
          fillOpacity={0.45}
          stroke={colors[ribbon.group % colors.length]}
          strokeOpacity={0.6}
        >
          <title>{`${ribbon.source} → ${ribbon.target}: ${fmt(ribbon.value)}`}</title>
        </path>
      ))}
      {layout.groups.map((group, index) => {
        const mid = (group.start + group.end) / 2;
        return (
          <g key={group.name}>
            <path
              d={arcPath(170, 170, r + 2, r + 14, group.start, group.end)}
              fill={colors[index % colors.length]}
            >
              <title>{`${group.name}: ${fmt(group.value)}`}</title>
            </path>
            <text
              x={170 + (r + 22) * Math.sin(mid)}
              y={174 - (r + 22) * Math.cos(mid)}
              textAnchor={Math.sin(mid) >= 0 ? "start" : "end"}
              fontSize="11"
              fill="var(--muted-foreground)"
            >
              {group.name}
            </text>
          </g>
        );
      })}
    </Svg>
  );
}

function Alluvial({ spec, colors }: Props) {
  const flow = sankeyData({ ...spec, type: "sankey" });
  if (!flow) return null;
  return (
    <Frame label="Alluvial flow diagram">
      <Sankey
        data={flow}
        nodePadding={18}
        nodeWidth={10}
        node={{ fill: colors[0] }}
        link={{ stroke: colors[1] ?? colors[0], strokeOpacity: 0.3 }}
      >
        {TIP}
      </Sankey>
    </Frame>
  );
}

/* ---------------- Time ---------------- */

function CalendarHeatmap({ spec, xKey, keys }: Props) {
  const cells = calendarCells(spec.data, xKey, keys[0]) ?? [];
  const values = cells.map((cell) => cell.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const weeks = Math.max(...cells.map((cell) => cell.week)) + 1;
  const size = 13;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${weeks * size + 40} ${7 * size + 20}`}
        style={{ minWidth: Math.min(weeks * size + 40, 720) }}
        className="block h-auto w-full"
        role="img"
        aria-label="Calendar heatmap"
      >
        {["Mon", "Wed", "Fri"].map((day, index) => (
          <text
            key={day}
            x={0}
            y={20 + (index * 2 + 1) * size - 3}
            fontSize="9"
            fill="var(--muted-foreground)"
          >
            {day}
          </text>
        ))}
        {cells.map((cell) => (
          <rect
            key={cell.day}
            x={30 + cell.week * size}
            y={10 + ((cell.weekday + 6) % 7) * size}
            width={size - 2}
            height={size - 2}
            rx={2}
            fill={`color-mix(in srgb, var(--primary) ${Math.round(15 + ((cell.value - min) / (max - min || 1)) * 85)}%, var(--card))`}
          >
            <title>{`${cell.date}: ${fmt(cell.value)}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

function timeValue(value: unknown) {
  return typeof value === "number" ? value : dayNumber(value);
}

function Gantt({ spec, xKey, colors, timeline }: Props & { timeline?: boolean }) {
  const rows = spec.data
    .map((row) => ({
      label: String(row[xKey] ?? ""),
      start: timeValue(timeline ? (row.date ?? row.start) : row.start),
      end: timeValue(timeline ? (row.date ?? row.start) : row.end),
      raw: row,
    }))
    .filter((row) => row.start !== null && row.end !== null) as {
    label: string;
    start: number;
    end: number;
    raw: Record<string, string | number>;
  }[];
  const min = Math.min(...rows.map((row) => row.start));
  const max = Math.max(...rows.map((row) => row.end));
  const x = (value: number) => 140 + ((value - min) / (max - min || 1)) * 460;
  const dates = rows.some((row) => typeof (row.raw.date ?? row.raw.start) === "string");
  const label = (value: number) =>
    dates ? new Date(value * 864e5).toISOString().slice(0, 10) : fmt(value);
  if (timeline)
    return (
      <Svg label="Timeline" viewBox={`0 0 620 ${Math.max(120, rows.length * 28 + 50)}`}>
        <line x1={140} x2={600} y1={30} y2={30} stroke="var(--border)" strokeWidth={2} />
        {rows
          .sort((a, b) => a.start - b.start)
          .map((row, index) => (
            <g key={index}>
              <circle cx={x(row.start)} cy={30} r={6} fill={colors[index % colors.length]}>
                <title>{`${label(row.start)}: ${row.label}`}</title>
              </circle>
              <line
                x1={x(row.start)}
                x2={x(row.start)}
                y1={36}
                y2={52 + index * 28}
                stroke="var(--border)"
                strokeDasharray="2 3"
              />
              <text
                x={x(row.start) > 400 ? x(row.start) - 6 : x(row.start) + 6}
                y={56 + index * 28}
                textAnchor={x(row.start) > 400 ? "end" : "start"}
                fontSize="12"
                fill="var(--foreground)"
              >
                {`${label(row.start)} · ${row.label}`.slice(0, 70)}
              </text>
            </g>
          ))}
      </Svg>
    );
  return (
    <Svg label="Gantt chart" viewBox={`0 0 620 ${rows.length * 32 + 40}`}>
      {[min, (min + max) / 2, max].map((tick) => (
        <g key={tick}>
          <line
            x1={x(tick)}
            x2={x(tick)}
            y1={10}
            y2={rows.length * 32 + 14}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <text
            x={x(tick)}
            y={rows.length * 32 + 30}
            textAnchor="middle"
            fontSize="11"
            fill="var(--muted-foreground)"
          >
            {label(Math.round(tick))}
          </text>
        </g>
      ))}
      {rows.map((row, index) => (
        <g key={index}>
          <text x={132} y={30 + index * 32} textAnchor="end" fontSize="12" fill="var(--foreground)">
            {row.label.slice(0, 20)}
          </text>
          <rect
            x={x(row.start)}
            y={14 + index * 32}
            width={Math.max(4, x(row.end) - x(row.start))}
            height={22}
            rx={5}
            fill={colors[index % colors.length]}
          >
            <title>{`${row.label}: ${label(row.start)} → ${label(row.end)}`}</title>
          </rect>
        </g>
      ))}
    </Svg>
  );
}

/* ---------------- Financial ---------------- */

function Ohlc({ spec, xKey, colors, volume }: Props & { volume?: boolean }) {
  const rows = spec.data.filter((row) =>
    ["open", "high", "low", "close"].every((key) => typeof row[key] === "number"),
  );
  const low = Math.min(...rows.map((row) => Number(row.low)));
  const high = Math.max(...rows.map((row) => Number(row.high)));
  const top = volume ? 190 : 260;
  const y = (value: number) => 10 + (1 - (value - low) / (high - low || 1)) * (top - 10);
  const vmax = Math.max(...rows.map((row) => Number(row.volume) || 0), 1);
  const step = 560 / rows.length;
  return (
    <Svg label={volume ? "Price and volume chart" : "OHLC chart"} viewBox="0 0 620 290">
      <path d={`M40 10V${top}H600`} fill="none" stroke="var(--border)" />
      {[low, high].map((tick) => (
        <text
          key={tick}
          x={34}
          y={y(tick) + 4}
          textAnchor="end"
          fontSize="11"
          fill="var(--muted-foreground)"
        >
          {fmt(tick)}
        </text>
      ))}
      {rows.map((row, index) => {
        const cx = 40 + step * index + step / 2;
        const up = Number(row.close) >= Number(row.open);
        const color = up ? "#10b981" : "#ef4444";
        return (
          <g key={index}>
            <title>{`${row[xKey] ?? index + 1}: O ${row.open} H ${row.high} L ${row.low} C ${row.close}${volume ? ` V ${row.volume ?? "—"}` : ""}`}</title>
            <line
              x1={cx}
              x2={cx}
              y1={y(Number(row.high))}
              y2={y(Number(row.low))}
              stroke={color}
              strokeWidth={1.5}
            />
            <line
              x1={cx - Math.min(6, step / 3)}
              x2={cx}
              y1={y(Number(row.open))}
              y2={y(Number(row.open))}
              stroke={color}
              strokeWidth={1.5}
            />
            <line
              x1={cx}
              x2={cx + Math.min(6, step / 3)}
              y1={y(Number(row.close))}
              y2={y(Number(row.close))}
              stroke={color}
              strokeWidth={1.5}
            />
            {volume && typeof row.volume === "number" && (
              <rect
                x={cx - Math.max(1, step * 0.35)}
                width={Math.max(2, step * 0.7)}
                y={280 - (row.volume / vmax) * 75}
                height={(row.volume / vmax) * 75}
                fill={colors[0]}
                fillOpacity={0.45}
              />
            )}
          </g>
        );
      })}
    </Svg>
  );
}

/* ---------------- Fields, contours and 3-D ---------------- */

function Contour({ spec, colors }: Props) {
  const grid = gridFromRows(spec.data);
  if (!grid) return null;
  const values = grid.z.flat();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const cw = 560 / (grid.xs.length - 1);
  const ch = 240 / (grid.ys.length - 1);
  const levels = contourLevels(grid, 7);
  return (
    <Svg label="Contour plot" viewBox="0 0 620 290" note={`Levels: ${levels.map(fmt).join(", ")}`}>
      {grid.z.map((line, j) =>
        line.map((value, i) => (
          <rect
            key={`${i}-${j}`}
            x={40 + (i - 0.5) * cw}
            y={10 + (grid.ys.length - 1 - j - 0.5) * ch}
            width={cw + 0.5}
            height={ch + 0.5}
            fill={`color-mix(in srgb, ${colors[0]} ${Math.round(((value - min) / (max - min || 1)) * 80)}%, var(--card))`}
          >
            <title>{`x ${fmt(grid.xs[i])}, y ${fmt(grid.ys[j])}: ${fmt(value)}`}</title>
          </rect>
        )),
      )}
      {levels.map((level) =>
        contourSegments(grid, level).map(([[x1, y1], [x2, y2]], index) => (
          <line
            key={`${level}-${index}`}
            x1={40 + x1 * cw}
            y1={10 + (grid.ys.length - 1 - y1) * ch}
            x2={40 + x2 * cw}
            y2={10 + (grid.ys.length - 1 - y2) * ch}
            stroke="var(--foreground)"
            strokeOpacity={0.55}
            strokeWidth={1}
          />
        )),
      )}
      <text
        x={40}
        y={284}
        fontSize="11"
        fill="var(--muted-foreground)"
      >{`x ${fmt(grid.xs[0])} → ${fmt(grid.xs.at(-1)!)} · y ${fmt(grid.ys[0])} → ${fmt(grid.ys.at(-1)!)}`}</text>
    </Svg>
  );
}

function VectorField({ spec, colors }: Props) {
  const rows = spec.data.filter((row) =>
    ["x", "y", "dx", "dy"].every((key) => typeof row[key] === "number"),
  );
  const xs = rows.map((row) => Number(row.x));
  const ys = rows.map((row) => Number(row.y));
  const nx = normaliser(xs);
  const ny = normaliser(ys);
  const longest = Math.max(...rows.map((row) => Math.hypot(Number(row.dx), Number(row.dy))), 1e-12);
  const cell = 520 / Math.sqrt(rows.length);
  const markerId = useId().replace(/:/g, "");
  return (
    <Svg label="Vector field" viewBox="0 0 620 320">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0L10 5L0 10Z" fill={colors[0]} />
        </marker>
      </defs>
      {rows.map((row, index) => {
        const x = 310 + nx(Number(row.x)) * 540;
        const y = 160 - ny(Number(row.y)) * 280;
        const scale = (cell * 0.8) / longest;
        return (
          <line
            key={index}
            x1={x}
            y1={y}
            x2={x + Number(row.dx) * scale}
            y2={y - Number(row.dy) * scale}
            stroke={colors[0]}
            strokeWidth={1.5}
            markerEnd={`url(#${markerId})`}
          >
            <title>{`(${row.x}, ${row.y}) → (${row.dx}, ${row.dy})`}</title>
          </line>
        );
      })}
    </Svg>
  );
}

function ThreeD({ spec, type, colors }: Props) {
  const [yaw, setYaw] = useState(0.7);
  const [pitch, setPitch] = useState(0.45);
  const yawId = useId();
  const pitchId = useId();
  const rows = spec.data.filter((row) =>
    ["x", "y", "z"].every((key) => typeof row[key] === "number"),
  );
  const nx = normaliser(rows.map((row) => Number(row.x)));
  const ny = normaliser(rows.map((row) => Number(row.y)));
  const nz = normaliser(rows.map((row) => Number(row.z)));
  const zs = rows.map((row) => Number(row.z));
  const zmin = Math.min(...zs);
  const zmax = Math.max(...zs);
  const toScreen = (x: number, y: number, z: number) => {
    const p = project3d([nx(x), ny(y), nz(z)], yaw, pitch);
    return { x: 310 + p.x * 360, y: 170 + p.y * 300, depth: p.depth };
  };
  const grid = type === "scatter-3d" ? null : gridFromRows(spec.data);
  const cube = [-0.5, 0.5].flatMap((a) => [-0.5, 0.5].map((b) => [a, b] as const));
  const axisEdges: [[number, number, number], [number, number, number]][] = [
    ...cube.map(
      ([a, b]) =>
        [
          [-0.5, a, b],
          [0.5, a, b],
        ] as [[number, number, number], [number, number, number]],
    ),
    ...cube.map(
      ([a, b]) =>
        [
          [a, -0.5, b],
          [a, 0.5, b],
        ] as [[number, number, number], [number, number, number]],
    ),
    ...cube.map(
      ([a, b]) =>
        [
          [a, b, -0.5],
          [a, b, 0.5],
        ] as [[number, number, number], [number, number, number]],
    ),
  ];
  const raw = (p: [number, number, number]) => {
    const q = project3d(p, yaw, pitch);
    return { x: 310 + q.x * 360, y: 170 + q.y * 300 };
  };
  const shade = (z: number) =>
    `color-mix(in srgb, ${colors[0]} ${Math.round(25 + ((z - zmin) / (zmax - zmin || 1)) * 75)}%, var(--card))`;
  let marks: ReactNode;
  if (grid) {
    const quads = [];
    for (let j = 0; j < grid.ys.length - 1; j++)
      for (let i = 0; i < grid.xs.length - 1; i++) {
        const corners = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ].map(([a, b]) => toScreen(grid.xs[a], grid.ys[b], grid.z[b][a]));
        const zAvg =
          (grid.z[j][i] + grid.z[j][i + 1] + grid.z[j + 1][i + 1] + grid.z[j + 1][i]) / 4;
        quads.push({
          corners,
          depth: corners.reduce((sum, c) => sum + c.depth, 0) / 4,
          zAvg,
          key: `${i}-${j}`,
        });
      }
    quads.sort((a, b) => a.depth - b.depth);
    marks = quads.map((quad) => (
      <path
        key={quad.key}
        d={`M${quad.corners.map((c) => `${c.x} ${c.y}`).join("L")}Z`}
        fill={type === "mesh" ? "none" : shade(quad.zAvg)}
        stroke={type === "mesh" ? colors[0] : "var(--card)"}
        strokeWidth={0.6}
      />
    ));
  } else {
    marks = rows
      .map((row, index) => ({
        ...toScreen(Number(row.x), Number(row.y), Number(row.z)),
        row,
        index,
      }))
      .sort((a, b) => a.depth - b.depth)
      .map((point) => (
        <circle
          key={point.index}
          cx={point.x}
          cy={point.y}
          r={4}
          fill={shade(Number(point.row.z))}
          stroke={colors[0]}
        >
          <title>{`x ${point.row.x}, y ${point.row.y}, z ${point.row.z}`}</title>
        </circle>
      ));
  }
  return (
    <div dir="ltr" className="kova-chart-extra">
      <svg
        viewBox="0 0 620 340"
        className="block h-auto w-full"
        role="img"
        aria-label={`${type === "scatter-3d" ? "3-D scatter" : type === "mesh" ? "3-D mesh" : "3-D surface"} plot`}
      >
        {axisEdges.map(([a, b], index) => {
          const p = raw(a);
          const q = raw(b);
          return (
            <line
              key={index}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke="var(--border)"
              strokeDasharray="2 4"
            />
          );
        })}
        {marks}
        {(["x", "y", "z"] as const).map((axis, index) => {
          const end: [number, number, number] = [
            index === 0 ? 0.6 : -0.5,
            index === 1 ? 0.6 : -0.5,
            index === 2 ? 0.6 : -0.5,
          ];
          const p = raw(end);
          return (
            <text key={axis} x={p.x} y={p.y} fontSize="12" fill="var(--muted-foreground)">
              {axis}
            </text>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <label htmlFor={yawId} className="flex items-center gap-2">
          Rotate
          <input
            id={yawId}
            type="range"
            min={-3.14}
            max={3.14}
            step={0.02}
            value={yaw}
            onChange={(event) => setYaw(Number(event.target.value))}
          />
        </label>
        <label htmlFor={pitchId} className="flex items-center gap-2">
          Tilt
          <input
            id={pitchId}
            type="range"
            min={0}
            max={1.4}
            step={0.02}
            value={pitch}
            onChange={(event) => setPitch(Number(event.target.value))}
          />
        </label>
      </div>
    </div>
  );
}

/* ---------------- Geographic ---------------- */

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States of America",
  us: "United States of America",
  "united states": "United States of America",
  america: "United States of America",
  uk: "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  russia: "Russia",
  "south korea": "South Korea",
  "north korea": "North Korea",
  "czech republic": "Czechia",
  "ivory coast": "Côte d'Ivoire",
  drc: "Dem. Rep. Congo",
  "democratic republic of the congo": "Dem. Rep. Congo",
  "dominican republic": "Dominican Rep.",
  "bosnia and herzegovina": "Bosnia and Herz.",
  "central african republic": "Central African Rep.",
  "south sudan": "S. Sudan",
  uae: "United Arab Emirates",
};

type GeoFeature = { id?: string | number; properties: { name: string }; geometry: unknown };
type GeoModule = {
  path: (feature: GeoFeature) => string | null;
  point: (lon: number, lat: number) => [number, number] | null;
  features: GeoFeature[];
  scope: "world" | "us";
};

async function loadGeo(scope: "world" | "us"): Promise<GeoModule> {
  const [{ geoAlbersUsa, geoNaturalEarth1, geoPath }, { feature }, atlas] = await Promise.all([
    import("d3-geo"),
    import("topojson-client"),
    scope === "us" ? import("us-atlas/states-10m.json") : import("world-atlas/countries-110m.json"),
  ]);
  const topology = (atlas as { default?: unknown }).default ?? atlas;
  const object = (topology as { objects: Record<string, unknown> }).objects[
    scope === "us" ? "states" : "countries"
  ];
  const collection = feature(topology as never, object as never) as unknown as {
    features: GeoFeature[];
  };
  const projection = (scope === "us" ? geoAlbersUsa() : geoNaturalEarth1()).fitSize(
    [600, 320],
    collection as never,
  );
  const path = geoPath(projection);
  return {
    path: (item) => path(item as never),
    point: (lon, lat) => projection([lon, lat]) ?? null,
    features: collection.features,
    scope,
  };
}

function GeoChart({ spec, type, xKey, keys, colors }: Props) {
  const regions = spec.data.map((row) =>
    String(row[xKey] ?? "")
      .trim()
      .toLowerCase(),
  );
  const usStates = new Set([
    "california",
    "texas",
    "new york",
    "florida",
    "massachusetts",
    "washington",
    "illinois",
    "ohio",
    "georgia",
    "pennsylvania",
  ]);
  const scope: "world" | "us" =
    type === "choropleth"
      ? regions.filter((name) => usStates.has(name) || /^[a-z]{2}$/.test(name)).length >
          regions.length / 2 &&
        !regions.some((name) =>
          ["usa", "us", "united states", "china", "india", "france", "germany", "canada"].includes(
            name,
          ),
        )
        ? "us"
        : "world"
      : spec.data.every((row) => {
            const lat = Number(row.lat);
            const lon = Number(row.lon ?? row.lng);
            return lat > 18 && lat < 72 && lon > -170 && lon < -60;
          })
        ? "us"
        : "world";
  const [geo, setGeo] = useState<GeoModule | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    loadGeo(scope)
      .then((module) => live && setGeo(module))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [scope]);
  if (error)
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        The map outlines could not load. The data is in the table.
      </p>
    );
  if (!geo)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading map…
      </p>
    );
  const valueKey = keys[0];
  const values = new Map<string, number>();
  for (const row of spec.data) {
    const name = String(row[xKey] ?? "")
      .trim()
      .toLowerCase();
    const value = row[valueKey];
    if (typeof value === "number") values.set(COUNTRY_ALIASES[name]?.toLowerCase() ?? name, value);
  }
  const nums = [...values.values()];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const points = spec.data
    .map((row) => ({ row, at: geo.point(Number(row.lon ?? row.lng), Number(row.lat)) }))
    .filter(
      (item): item is { row: Record<string, string | number>; at: [number, number] } => !!item.at,
    );
  const sizes = points.map((p) => Number(p.row[valueKey]) || 1);
  const smax = Math.max(...sizes, 1);
  const unmatched =
    type === "choropleth"
      ? [...values.keys()].filter(
          (name) => !geo.features.some((f) => f.properties.name.toLowerCase() === name),
        )
      : [];
  return (
    <Svg
      label={`${type.replace("-", " ")} of ${geo.scope === "us" ? "the United States" : "the world"}`}
      viewBox="0 0 600 320"
      note={
        unmatched.length
          ? `Not on the map: ${unmatched.slice(0, 6).join(", ")}${unmatched.length > 6 ? "…" : ""}`
          : undefined
      }
    >
      {geo.features.map((item, index) => {
        const value = values.get(item.properties.name.toLowerCase());
        return (
          <path
            key={String(item.id ?? index)}
            d={geo.path(item) ?? ""}
            fill={
              type === "choropleth" && value !== undefined
                ? `color-mix(in srgb, ${colors[0]} ${Math.round(20 + ((value - min) / (max - min || 1)) * 80)}%, var(--card))`
                : "color-mix(in srgb, var(--muted-foreground) 14%, var(--card))"
            }
            stroke="var(--card)"
            strokeWidth={0.5}
          >
            <title>
              {value !== undefined
                ? `${item.properties.name}: ${fmt(value)}`
                : item.properties.name}
            </title>
          </path>
        );
      })}
      {type === "route-map" && points.length > 1 && (
        <polyline
          points={points.map((p) => p.at.join(",")).join(" ")}
          fill="none"
          stroke={colors[1] ?? colors[0]}
          strokeWidth={2}
          strokeDasharray="5 4"
        />
      )}
      {type !== "choropleth" &&
        points.map(({ row, at }, index) => (
          <circle
            key={index}
            cx={at[0]}
            cy={at[1]}
            r={
              type === "density-map"
                ? 18
                : 3 + (Number(row[valueKey]) > 0 ? Math.sqrt(Number(row[valueKey]) / smax) * 9 : 2)
            }
            fill={colors[0]}
            fillOpacity={type === "density-map" ? 0.12 : 0.8}
            stroke={type === "density-map" ? "none" : "var(--card)"}
          >
            <title>{`${row[xKey] ?? `Point ${index + 1}`}${typeof row[valueKey] === "number" ? `: ${fmt(Number(row[valueKey]))}` : ""}`}</title>
          </circle>
        ))}
    </Svg>
  );
}

/* ---------------- Router ---------------- */

export function ChatChartExtra(props: Props) {
  const content = useMemo(() => {
    switch (props.type) {
      case "box":
        return <BoxPlot {...props} />;
      case "violin":
        return <BoxPlot {...props} violin />;
      case "density":
        return <DensityPlot {...props} />;
      case "ridgeline":
        return <DensityPlot {...props} ridgeline />;
      case "strip":
        return <StripPlot {...props} />;
      case "sparkline":
        return <SmallMultiples {...props} sparkline />;
      case "small-multiples":
        return <SmallMultiples {...props} />;
      case "polar-area":
        return <PolarArea {...props} />;
      case "sunburst":
        return <Hierarchy {...props} sunburst />;
      case "icicle":
        return <Hierarchy {...props} />;
      case "chord":
        return <Chord {...props} />;
      case "alluvial":
        return <Alluvial {...props} />;
      case "calendar-heatmap":
        return <CalendarHeatmap {...props} />;
      case "gantt":
        return <Gantt {...props} />;
      case "timeline":
        return <Gantt {...props} timeline />;
      case "ohlc":
        return <Ohlc {...props} />;
      case "volume":
        return <Ohlc {...props} volume />;
      case "contour":
        return <Contour {...props} />;
      case "vector-field":
        return <VectorField {...props} />;
      case "surface":
      case "mesh":
      case "scatter-3d":
        return <ThreeD {...props} />;
      case "choropleth":
      case "point-map":
      case "route-map":
      case "density-map":
        return <GeoChart {...props} />;
      default:
        return <Cartesian {...props} />;
    }
  }, [props]);
  return (
    content ?? (
      // A family that can't draw this data falls back to a plain line chart of its numbers.
      <Frame label="Line chart">
        <LineChart data={props.spec.data}>
          {GRID}
          <XAxis dataKey={props.xKey} tick={AXIS} />
          <YAxis tick={AXIS} />
          {TIP}
          {props.keys.map((key, index) => (
            <Line
              key={key}
              dataKey={key}
              stroke={props.colors[index % props.colors.length]}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </Frame>
    )
  );
}
