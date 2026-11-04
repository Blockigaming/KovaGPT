import { CHAT_USAGE_WINDOWS, DAILY_PLAN_ALLOWANCES } from "@/lib/plan-usage-policy.mjs";
import type { PlanUsageDto } from "@/utils/usage.functions";

const resetFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const count = new Intl.NumberFormat("en-US");

export function PlanUsageBars({ usage }: { usage: PlanUsageDto }) {
  const { tier, windows, images, uploads } = usage;
  const limits = DAILY_PLAN_ALLOWANCES[tier];
  return (
    <div className="kova-plan-usage">
      {windows.map(({ id, resetsAt, regularUsed, regularLimit, thinkingUsed, thinkingLimit }) => {
        const percent = Math.min(
          100,
          Math.floor(Math.max(regularUsed / regularLimit, thinkingUsed / thinkingLimit) * 100),
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
              {count.format(regularUsed)} / {count.format(regularLimit)} regular ·{" "}
              {count.format(thinkingUsed)} / {count.format(thinkingLimit)} Thinking
              {" · Resets "}
              {resetFormat.format(new Date(resetsAt))}
            </p>
          </div>
        );
      })}
      <p className="text-xs leading-5 text-muted-foreground">
        Today · {images} / {limits.images} images · {uploads} / {limits.uploads} uploads. Image and
        file limits reset at midnight UTC.
      </p>
    </div>
  );
}
