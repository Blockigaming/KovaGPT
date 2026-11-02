import type { Activity } from "./chat-store";
export function appendMessageActivity(current: readonly Activity[], next: Activity): Activity[];
