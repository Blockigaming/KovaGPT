import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { readAppleHealthExport, type AppleHealthAnalytics } from "@/health/apple-health-export.mjs";
import { APPLE_HEALTH_DAY_MS, APPLE_HEALTH_HISTORY_DAYS } from "@/health/apple-health-metrics.mjs";
import type { NativeHealthLive } from "@/health/use-apple-health-live";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

type TrendMetric = {
  id: string;
  label: string;
  group: string;
  unit: string;
  aggregation: string;
  categories?: Record<string, string>;
};

export function HealthTrends({
  report,
  catalog,
}: {
  report: AppleHealthAnalytics;
  catalog: readonly TrendMetric[];
}) {
  const [groupId, setGroupId] = useState("");
  const [range, setRange] = useState(7);
  const available = catalog.filter((metric) => report.metrics[metric.id]?.length);
  const groups = [...new Set(available.map((metric) => metric.group))];
  const group = groups.includes(groupId) ? groupId : groups[0];
  if (!group) return null;
  const rangeLabel = range === APPLE_HEALTH_HISTORY_DAYS ? "1 year" : `${range} days`;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <Tabs value={group} onValueChange={setGroupId}>
        <TabsList
          aria-label="Metric categories"
          className="spec400-plugin-tabs kova-health-selector"
        >
          {groups.map((item) => (
            <TabsTrigger key={item} value={item}>
              {item}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          key={group}
          value={group}
          className="mt-3 min-w-0 space-y-4 sm:mt-6 sm:space-y-6"
        >
          <label className="block rounded-2xl bg-card px-4 py-3 sm:px-5">
            <span className="flex justify-between gap-4 text-sm font-medium">
              Date range <span className="tabular-nums">{rangeLabel}</span>
            </span>
            <input
              type="range"
              aria-label="Date range"
              aria-valuetext={rangeLabel}
              min={7}
              max={APPLE_HEALTH_HISTORY_DAYS}
              value={range}
              onChange={(event) => setRange(event.currentTarget.valueAsNumber)}
              style={
                {
                  "--kova-health-range-track": `linear-gradient(to right, var(--kova-reading-accent) ${((range - 7) / (APPLE_HEALTH_HISTORY_DAYS - 7)) * 100}%, color-mix(in srgb, var(--foreground) 33%, var(--card)) 0)`,
                } as CSSProperties
              }
              className="kova-health-range block h-11 w-full cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <span aria-hidden="true" className="flex justify-between text-xs text-muted-foreground">
              <span>7 days</span>
              <span>1 year</span>
            </span>
          </label>
          {available
            .filter((metric) => metric.group === group)
            .map((metric) => (
              <HealthMetric key={metric.id} metric={metric} report={report} range={range} />
            ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HealthMetric({
  metric,
  report,
  range,
}: {
  metric: TrendMetric;
  report: AppleHealthAnalytics;
  range: number;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const chartPress = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  useEffect(() => {
    setSelectedDate(null);
  }, [metric.id, range, sourceIndex]);
  const sources = report.metrics[metric.id] ?? [];
  const source = sources[sourceIndex] ?? sources[0];
  const values = new Map(source.days.map(({ date, value }) => [date, value]));
  const end = Date.parse(report.asOf + "T00:00:00Z");
  const series = Array.from({ length: range }, (_, index) => {
    const date = new Date(end - (range - index - 1) * APPLE_HEALTH_DAY_MS)
      .toISOString()
      .slice(0, 10);
    return { date, value: values.get(date) ?? null };
  });
  const days = series.filter((day): day is { date: string; value: number } => day.value !== null);
  const measured = days.map(({ value }) => value);
  const categoryLabels = metric.categories ? Object.values(metric.categories) : null;
  const axisWidth = categoryLabels || metric.unit === "clock" ? 90 : 42;
  const chartMargin = 5;
  const selectedIndex = series.findIndex(({ date }) => date === selectedDate);
  const selectedReading = series[selectedIndex];
  const lastIndex = series.length - 1;
  function scrubChart(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const plotWidth = bounds.width - axisWidth - 2 * chartMargin;
    if (plotWidth <= 0) return;
    const fraction = (event.clientX - bounds.left - axisWidth - chartMargin) / plotWidth;
    const index = Math.max(
      0,
      Math.min(series.length - 1, Math.round(fraction * (series.length - 1))),
    );
    setSelectedDate(series[index].date);
  }

  const format = (value: number) => {
    if (categoryLabels) return categoryLabels[value] ?? "—";
    if (metric.unit === "clock") {
      const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
      const time = new Date(2000, 0, 1, 0, minutes);
      return time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    return `${number.format(value)} ${metric.unit}`.trim();
  };
  const readingText = (reading: (typeof series)[number]) =>
    `${reading.date} · ${reading.value === null ? "No reading" : format(reading.value)}`;
  const stats =
    categoryLabels || metric.unit === "clock"
      ? []
      : measured.length
        ? ([
            ["Latest day", measured[measured.length - 1]],
            [
              metric.aggregation === "sum" ? "Period total" : "Daily average",
              measured.reduce((total, value) => total + value, 0) /
                (metric.aggregation === "sum" ? 1 : measured.length),
            ],
            ["Highest day", Math.max(...measured)],
            ["Lowest day", Math.min(...measured)],
          ] as const)
        : [];
  const selectClass =
    "min-h-10 max-w-full rounded-lg border border-border bg-background px-3 text-sm";
  return (
    <section
      aria-label={metric.label}
      className="min-w-0 space-y-4 border-t border-border pt-4 [content-visibility:auto] [contain-intrinsic-size:auto_360px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{metric.label}</h3>
        {sources.length > 1 && (
          <select
            aria-label={metric.id === "StepCount" ? "Step source" : "Data source"}
            className={selectClass}
            value={sources.indexOf(source)}
            onChange={(event) => setSourceIndex(Number(event.currentTarget.value))}
          >
            {sources.map(({ name }, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No readings for this source in the selected range.
        </p>
      ) : (
        <>
          {stats.length > 0 && (
            <dl className="grid grid-cols-2 gap-2 border-b border-border pb-4 sm:grid-cols-4">
              {stats.map(([label, value]) => (
                <div key={label} className="rounded-xl px-2 py-1.5">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-base font-medium tabular-nums">{format(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <div
            className="h-48 min-w-0 touch-pan-y rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="health-timeline"
            role="slider"
            tabIndex={0}
            aria-label={`${metric.label} timeline`}
            aria-valuemin={0}
            aria-valuemax={lastIndex}
            aria-valuenow={selectedIndex < 0 ? lastIndex : selectedIndex}
            aria-valuetext={readingText(selectedReading ?? series[lastIndex])}
            onKeyDown={(event) => {
              const index = selectedIndex < 0 ? lastIndex : selectedIndex;
              const nextIndex = {
                ArrowLeft: index - 1,
                ArrowDown: index - 1,
                ArrowRight: index + 1,
                ArrowUp: index + 1,
                Home: 0,
                End: lastIndex,
              }[event.key];
              if (nextIndex === undefined) return;
              event.preventDefault();
              setSelectedDate(series[Math.max(0, Math.min(lastIndex, nextIndex))].date);
            }}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              chartPress.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                dragging: false,
              };
            }}
            onPointerMove={(event) => {
              const press = chartPress.current;
              if (!press || press.id !== event.pointerId) return;
              if (!press.dragging) {
                const horizontal = Math.abs(event.clientX - press.x);
                const vertical = Math.abs(event.clientY - press.y);
                if (vertical > 8 && vertical > horizontal) {
                  chartPress.current = null;
                  return;
                }
                if (horizontal < 8) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                press.dragging = true;
              }
              scrubChart(event);
            }}
            onPointerUp={(event) => {
              if (chartPress.current?.id !== event.pointerId) return;
              chartPress.current = null;
              scrubChart(event);
            }}
            onPointerCancel={() => {
              chartPress.current = null;
            }}
            onPointerLeave={() => {
              if (!chartPress.current?.dragging) chartPress.current = null;
            }}
            onLostPointerCapture={(event) => {
              // A touch starts with implicit capture on the chart element.
              // Only clear the gesture when the timeline itself loses capture.
              if (
                event.target === event.currentTarget &&
                chartPress.current?.id === event.pointerId
              ) {
                chartPress.current = null;
              }
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{
                  top: chartMargin,
                  right: chartMargin,
                  bottom: chartMargin,
                  left: chartMargin,
                }}
              >
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) => date.slice(5)}
                  fontSize={11}
                  minTickGap={10}
                  tick={{ fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  width={axisWidth}
                  fontSize={11}
                  tick={{ fill: "var(--muted-foreground)" }}
                  tickFormatter={categoryLabels || metric.unit === "clock" ? format : undefined}
                  ticks={categoryLabels ? categoryLabels.map((_, index) => index) : undefined}
                  domain={categoryLabels ? [0, categoryLabels.length - 1] : undefined}
                />
                <Tooltip
                  formatter={(value) => (value === undefined ? "" : format(Number(value)))}
                  contentStyle={{
                    background: "var(--background)",
                    borderColor: "var(--border)",
                    borderRadius: 12,
                  }}
                />
                {selectedReading && (
                  <ReferenceLine
                    x={selectedReading.date}
                    stroke="var(--color-rose-500)"
                    strokeDasharray="3 3"
                  />
                )}
                <Line
                  name={metric.label}
                  dataKey="value"
                  stroke="var(--color-rose-500)"
                  strokeWidth={2.5}
                  dot={days.length <= 7}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p
            className="min-h-5 text-xs tabular-nums text-muted-foreground"
            data-testid="health-timeline-reading"
          >
            {selectedReading && readingText(selectedReading)}
          </p>
          <table className="mt-2 w-full text-left text-sm">
            <caption className="sr-only">Daily {metric.label.toLowerCase()}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="text-right">
                  {metric.label}
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map(({ date, value }) => (
                <tr key={date} className="border-t border-border">
                  <td className="py-1.5">
                    <time dateTime={date}>{date}</time>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {categoryLabels || metric.unit === "clock"
                      ? format(value)
                      : number.format(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function NativeHealthReport({
  ownerId,
  live,
  onReport,
}: {
  ownerId: string | null;
  live: NativeHealthLive;
  onReport: (report: AppleHealthAnalytics | null) => void;
}) {
  const [report, setReport] = useState<AppleHealthAnalytics | null>(null);
  const [status, setStatus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController>(null);
  const label = live.platform === "android" ? "Health Connect" : "Apple Health";
  const displayed = live.report ?? report;
  useEffect(() => {
    onReport(displayed);
  }, [displayed, onReport]);

  const clear = useCallback(() => {
    pending.current?.abort();
    setReport(null);
    setStatus("");
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", clear);
    return () => {
      pending.current?.abort();
      window.removeEventListener("pagehide", clear);
    };
  }, [clear]);

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !ownerId) return;
    clear();
    const controller = new AbortController();
    pending.current = controller;
    setStatus("Reading Apple Health file…");
    try {
      const next = await readAppleHealthExport(file, controller.signal);
      if (controller.signal.aborted) return;
      if (!Object.keys(next.metrics).length) {
        setStatus("This export contains no supported readings in its last 365 days.");
        return;
      }
      setReport(next);
      setStatus("");
    } catch {
      if (!controller.signal.aborted) {
        setStatus("Could not read the file. Choose the Apple Health export ZIP or export.xml.");
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="native-health-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="native-health-title" className="text-lg font-semibold">
            {label}
          </h3>
          {live.status && (
            <p role="status" className="text-sm text-muted-foreground">
              {live.status}
            </p>
          )}
          {live.updatedAt && (
            <p className="text-xs text-muted-foreground">
              Updated{" "}
              {new Date(live.updatedAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        {ownerId && (live.platform === "apple" || live.connected) && (
          <details className="relative shrink-0 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Connection options</summary>
            <div className="absolute top-full right-0 z-10 mt-2 grid min-w-52 gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-md">
              {live.platform === "apple" && (
                <>
                  <input
                    type="file"
                    accept=".zip,.xml,application/zip,application/xml,text/xml"
                    aria-label="Apple Health report file"
                    className="hidden"
                    ref={fileInput}
                    onChange={(event) => void readFile(event)}
                  />
                  <Button
                    variant="ghost"
                    className="justify-start"
                    onClick={() => fileInput.current?.click()}
                  >
                    Import Apple Health data
                  </Button>
                </>
              )}
              {report && (
                <Button variant="ghost" className="justify-start" onClick={clear}>
                  Clear imported data
                </Button>
              )}
              {live.connected && (
                <Button variant="ghost" className="justify-start" onClick={live.disconnect}>
                  Disconnect {label}
                </Button>
              )}
            </div>
          </details>
        )}
      </div>
      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
      {ownerId && live.connected && live.canWriteSteps && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer font-medium">Record steps</summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter steps you tracked yourself. The device asks you to confirm before saving and may
            request separate write permission.
          </p>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              live.recordSteps(
                Number(fields.get("steps")),
                new Date(String(fields.get("start"))).getTime(),
                new Date(String(fields.get("end"))).getTime(),
              );
            }}
          >
            <label className="grid min-w-0 gap-1 text-sm">
              Steps
              <Input name="steps" type="number" min={1} max={1_000_000} required />
            </label>
            <label className="grid min-w-0 gap-1 text-sm">
              Started at
              <Input name="start" type="datetime-local" required />
            </label>
            <label className="grid min-w-0 gap-1 text-sm">
              Ended at
              <Input name="end" type="datetime-local" required />
            </label>
            <Button type="submit" variant="outline" disabled={live.writingSteps}>
              {live.writingSteps ? "Waiting for device…" : "Review on device"}
            </Button>
          </form>
          {live.stepWriteStatus && (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {live.stepWriteStatus}
            </p>
          )}
        </details>
      )}
      {ownerId && live.platform && !live.connected && (
        <Button onClick={live.start} disabled={live.pending}>
          Connect {label}
        </Button>
      )}
    </section>
  );
}
