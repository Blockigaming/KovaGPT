import type { Activity } from "./chat-store";
export function appendMessageActivity(current: readonly Activity[], next: Activity): Activity[];
export function messageActivitiesFromDelta(
  current: readonly Activity[],
  delta: Record<string, unknown>,
): Activity[];
