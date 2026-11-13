/** Plus is the baseline. These factors apply to request and token allowances. */
export const PLAN_USAGE_FACTOR = Object.freeze({ guest: 0, free: 0.2, plus: 1, pro: 20 });
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
const HOUR_MS = 60 * 60_000;
const FIVE_HOURS_MS = 5 * HOUR_MS;

export function legacyFiveHourWindow(now) {
  const start = Math.floor(now.getTime() / FIVE_HOURS_MS) * FIVE_HOURS_MS;
  return {
    start: new Date(start).toISOString(),
    resetsAt: new Date(start + FIVE_HOURS_MS).toISOString(),
  };
}

export function chatUsageWindows(tier, now = new Date(), usageMultiplier = 1) {
  if (![1, 5].includes(usageMultiplier) || (usageMultiplier !== 1 && tier !== "pro"))
    throw new Error("Invalid usage multiplier");
  const dailyStart = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const weekStart = dailyStart - ((now.getUTCDay() + 6) % 7) * DAY_MS;
  // Five complete/current UTC hourly buckets form a rolling five-hour meter.
  // Capacity refreshes on each hour as the oldest bucket expires.
  const hourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const fiveHourStart = hourStart - 4 * HOUR_MS;
  const limits = DAILY_PLAN_ALLOWANCES[tier];
  const window = (id, start, duration, multiplier) => ({
    id,
    start: new Date(start).toISOString(),
    resetsAt: new Date(start + duration).toISOString(),
    regularLimit: limits.regularMessages * multiplier * usageMultiplier,
    thinkingLimit: limits.thinkingMessages * multiplier * usageMultiplier,
  });
  const weekly = window("weekly", weekStart, 7 * DAY_MS, 7);
  const hourly = {
    ...window("five_hour", fiveHourStart, FIVE_HOURS_MS, 1),
    resetsAt: new Date(hourStart + HOUR_MS).toISOString(),
  };
  return tier === "pro" ? [weekly] : [hourly, weekly];
}

/** Only the server-resolved Pro default model is outside the advanced allowance. */
export function isUnlimitedBasicChat(tier, modelId, mode) {
  return tier === "pro" && modelId === "kova-argon-4.6" && mode === "instant";
}
