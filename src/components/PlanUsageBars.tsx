import { DAILY_PLAN_ALLOWANCES } from "@/lib/plan-usage-policy.mjs";
import type { Tier } from "@/lib/modes";

export function PlanUsageBars({
  tier,
  usage,
}: {
  tier: Tier;
  usage: { chats: number; thinking?: number; images: number; uploads: number };
}) {
  const limits = DAILY_PLAN_ALLOWANCES[tier];
  const thinking = Math.max(0, usage.thinking ?? 0);
  const rows = [
    {
      label: "Regular messages",
      used: Math.max(0, usage.chats - thinking),
      total: limits.regularMessages,
    },
    { label: "Thinking", used: thinking, total: limits.thinkingMessages },
    { label: "Images", used: usage.images, total: limits.images },
    { label: "File uploads", used: usage.uploads, total: limits.uploads },
  ];
  return (
    <div className="kova-plan-usage">
      <div className="kova-plan-usage-heading">
        <strong>Kova {tier === "free" ? "Free" : tier === "plus" ? "Plus" : "Pro"}</strong>
        <span>Daily usage</span>
      </div>
      {rows.map(({ label, used, total }) => {
        const percent = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
        return (
          <div key={label} className="kova-plan-usage-row">
            <div>
              <span>{label}</span>
              <strong>{percent}% used</strong>
            </div>
            <div
              className="kova-usage-track"
              role="progressbar"
              aria-label={`${label} used today`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`${percent}% used`}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Updated from your account activity. Allowances reset daily; model and context limits also
        apply.
      </p>
    </div>
  );
}
