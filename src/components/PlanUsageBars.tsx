import { DAILY_PLAN_ALLOWANCES, PLAN_USAGE_FACTOR } from "@/lib/plan-usage-policy.mjs";
import type { Tier } from "@/lib/modes";

export function PlanUsageBars({
  tier,
  usage,
}: {
  tier: Tier;
  usage: { chats: number; images: number; uploads: number };
}) {
  return (
    <div className="kova-plan-usage">
      <div className="kova-plan-usage-heading">
        <strong>Kova {tier === "free" ? "Free" : tier === "plus" ? "Plus" : "Pro"}</strong>
        <span>{PLAN_USAGE_FACTOR[tier]}× Plus allowance</span>
      </div>
      {(["chats", "images", "uploads"] as const).map((kind) => {
        const total = DAILY_PLAN_ALLOWANCES[tier][kind];
        const used = Math.max(0, usage[kind]);
        const label = kind === "chats" ? "Messages" : kind === "images" ? "Images" : "File uploads";
        return (
          <div key={kind} className="kova-plan-usage-row">
            <div>
              <span>{label}</span>
              <span>
                <strong>{used.toLocaleString()}</strong> / {total.toLocaleString()}
              </span>
            </div>
            <div
              className="kova-usage-track"
              role="progressbar"
              aria-label={`${label} used today`}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={Math.min(total, used)}
              aria-valuetext={`${used} of ${total} used`}
            >
              <span style={{ width: `${Math.min(100, (used / total) * 100)}%` }} />
            </div>
            <small>{Math.max(0, total - used).toLocaleString()} remaining today</small>
          </div>
        );
      })}
      <p className="kova-plan-usage-comparison">
        <span>
          Free <strong>⅕×</strong>
        </span>
        <span>
          Plus · $16/month <strong>1×</strong>
        </span>
        <span>
          Pro · $80/month <strong>15×</strong>
        </span>
      </p>
    </div>
  );
}
