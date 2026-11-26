import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { getMyUsageHistory } from "@/utils/usage.functions";

type UsageHistory = Awaited<ReturnType<typeof getMyUsageHistory>>;
const dateLabel = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function UsageAnalytics({ ownerId }: { ownerId: string }) {
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState<7 | 30>(7);
  useEffect(() => {
    let current = true;
    getMyUsageHistory({ data: { ownerId } }).then(
      (rows) => {
        if (current) setHistory(rows);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [ownerId, attempt]);

  const days = history?.slice(-range);
  return (
    <section className="kova-settings-section min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3>Message history</h3>
        <div className="flex gap-1" role="group" aria-label="Date range">
          {([7, 30] as const).map((days) => (
            <Button
              key={days}
              type="button"
              size="sm"
              className="rounded-full"
              aria-pressed={days === range}
              variant={days === range ? "secondary" : "ghost"}
              onClick={() => setRange(days)}
            >
              {days} days
            </Button>
          ))}
        </div>
      </div>
      {failed ? (
        <div role="alert">
          <p>Usage history is temporarily unavailable.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : days ? (
        <>
          <p className="text-sm text-muted-foreground">
            {days.reduce((total, day) => total + day.regular + day.thinking, 0).toLocaleString()}{" "}
            messages recorded
          </p>
          <div className="h-56 min-w-0" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days}>
                <XAxis
                  dataKey="date"
                  minTickGap={24}
                  tickFormatter={(value: string) => dateLabel.format(new Date(value))}
                />
                <YAxis allowDecimals={false} width={34} />
                <Tooltip labelFormatter={(value) => dateLabel.format(new Date(String(value)))} />
                <Bar
                  dataKey="regular"
                  name="Regular"
                  stackId="messages"
                  fill="#5379e9"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="thinking"
                  name="Thinking"
                  stackId="messages"
                  fill="#a36cdb"
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">Daily message counts</summary>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="text-start">
                    Date
                  </th>
                  <th scope="col">Regular</th>
                  <th scope="col">Thinking</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <th scope="row" className="text-start font-normal">
                      {dateLabel.format(new Date(day.date))}
                    </th>
                    <td className="text-center tabular-nums">{day.regular}</td>
                    <td className="text-center tabular-nums">{day.thinking}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p role="status">Loading usage history…</p>
      )}
    </section>
  );
}
