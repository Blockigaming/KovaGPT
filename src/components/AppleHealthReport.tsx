import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { readAppleHealthExport, type AppleHealthAnalytics } from "@/health/apple-health-export.mjs";
import { APPLE_HEALTH_DAY_MS, APPLE_HEALTH_METRICS } from "@/health/apple-health-metrics.mjs";
import { useAppleHealthLive } from "@/health/use-apple-health-live";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const ranges = [7, 30, 90] as const;
type Range = (typeof ranges)[number];

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
  const [metricId, setMetricId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [range, setRange] = useState<Range>(7);
  const available = catalog.filter((metric) => report.metrics[metric.id]?.length);
  const groups = [...new Set(available.map(({ group }) => group))];
  const priorityGroups = ["Activity", "Sleep", "Recovery", "Vitals"].filter((item) =>
    groups.includes(item),
  );
  const quickGroups =
    groups.length <= 4 ? groups : (priorityGroups.length ? priorityGroups : groups).slice(0, 3);
  const moreGroups = groups.filter((item) => !quickGroups.includes(item));
  const group = groups.includes(groupId) ? groupId : groups[0];
  const metrics = available.filter((metric) => metric.group === group);
  const metric = metrics.find((item) => item.id === metricId) ?? metrics[0];
  if (!metric) return null;

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
  const format = (value: number) => {
    if (categoryLabels) return categoryLabels[value] ?? "—";
    if (metric.unit === "clock") {
      const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
      const time = new Date(2000, 0, 1, 0, minutes);
      return time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    return `${number.format(value)} ${metric.unit}`.trim();
  };
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
  const pill = (selected: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${selected ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`;

  const selectGroup = (item: string) => {
    setGroupId(item);
    setMetricId("");
    setSourceIndex(0);
  };

  return (
    <div className="space-y-4">
      {groups.length > 1 && (
        <div
          aria-label="Metric categories"
          role="group"
          className="flex flex-wrap items-center gap-1"
        >
          {quickGroups.map((item) => (
            <button
              key={item}
              type="button"
              className={pill(item === group)}
              aria-pressed={item === group}
              onClick={() => selectGroup(item)}
            >
              {item}
            </button>
          ))}
          {moreGroups.length > 0 && (
            <select
              aria-label="More metric categories"
              className={pill(moreGroups.includes(group))}
              value={moreGroups.includes(group) ? group : ""}
              onChange={(event) => selectGroup(event.currentTarget.value)}
            >
              <option value="" disabled>
                More
              </option>
              {moreGroups.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          aria-label="Metric"
          className={selectClass}
          value={metric.id}
          onChange={(event) => {
            setMetricId(event.currentTarget.value);
            setSourceIndex(0);
          }}
        >
          {metrics.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
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
        <div aria-label="Date range" role="group" className="flex rounded-full bg-muted p-0.5">
          {ranges.map((value) => (
            <button
              type="button"
              key={value}
              aria-label={`${value} days`}
              aria-pressed={range === value}
              className={pill(range === value)}
              onClick={() => setRange(value)}
            >
              {value}D
            </button>
          ))}
        </div>
      </div>
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No readings for this source in the selected range.
        </p>
      ) : (
        <>
          {stats.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl bg-muted/40 px-4 py-3 sm:grid-cols-4">
              {stats.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-base font-medium tabular-nums">{format(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="h-48 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) => date.slice(5)}
                  fontSize={11}
                  minTickGap={10}
                  tick={{ fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  width={categoryLabels || metric.unit === "clock" ? 90 : 42}
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
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Daily readings · {days.length} of {range} days
            </summary>
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
          </details>
        </>
      )}
    </div>
  );
}

export function AppleHealthReport({
  ownerId,
  visible,
}: {
  ownerId: string | null;
  visible: boolean;
}) {
  const [report, setReport] = useState<AppleHealthAnalytics | null>(null);
  const [status, setStatus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController>(null);
  const live = useAppleHealthLive(visible ? ownerId : null);
  const displayed = live.report ?? report;

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
        setStatus("This export contains no supported readings in its last 90 days.");
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
    <section className="space-y-4" aria-labelledby="apple-health-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="apple-health-title" className="text-lg font-semibold">
            Apple Health
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
        {ownerId && (
          <details className="relative shrink-0 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Connection options</summary>
            <div className="absolute top-full right-0 z-10 mt-2 grid min-w-52 gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-md">
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
              {report && (
                <Button variant="ghost" className="justify-start" onClick={clear}>
                  Clear imported data
                </Button>
              )}
              {live.connected && (
                <Button variant="ghost" className="justify-start" onClick={live.disconnect}>
                  Disconnect Apple Health
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
      {ownerId && live.available && !live.connected && (
        <Button onClick={live.start}>Connect Apple Health</Button>
      )}
      {ownerId && !live.available && !displayed && (
        <p className="text-sm text-muted-foreground">
          Open this tab in the KovaGPT iPhone app to connect Apple Health and get automatic updates.
          You can also open an export from Connection options.
        </p>
      )}
      {displayed && <HealthTrends report={displayed} catalog={APPLE_HEALTH_METRICS} />}
    </section>
  );
}
