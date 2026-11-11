import { Banknote, CircleDollarSign, House, ShoppingCart, Utensils } from "lucide-react";

const categories = [
  {
    name: "Rent and utilities",
    icon: House,
    segments: [{ amount: 1300, color: "bg-green-500" }],
  },
  {
    name: "Groceries",
    icon: ShoppingCart,
    segments: [{ amount: 650, color: "bg-green-600" }],
  },
  {
    name: "Subscriptions",
    icon: Banknote,
    segments: [
      { amount: 350, color: "bg-green-700" },
      { amount: 200, color: "bg-blue-500" },
    ],
  },
  {
    name: "Dining",
    icon: Utensils,
    segments: [
      { amount: 300, color: "bg-blue-600" },
      { amount: 200, color: "bg-blue-700" },
    ],
  },
].map((category) => ({
  ...category,
  amount: category.segments.reduce((sum, segment) => sum + segment.amount, 0),
}));

const segments = categories.flatMap((category) => category.segments);

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function FinancesPreview() {
  const total = categories.reduce((sum, category) => sum + category.amount, 0);

  return (
    <div className="mx-auto w-full max-w-[680px] pb-8 pt-10 text-foreground sm:pt-[72px]">
      <header className="mx-auto flex max-w-[500px] flex-col items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-border bg-muted text-green-700 dark:text-green-400">
          <CircleDollarSign aria-hidden="true" className="size-7" />
        </div>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">
          A new way to manage your finances
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
          Get help from Kova with questions about your spending, subscriptions, balances, and
          investments.
        </p>
        <span className="mt-5 rounded-full bg-amber-500/15 px-3 py-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
          Coming soon
        </span>
      </header>

      <section
        aria-labelledby="finances-spending-title"
        className="mt-10 rounded-[24px] border border-border bg-card p-4 text-card-foreground sm:mt-14 sm:p-6"
      >
        <p className="mb-1 text-xs text-muted-foreground">Example data</p>
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3 text-lg font-semibold">
          <h3 id="finances-spending-title">Spending</h3>
          <span className="tabular-nums">{dollars.format(total)}</span>
        </div>
        <div aria-hidden="true" className="mt-4 flex h-10 gap-0.5">
          {segments.map(({ amount, color }) => (
            <span key={color} className={`rounded-sm ${color}`} style={{ flex: amount }} />
          ))}
        </div>
        <ul className="mt-3">
          {categories.map(({ name, amount, icon: Icon }) => (
            <li key={name} className="flex min-h-12 items-center gap-3 text-sm sm:text-base">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span>{name}</span>
              <span className="ml-auto tabular-nums">{dollars.format(amount)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
