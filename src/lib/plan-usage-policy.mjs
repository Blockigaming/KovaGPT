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
        chats: planAllowance(500, plan),
        images: planAllowance(40, plan),
        uploads: planAllowance(50, plan),
      }),
    ]),
  ),
);
