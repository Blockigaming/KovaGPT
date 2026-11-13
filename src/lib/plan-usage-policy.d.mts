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
export type ChatUsageWindowId = "daily" | "five_hour" | "weekly";
export const CHAT_USAGE_WINDOWS: Readonly<Record<ChatUsageWindowId, string>>;
export function chatUsageWindows(
  tier: "free" | "plus" | "pro",
  now?: Date,
  usageMultiplier?: 1 | 5,
): {
  id: ChatUsageWindowId;
  start: string;
  resetsAt: string;
  regularLimit: number;
  thinkingLimit: number;
}[];

export function isUnlimitedBasicChat(tier: string, modelId: string, mode: string): boolean;

export function legacyFiveHourWindow(now: Date): { start: string; resetsAt: string };
