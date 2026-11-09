import { CHAT_USAGE_WINDOWS, DAILY_PLAN_ALLOWANCES } from "@/lib/plan-usage-policy.mjs";
import type { PlanUsageDto } from "@/utils/usage.functions";

const resetFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const boundedPercent = (used: number, limit: number) =>
  limit > 0 ? Math.min(100, Math.max(0, Math.round((used / limit) * 100))) : 100;

export function PlanUsageBars({ usage }: { usage: PlanUsageDto }) {
  const { tier, windows, images, uploads } = usage;
  const base = DAILY_PLAN_ALLOWANCES[tier];
  const multiplier = usage.usageMultiplier ?? 1;

  return (
    <div className="kova-plan-usage">
      {windows.map(
        ({ id, resetsAt, regularUsed, regularLimit, thinkingUsed, thinkingLimit, costPercentUsed }) => {
          const percent = Math.max(
            boundedPercent(regularUsed, regularLimit),
            boundedPercent(thinkingUsed, thinkingLimit),
            costPercentUsed ?? 0,
          );
          const label = `${CHAT_USAGE_WINDOWS[id]} chat usage`;
          return (
            <div key={id} className="kova-plan-usage-row">
              <div>
                <span>{label}</span>
                <strong>{percent}% used</strong>
              </div>
              <div
                className="kova-usage-track"
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {id === "five_hour" ? "Rolling activity · Next hourly refresh " : "Weekly reset "}
                {resetFormat.format(new Date(resetsAt))}
              </p>
            </div>
          );
        },
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Today's images {boundedPercent(images, base.images * multiplier)}% used · uploads{" "}
        {boundedPercent(uploads, base.uploads * multiplier)}% used. These reset daily.
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        Usage percentages are estimates. Additional safety and plan protections may apply.
      </p>
    </div>
  );
}
