import type { Conversation } from "./chat-store";
export type ReviewedMemoryRequest = {
  operation: "save_reviewed_memory";
  chatId: string;
  expectedRevision: number;
  memoryEnabled: true;
  temporary: false;
  confirmed: true;
  text: string;
};
export function parseReviewedMemoryRequest(value: unknown): ReviewedMemoryRequest;
export function reviewedMemorySource(
  conversation: unknown,
  ownerId: string,
): {
  conversation: Conversation;
  messageCount: number;
  title: string;
};
export function syncedReviewedMemorySource(
  state: unknown,
  conversation: Conversation,
  ownerId: string,
): {
  conversation: Conversation;
  messageCount: number;
  title: string;
  revision: number;
};

export function sameReviewedMemoryConversation(
  left: unknown,
  right: unknown,
  ownerId: string,
): boolean;
