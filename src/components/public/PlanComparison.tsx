import { CAPABILITY_REGISTRY, PLAN_ALLOWANCE_COPY } from "@/lib/capability-registry";

const tiers = ["free", "plus", "pro"] as const;
const rows = [
  { label: "Chat", allowance: "chat" },
  { label: "Images", allowance: "image" },
  { label: "Uploads", allowance: "upload" },
  { label: "Storage", allowance: "storage" },
] as const;

export function PlanComparison() {
  return (
    <section className="public-plan-comparison" aria-labelledby="plan-comparison-title">
      <p className="public-eyebrow">Find your fit</p>
      <h2 id="plan-comparison-title">Compare the essentials</h2>
      <p className="mb-6 mt-3 text-sm leading-6 text-muted-foreground">
        Published allowances and modes for individual plans. Check the plan cards for additional
        details.
      </p>
      <div className="public-table-scroll" role="region" aria-label="Plan comparison" tabIndex={0}>
        <table>
          <caption className="sr-only">KovaGPT Free, Plus, and Pro plan comparison</caption>
          <thead>
            <tr>
              <th scope="col">Included</th>
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
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {tiers.map((tier) => (
                  <td key={tier}>{PLAN_ALLOWANCE_COPY[tier][row.allowance]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
