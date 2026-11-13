import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import { PLAN_USAGE_FACTOR } from "@/lib/plan-usage-policy.mjs";

const tiers = ["free", "plus", "pro"] as const;
const rows = [
  {
    label: "Chat modes",
    values: tiers.map((tier) =>
      CAPABILITY_REGISTRY.modesByTier[tier].map((mode) => mode.label).join(", "),
    ),
  },
  {
    label: "Usage",
    values: [
      "Very limited",
      `${PLAN_USAGE_FACTOR.plus / PLAN_USAGE_FACTOR.free}× Free`,
      `${PLAN_USAGE_FACTOR.pro / PLAN_USAGE_FACTOR.free}× Free (${PLAN_USAGE_FACTOR.pro}× Plus)`,
    ],
  },
  { label: "Basic chat", values: ["Limited", "Limited", "Unlimited with Argon Lite"] },
  {
    label: "Advanced chat",
    values: ["Argon Medium, limited", "All seven models, limited", "All advanced models, limited"],
  },
  { label: "Images and files", values: ["Limited", "Expanded", "Highest allowance"] },
  { label: "Cloud storage", values: ["Included", "Included", "Included"] },
] as const;

export function PlanComparison() {
  return (
    <section className="public-plan-comparison mt-12" aria-labelledby="plan-comparison-title">
      <h2 id="plan-comparison-title" className="text-2xl font-semibold tracking-tight">
        Compare the essentials
      </h2>
      <p className="mb-6 mt-3 text-sm leading-6 text-muted-foreground">
        Model access and relative usage for each individual plan.
      </p>
      <div
        className="kova-desktop-plan-comparison public-table-scroll overflow-x-auto rounded-2xl border border-border"
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
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {tiers.map((tier, index) => (
                  <td key={tier}>{row.values[index]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kova-phone-plan-comparison hidden">
        {rows.map(({ label, values }) => (
          <details key={label}>
            <summary>{label}</summary>
            <dl>
              {tiers.map((tier, index) => (
                <div key={tier}>
                  <dt>{CAPABILITY_REGISTRY.plans[tier].name}</dt>
                  <dd>{values[index]}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}
