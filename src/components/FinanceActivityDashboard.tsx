import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FinanceSnapshot } from "@/finances/finance-read.server.mjs";

type FinanceRecord = FinanceSnapshot["transactions"][number];
type Props = { snapshot?: FinanceSnapshot | null; demo?: boolean };
const demoRecords = [
  { date: "2026-11-02", name: "Groceries", amount: 64.20, currency: "USD", pending: false },
  { date: "2026-11-04", name: "Transport", amount: 24.80, currency: "USD", pending: false },
  { date: "2026-11-06", name: "Entertainment", amount: 31.50, currency: "USD", pending: false },
  { date: "2026-11-07", name: "Groceries", amount: 42.10, currency: "USD", pending: false },
  { date: "2026-11-09", name: "Deposit", amount: -180.00, currency: "USD", pending: false },
] as const;
const currency = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
function summary(transactions: ReadonlyArray<Pick<FinanceRecord, "amount" | "date">>) {
  const byDay = new Map<string, { date: string; spent: number; received: number }>();
  let spent = 0, received = 0;
  for (const t of transactions) {
    if (!Number.isFinite(t.amount) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(t.date)) continue;
    const day = byDay.get(t.date) ?? { date: t.date, spent: 0, received: 0 };
    if (t.amount >= 0) { day.spent += t.amount; spent += t.amount; }
    else { day.received += -t.amount; received += -t.amount; }
    byDay.set(t.date, day);
  }
  return { spent, received, days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}
export function FinanceActivityDashboard({ snapshot, demo = false }: Props) {
  const records = demo ? demoRecords : snapshot?.transactions ?? [];
  const { spent, received, days } = useMemo(() => summary(records), [records]);
  if (!demo && !snapshot) return null;
  return (
    <section aria-label={demo ? "Fictional finance dashboard preview" : "Recent bank activity"} className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{demo ? "Explore the dashboard" : "Recent activity"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {demo ? "Fictional sample transactions. Not connected to any bank." : "Only transactions returned by your last explicit Plaid read."}
          </p>
        </div>
        <span className={demo ? "rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300" : "rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"}>
          {demo ? "DEMO DATA" : "LIVE READ"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted-foreground">Money spent</p><p className="mt-1 text-xl font-semibold tabular-nums">{currency(spent)}</p></div>
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted-foreground">Money received</p><p className="mt-1 text-xl font-semibold tabular-nums">{currency(received)}</p></div>
        <div className="rounded-xl border border-border p-4"><p className="text-xs text-muted-foreground">Net cash flow</p><p className="mt-1 text-xl font-semibold tabular-nums">{currency(received - spent)}</p></div>
      </div>
      <div className="rounded-xl border border-border p-3 sm:p-4">
        <h4 className="text-sm font-medium">Daily activity</h4>
        <p className="mt-1 text-xs text-muted-foreground">Spending and money received by transaction date · USD</p>
        {days.length ? (
          <div role="img" aria-label={`Bar chart of ${days.length} days. Total spending ${currency(spent)} and money received ${currency(received)}.`} className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top: 8, right: 4, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => "$" + v} />
                <Tooltip formatter={(v: number | undefined) => currency(Number(v ?? 0))} />
                <Bar name="Spent" dataKey="spent" fill="#8b5cf6" radius={[5, 5, 0, 0]} maxBarSize={24} />
                <Bar name="Received" dataKey="received" fill="#06b6d4" radius={[5, 5, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="mt-4 text-sm text-muted-foreground">No transactions returned for this period.</p>}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" />Spent</span><span><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-cyan-500" />Received</span></div>
      </div>
      <p className="text-xs text-muted-foreground">
        {demo ? "Sample values are illustrative only. No accounts or credentials are used." : "Totals cover returned transactions only, not a complete account statement. Pending transactions may change. This is not financial advice."}
      </p>
    </section>
  );
}
