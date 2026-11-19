import type { Activity, Conversation } from "./chat-store";
export type LiveBrowserActivity = {
  principal: string;
  conversationId: string;
  messageId: string;
  expiresAt: number;
  activity: Activity;
};
export function appendMessageActivity(current: readonly Activity[], next: Activity): Activity[];
export function messageActivitiesFromDelta(
  current: readonly Activity[],
  delta: Record<string, unknown>,
): Activity[];
export function conversationWithLiveBrowserActivity(
  conversation: Conversation | null,
  live: LiveBrowserActivity | null,
  principal: string,
  now?: number,
): Conversation | null;
