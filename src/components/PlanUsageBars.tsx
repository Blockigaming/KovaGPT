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
      {windows.map((window) => {
        const percentages = [
          window.regularUsed === null
            ? null
            : boundedPercent(window.regularUsed, window.regularLimit),
          window.thinkingUsed === null
            ? null
            : boundedPercent(window.thinkingUsed, window.thinkingLimit),
          window.costPercentUsed,
        ].filter((value): value is number => value !== null);
        const percent = percentages.length ? Math.max(...percentages) : null;
        const label = `${CHAT_USAGE_WINDOWS[window.id]} chat usage`;
        const resetLabel =
          window.id === "five_hour" ? "Rolling activity · Next hourly refresh" : "Weekly reset";
        return (
          <div key={window.id} className="kova-plan-usage-row">
            <div>
              <span>{label}</span>
              <strong>{percent === null ? "Unavailable" : `${percent}% used`}</strong>
            </div>
            {percent !== null && (
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
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              {resetLabel} {resetFormat.format(new Date(window.resetsAt))}
            </p>
          </div>
        );
      })}
      <p className="text-xs leading-5 text-muted-foreground">
        {images === null || uploads === null
          ? "Today’s image and upload usage is temporarily unavailable."
          : `Today’s images ${boundedPercent(images, base.images * multiplier)}% used · uploads ${boundedPercent(uploads, base.uploads * multiplier)}% used. These reset daily.`}
      </p>
      {windows.some((window) => window.regularUsed === null || window.costPercentUsed === null) && (
        <p className="text-xs leading-5 text-muted-foreground">
          Some chat usage data is temporarily unavailable. Meters show the data we could load.
        </p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Usage percentages are estimates. Additional safety and plan protections may apply.
      </p>
    </div>
  );
}
