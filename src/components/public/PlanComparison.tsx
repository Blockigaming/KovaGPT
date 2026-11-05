import { chatUsageWindows, DAILY_PLAN_ALLOWANCES } from "@/lib/plan-usage-policy.mjs";
import { CAPABILITY_REGISTRY, PLAN_ALLOWANCE_COPY } from "@/lib/capability-registry";

const tiers = ["free", "plus", "pro"] as const;
const rows = [
  { label: "Image generations / day", allowance: "images" },
  { label: "File uploads / day", allowance: "uploads" },
] as const;
const number = new Intl.NumberFormat("en-US");
const windowLabels = { daily: "/ day", five_hour: "/ 5 hours", weekly: "/ week" };

export function PlanComparison() {
  return (
    <section className="public-plan-comparison mt-12" aria-labelledby="plan-comparison-title">
      <h2 id="plan-comparison-title" className="text-2xl font-semibold tracking-tight">
        Compare the essentials
      </h2>
      <p className="mb-6 mt-3 text-sm leading-6 text-muted-foreground">
        Model modes, message allowances, and storage for each individual plan.
      </p>
      <div
        className="public-table-scroll overflow-x-auto rounded-2xl border border-border"
        role="region"
        aria-label="Plan comparison"
        tabIndex={0}
      >
        <table className="w-full min-w-[36rem] table-fixed border-collapse text-left text-sm [&_:is(th,td)]:px-4 [&_:is(th,td)]:py-3 [&_:is(th,td)]:align-top [&_tbody_tr]:border-t [&_tbody_tr]:border-border [&_tbody_th]:font-medium [&_td]:text-muted-foreground">
          <caption className="sr-only">KovaGPT Free, Plus, and Pro plan comparison</caption>
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="w-[29%]">
                Included
              </th>
              {tiers.map((tier) => (
                <th key={tier} scope="col">
                  {CAPABILITY_REGISTRY.plans[tier].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Chat modes</th>
              {tiers.map((tier) => (
                <td key={tier}>
                  {CAPABILITY_REGISTRY.modesByTier[tier].map((mode) => mode.label).join(", ")}
                </td>
              ))}
            </tr>
            {(
              [
                ["Regular messages", "regularLimit"],
                ["Thinking messages", "thinkingLimit"],
              ] as const
            ).map(([label, limit]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {tiers.map((tier) => (
                  <td key={tier} className="tabular-nums">
                    {chatUsageWindows(tier).map((window) => (
                      <span key={window.id} className="block">
                        {number.format(window[limit])} {windowLabels[window.id]}
                      </span>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {tiers.map((tier) => (
                  <td key={tier} className="tabular-nums">
                    {number.format(DAILY_PLAN_ALLOWANCES[tier][row.allowance])}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Cloud storage</th>
              {tiers.map((tier) => (
                <td key={tier}>{PLAN_ALLOWANCE_COPY[tier].storage}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
