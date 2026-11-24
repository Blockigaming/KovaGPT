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
export function receiveMessageActivity(
  delta: Record<string, unknown>,
  principal: string | null,
  conversationId: string,
  messageId: string,
): (current?: readonly Activity[]) => Activity[];
export function getLiveBrowserActivity(): LiveBrowserActivity | null;
export function subscribeToLiveBrowserActivity(listener: () => void): () => void;
export function conversationWithLiveBrowserActivity<T extends Conversation | null>(
  conversation: T,
  live: LiveBrowserActivity | null,
  principal: string | null,
  now?: number,
): T;
export function timeMessageActivities(
  previous?: readonly Activity[],
  next?: readonly Activity[],
  now?: number,
): Activity[];
