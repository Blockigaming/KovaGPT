/** Plus is the baseline. These factors apply to request and token allowances. */
export const PLAN_USAGE_FACTOR = Object.freeze({ guest: 0, free: 0.2, plus: 1, pro: 15 });
export function planAllowance(plusAllowance, plan) {
  if (
    !Number.isSafeInteger(plusAllowance) ||
    plusAllowance < 0 ||
    !Object.hasOwn(PLAN_USAGE_FACTOR, plan)
  )
    throw new Error("Invalid plan allowance");
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(plusAllowance * PLAN_USAGE_FACTOR[plan]));
}
export const DAILY_PLAN_ALLOWANCES = Object.freeze(
  Object.fromEntries(
    ["free", "plus", "pro"].map((plan) => [
      plan,
      Object.freeze({
        chats: planAllowance(300, plan),
        regularMessages: planAllowance(250, plan),
        thinkingMessages: planAllowance(50, plan),
        images: planAllowance(40, plan),
        uploads: planAllowance(15, plan),
      }),
    ]),
  ),
);

export const CHAT_USAGE_WINDOWS = Object.freeze({
  daily: "Daily",
  five_hour: "5-hour",
  weekly: "Weekly",
});

const DAY_MS = 24 * 60 * 60_000;
const FIVE_HOURS_MS = 5 * 60 * 60_000;

export function chatUsageWindows(tier, now = new Date()) {
  const dailyStart = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const weekStart = dailyStart - ((now.getUTCDay() + 6) % 7) * DAY_MS;
  const fiveHourStart = Math.floor(now.getTime() / FIVE_HOURS_MS) * FIVE_HOURS_MS;
  const limits = DAILY_PLAN_ALLOWANCES[tier];
  const window = (id, start, duration, multiplier) => ({
    id,
    start: new Date(start).toISOString(),
    resetsAt: new Date(start + duration).toISOString(),
    regularLimit: limits.regularMessages * multiplier,
    thinkingLimit: limits.thinkingMessages * multiplier,
  });
  if (tier === "free") return [window("daily", dailyStart, DAY_MS, 1)];
  const weekly = window("weekly", weekStart, 7 * DAY_MS, 7);
  return tier === "plus"
    ? [window("five_hour", fiveHourStart, FIVE_HOURS_MS, 1), weekly]
    : [weekly];
}
