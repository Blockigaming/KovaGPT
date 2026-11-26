import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { loadConversations, loadArchivedConversations } from "@/lib/chat-store";
import { consumerModel } from "@/lib/consumer-model-selection.mjs";
import { getMyUsageHistory, getMyChatUsageBreakdown } from "@/utils/usage.functions";

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
  const [breakdown, setBreakdown] = useState<{
    days: number;
    data: Awaited<ReturnType<typeof getMyChatUsageBreakdown>> | null;
  } | null>(null);
  useEffect(() => {
    let current = true;
    void getMyChatUsageBreakdown({ data: { ownerId, days: range } }).then(
      (data) => {
        if (current) setBreakdown({ days: range, data });
      },
      () => {
        if (current) setBreakdown({ days: range, data: null });
      },
    );
    return () => {
      current = false;
    };
  }, [ownerId, range, attempt]);
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
  const chatTitles = breakdown?.data?.chats.length
    ? new Map(
        [...loadConversations(ownerId), ...loadArchivedConversations(ownerId)].map((chat) => [
          chat.id,
          chat.title,
        ]),
      )
    : new Map<string, string>();
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
      {breakdown?.days === range &&
        (breakdown.data ? (
          <div className="grid gap-6 sm:grid-cols-2">
            <section>
              <h4 className="font-medium">Messages by model</h4>
              {breakdown.data.models.length ? (
                <ul className="divide-y divide-border">
                  {breakdown.data.models.map(({ model, messages }) => (
                    <li key={model} className="flex justify-between gap-2 py-2 text-sm">
                      <span>{consumerModel(model)?.label ?? model}</span>
                      <span>{messages.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No completed messages recorded.</p>
              )}
            </section>
            <section>
              <h4 className="font-medium">Top chats</h4>
              {breakdown.data.chats.length ? (
                <ul className="divide-y divide-border">
                  {breakdown.data.chats.map(({ id, messages }, index) => (
                    <li key={id} className="flex justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0 break-words">
                        {chatTitles.get(id) || `Chat ${index + 1}`}
                      </span>
                      <span>{messages.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No saved chat activity recorded.</p>
              )}
            </section>
            <section>
              <h4 className="font-medium">Tool activity</h4>
              {breakdown.data.tools.length ? (
                <ul className="divide-y divide-border">
                  {breakdown.data.tools.map(({ day, calls }) => (
                    <li key={day} className="flex justify-between gap-2 py-2 text-sm">
                      <time dateTime={day}>{dateLabel.format(new Date(day))}</time>
                      <span>{calls.toLocaleString()} calls</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No tool calls recorded.</p>
              )}
            </section>
          </div>
        ) : (
          <p role="status" className="text-sm">
            Chat breakdown is unavailable.
          </p>
        ))}
    </section>
  );
}
