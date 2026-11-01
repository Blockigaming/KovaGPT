export const PLAN_USAGE_FACTOR: Readonly<Record<"guest" | "free" | "plus" | "pro", number>>;
export function planAllowance(
  plusAllowance: number,
  plan: "guest" | "free" | "plus" | "pro",
): number;
export const DAILY_PLAN_ALLOWANCES: Readonly<
  Record<
    "free" | "plus" | "pro",
    Readonly<{
      chats: number;
      regularMessages: number;
      thinkingMessages: number;
      images: number;
      uploads: number;
    }>
  >
>;
