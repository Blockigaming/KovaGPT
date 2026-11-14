import { CHAT_USAGE_WINDOWS, DAILY_PLAN_ALLOWANCES } from "@/lib/plan-usage-policy.mjs";
import type { PlanUsageDto } from "@/utils/usage.functions";

const resetFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const boundedPercent = (used: number | null, limit: number) =>
  typeof used === "number" && Number.isFinite(used) && Number.isFinite(limit)
    ? limit > 0
      ? Math.min(100, Math.max(0, Math.round((used / limit) * 100)))
      : 100
    : null;

export function PlanUsageBars({ usage }: { usage: PlanUsageDto }) {
  const { tier, windows, images, uploads } = usage;
  const base = DAILY_PLAN_ALLOWANCES[tier];
  const multiplier = usage.usageMultiplier ?? 1;
  const imagePercent = boundedPercent(images, base.images * multiplier);
  const uploadPercent = boundedPercent(uploads, base.uploads * multiplier);

  return (
    <div className="kova-plan-usage">
      {windows.map((window) => {
        const percentages = [
          boundedPercent(window.regularUsed, window.regularLimit),
          boundedPercent(window.thinkingUsed, window.thinkingLimit),
          boundedPercent(window.costPercentUsed, 100),
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
        {imagePercent === null || uploadPercent === null
          ? "Today’s image and upload usage is temporarily unavailable."
          : `Today’s images ${imagePercent}% used · uploads ${uploadPercent}% used. These reset daily.`}
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
