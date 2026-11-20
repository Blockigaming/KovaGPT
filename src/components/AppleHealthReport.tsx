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

export function AppleHealthTrends({ report }: { report: AppleHealthAnalytics }) {
  const [metricId, setMetricId] = useState("StepCount");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [range, setRange] = useState<Range>(7);
  const available = APPLE_HEALTH_METRICS.filter((metric) => report.metrics[metric.id]?.length);
  const metric = available.find((item) => item.id === metricId) ?? available[0];
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
  const format = (value: number) => `${number.format(value)} ${metric.unit}`;
  const stats = measured.length
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
  const selectClass = "w-full min-w-0 rounded-lg border border-border bg-background p-2";

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Through {report.asOf} · {days.length} of {range} days with readings
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="min-w-0 text-sm">
          Metric
          <select
            className={selectClass}
            value={metric.id}
            onChange={(event) => {
              setMetricId(event.currentTarget.value);
              setSourceIndex(0);
            }}
          >
            {available.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          {metric.id === "StepCount" ? "Step source" : "Data source"}
          <select
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
        </label>
        <label className="min-w-0 text-sm">
          Date range
          <select
            className={selectClass}
            value={range}
            onChange={(event) => setRange(Number(event.currentTarget.value) as Range)}
          >
            {ranges.map((value) => (
              <option key={value} value={value}>
                {value} days
              </option>
            ))}
          </select>
        </label>
      </div>
      {sources.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Choose one source to avoid counting overlapping device readings twice.
        </p>
      )}
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No readings for this source in the selected range.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{format(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="h-52 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) => date.slice(5)}
                  fontSize={11}
                  minTickGap={10}
                />
                <YAxis width={49} fontSize={11} />
                <Tooltip
                  formatter={(value) => (value === undefined ? "" : format(Number(value)))}
                />
                <Line
                  name={metric.label}
                  dataKey="value"
                  stroke="#e11d48"
                  strokeWidth={2}
                  dot={days.length <= 7}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Daily readings</summary>
            <table className="mt-2 w-full text-left text-sm">
              <caption className="sr-only">
                Daily {metric.label.toLowerCase()} from Apple Health
              </caption>
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
                    <td className="py-1.5 text-right tabular-nums">{number.format(value)}</td>
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
    live.stop();
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
    <section
      className="space-y-3 rounded-3xl bg-muted/30 p-4 sm:p-5"
      aria-labelledby="apple-health-title"
    >
      <h3 id="apple-health-title" className="font-medium">
        Apple Health
      </h3>
      <p className="text-sm text-muted-foreground">
        See up to 90 days of activity, sleep, heart, and body trends. Your file stays on your
        device.
      </p>
      {ownerId && (
        <>
          <input
            type="file"
            accept=".zip,.xml,application/zip,application/xml,text/xml"
            aria-label="Apple Health report file"
            className="hidden"
            ref={fileInput}
            onChange={(event) => void readFile(event)}
          />
          <div className="flex flex-wrap gap-2">
            {live.available && (
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  if (live.connected) live.stop();
                  else {
                    clear();
                    live.start();
                  }
                }}
              >
                {live.connected ? "Stop live updates" : "Start live updates"}
              </Button>
            )}
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => fileInput.current?.click()}
            >
              Import Apple Health data
            </Button>
            {report && (
              <Button variant="ghost" onClick={clear}>
                Clear report
              </Button>
            )}
          </div>
        </>
      )}
      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
      {live.status && (
        <p role="status" className="text-sm text-muted-foreground">
          {live.status}
        </p>
      )}
      {live.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Last updated at {new Date(live.updatedAt).toLocaleTimeString()}
        </p>
      )}
      {displayed && <AppleHealthTrends report={displayed} />}
    </section>
  );
}
