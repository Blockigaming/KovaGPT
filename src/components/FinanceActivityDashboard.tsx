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

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const compactDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const chartColors = ["#10b981", "#38bdf8", "#a78bfa", "#f59e0b", "#f472b6", "#64748b"];
const spentColor = "#38bdf8";
const receivedColor = "#10b981";
const tooltipStyle = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  color: "var(--popover-foreground)",
};
const formatTooltip = (value: unknown) => dollars.format(Number(value ?? 0));

function categoryName(category: string) {
  if (category === "FOOD_AND_DRINK") return "Food and drink";
  if (category === "GENERAL_MERCHANDISE") return "Shopping";
  return category.charAt(0) + category.slice(1).toLowerCase().replaceAll("_", " ");
}

export function FinanceActivityDashboard({ snapshot }: { snapshot: FinanceSnapshot }) {
  const { spent, received, days, categories, excludedPending, excludedCurrency, excludedInvalid } =
    useMemo(() => summarizeUsdActivity(snapshot.transactions), [snapshot.transactions]);
  const remaining = categories.slice(5);
  const spending = [
    ...categories.slice(0, 5).map(({ category, amount }) => ({
      name: categoryName(category),
      amount,
    })),
    ...(remaining.length
      ? [{ name: "Other", amount: remaining.reduce((total, entry) => total + entry.amount, 0) }]
      : []),
  ];
  const metrics = [
    { label: "Spent", value: spent },
    { label: "Received", value: received },
    { label: "Net cash flow", value: received - spent },
  ];

  return (
    <section aria-labelledby="bank-activity-heading" className="space-y-5">
      <header>
        <h3 id="bank-activity-heading" className="text-xl font-semibold tracking-tight">
          Recent activity
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Posted USD transactions · Last 30 days{snapshot.limited && " · Latest 100 transactions"}
        </p>
      </header>
      {snapshot.transactionsPending ? (
        <p role="status" className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
          Plaid is preparing your transactions. Balances are available below.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {metrics.map(({ label, value }) => (
              <div key={label} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums">
                  {dollars.format(value)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h4 className="font-medium">Daily cash flow</h4>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  <span aria-hidden="true" className="mr-1.5 text-sky-500">
                    ●
                  </span>
                  Spent
                </span>
                <span>
                  <span aria-hidden="true" className="mr-1.5 text-emerald-500">
                    ●
                  </span>
                  Received
                </span>
              </div>
              {days.length ? (
                <div
                  className="mt-4 h-64 w-full"
                  role="img"
                  aria-label={`Daily cash flow over ${days.length} active days. Spent ${dollars.format(spent)} and received ${dollars.format(received)}.`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={days} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--border)"
                        strokeDasharray="4 4"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(date: string) => date.slice(5)}
                        tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={18}
                      />
                      <YAxis
                        tickFormatter={(value: number) => compactDollars.format(value)}
                        tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={50}
                      />
                      <Tooltip
                        formatter={formatTooltip}
                        contentStyle={tooltipStyle}
                        itemStyle={{ color: "var(--popover-foreground)" }}
                        cursor={{ fill: "var(--accent)" }}
                      />
                      <Bar
                        name="Spent"
                        dataKey="spent"
                        fill={spentColor}
                        radius={[5, 5, 0, 0]}
                        maxBarSize={22}
                        isAnimationActive={false}
                      />
                      <Bar
                        name="Received"
                        dataKey="received"
                        fill={receivedColor}
                        radius={[5, 5, 0, 0]}
                        maxBarSize={22}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="my-12 text-sm text-muted-foreground">
                  No posted USD activity for this period.
                </p>
              )}
            </div>
            <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h4 className="font-medium">Spending breakdown</h4>
              {spending.length ? (
                <>
                  <div
                    className="relative mx-auto h-48 max-w-xs"
                    role="img"
                    aria-label={`Spending by category. Total ${dollars.format(spent)}.`}
                  >
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                      <span className="text-xs text-muted-foreground">Total spent</span>
                      <strong className="text-lg tabular-nums">{dollars.format(spent)}</strong>
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={spending}
                          dataKey="amount"
                          nameKey="name"
                          innerRadius={57}
                          outerRadius={80}
                          paddingAngle={spending.length > 1 ? 3 : 0}
                          cornerRadius={4}
                          stroke="none"
                          isAnimationActive={false}
                        >
                          {spending.map(({ name }, index) => (
                            <Cell key={name} fill={chartColors[index]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={formatTooltip}
                          contentStyle={tooltipStyle}
                          itemStyle={{ color: "var(--popover-foreground)" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="space-y-2">
                    {spending.map(({ name, amount }, index) => (
                      <li key={name} className="flex justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: chartColors[index] }}
                          />
                          {name}
                        </span>
                        <span className="shrink-0 tabular-nums">{dollars.format(amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="my-12 text-sm text-muted-foreground">
                  No posted USD spending for this period.
                </p>
              )}
            </div>
          </div>
          {excludedPending + excludedCurrency + excludedInvalid > 0 && (
            <p className="text-xs text-muted-foreground">
              Excluded from chart totals: {excludedPending} pending, {excludedCurrency} non-USD or
              unknown-currency, and {excludedInvalid} invalid transactions.
            </p>
          )}
        </>
      )}
    </section>
  );
}
