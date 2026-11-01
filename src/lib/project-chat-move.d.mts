import type { Conversation } from "./chat-store";
export function completeProjectChatMove(input: {
  source: Conversation;
  isCurrent: () => boolean;
  readActive: () => Conversation[];
  archive: (chat: Conversation) => boolean | Promise<boolean>;
  remove: (remaining: Conversation[]) => boolean | Promise<boolean>;
}): Promise<boolean>;
