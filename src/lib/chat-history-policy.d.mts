import type { Conversation } from "./chat-store";
export const CHAT_HISTORY_LIMITS: {
  snapshotBytes: number;
  messages: number;
  chats: number;
  accountBytes: number;
};
export function chatHistoryUuid(value: unknown): string;
export function chatHistoryId(value: unknown): string;
export function canonicalChatHistory(value: unknown): string;
export function normalizeChatHistory(value: unknown, ownerId: string): Conversation;
