import type { ChatHistoryState } from "./chat-history-controller.mjs";
export function loadChatHistoryDevice(ownerId: string): Promise<ChatHistoryState | null>;
export function commitChatHistoryDevice(
  previous: ChatHistoryState | null,
  next: ChatHistoryState,
  options?: { signal?: AbortSignal },
): Promise<void>;
export function clearChatHistoryDevice(ownerId: string): Promise<void>;
