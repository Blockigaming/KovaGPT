import type { Conversation } from "./chat-store";
export function restoreChatHistoryState(
  state: ChatHistoryState,
  ownerId: string,
): Promise<ChatHistoryState>;
import type { ChatHistoryState } from "./chat-history-controller.mjs";
export function visibleChatHistory(state: ChatHistoryState, archived?: boolean): Conversation[];
