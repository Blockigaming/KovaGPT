import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinanceSnapshot } from "@/finances/finance-read.server.mjs";
import { summarizeUsdActivity } from "@/finances/finance-activity-summary.mjs";

type Props = { snapshot?: FinanceSnapshot | null; demo?: boolean };
const demoRecords = [
  { date: "2026-11-02", name: "Groceries", amount: 64.2, currency: "USD", pending: false },
  { date: "2026-11-04", name: "Transport", amount: 24.8, currency: "USD", pending: false },
  { date: "2026-11-06", name: "Entertainment", amount: 31.5, currency: "USD", pending: false },
  { date: "2026-11-07", name: "Groceries", amount: 42.1, currency: "USD", pending: false },
  { date: "2026-11-09", name: "Deposit", amount: -180.0, currency: "USD", pending: false },
] as const;
const currency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
export function FinanceActivityDashboard({ snapshot, demo = false }: Props) {
  const records = demo ? demoRecords : (snapshot?.transactions ?? []);
  const { spent, received, days, excludedPending, excludedCurrency, excludedInvalid } = useMemo(
    () => summarizeUsdActivity(records),
    [records],
  );
  if (!demo && !snapshot) return null;
  return (
    <section
      aria-label={demo ? "Fictional finance dashboard preview" : "Recent bank activity"}
      className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            {demo ? "Explore the dashboard" : "Recent activity"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {demo
              ? "Fictional sample transactions. Not connected to any bank."
              : "Only transactions returned by your last explicit Plaid read."}
          </p>
        </div>
        <span
          className={
            demo
              ? "rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300"
              : "rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
          }
        >
          {demo ? "DEMO DATA" : "LIVE READ"}
        </span>
      </div>
      {!demo && excludedPending + excludedCurrency + excludedInvalid > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Excluded from posted USD totals: {excludedPending} pending, {excludedCurrency} non-USD or
          unknown-currency, and {excludedInvalid} invalid transactions.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Money spent</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{currency(spent)}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Money received</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{currency(received)}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Net cash flow</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{currency(received - spent)}</p>
        </div>
      </div>
      <div className="rounded-xl border border-border p-3 sm:p-4">
        <h4 className="text-sm font-medium">Cash flow composition</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Share of returned money spent and received
        </p>
        <div
          className="mx-auto mt-2 h-44 max-w-xs"
          role="img"
          aria-label={`Spent ${currency(spent)}; received ${currency(received)}`}
        >
          {spent + received > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: "Spent", value: spent },
                    { name: "Received", value: received },
                  ]}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={47}
                  outerRadius={72}
                  stroke="none"
                >
                  <Cell fill="#8b5cf6" />
                  <Cell fill="#06b6d4" />
                </Pie>
                <Tooltip formatter={(v) => currency(typeof v === "number" ? v : Number(v ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="pt-12 text-center text-sm text-muted-foreground">No activity to chart</p>
          )}
        </div>
        <div className="flex justify-center gap-5 text-xs text-muted-foreground">
          <span>
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" />
            Spent
          </span>
          <span>
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-cyan-500" />
            Received
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-border p-3 sm:p-4">
        <h4 className="text-sm font-medium">Daily activity</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Posted USD spending and money received by transaction date
        </p>
        {days.length ? (
          <div
            role="img"
            aria-label={`Bar chart of ${days.length} days. Total spending ${currency(spent)} and money received ${currency(received)}.`}
            className="mt-3 h-56 w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top: 8, right: 4, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => d.slice(5)}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(v: number) => "$" + v}
                />
                <Tooltip formatter={(v) => currency(typeof v === "number" ? v : Number(v ?? 0))} />
                <Bar
                  name="Spent"
                  dataKey="spent"
                  fill="#8b5cf6"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={24}
                />
                <Bar
                  name="Received"
                  dataKey="received"
                  fill="#06b6d4"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No transactions returned for this period.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" />
            Spent
          </span>
          <span>
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-cyan-500" />
            Received
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {demo
          ? "Sample values are illustrative only. No accounts or credentials are used."
          : "Totals include posted USD transactions only from the returned results, not a complete account statement. Other currencies and pending transactions are excluded. This is not financial advice."}
      </p>
    </section>
  );
}
