import type { Conversation } from "./chat-store";
export function loadReviewedMemorySource(
  ownerId: string,
  conversation: Conversation,
): Promise<{
  conversation: Conversation;
  messageCount: number;
  title: string;
  revision: number;
}>;
export function saveReviewedMemory(input: {
  ownerId: string;
  conversation: Conversation;
  revision: number;
  text: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
}): Promise<void>;
