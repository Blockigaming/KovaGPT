import { chatHistorySnapshot } from "./chat-history-bridge";
import { loadConversations, saveConversations, type Conversation } from "./chat-store";

/** A route is exposed only after the selected chat survives a durable readback. */
export async function persistChatRoute(
  ownerId: string | null,
  conversations: Conversation[],
  id: string,
  current: () => boolean,
  snapshot = chatHistorySnapshot(ownerId),
): Promise<boolean> {
  const items = conversations.filter((chat) => !chat.temporary);
  if (!current() || !items.some((chat) => chat.id === id)) return false;
  try {
    if (!(await saveConversations(ownerId, items, { snapshot }))) return false;
    return (
      current() &&
      snapshot === chatHistorySnapshot(ownerId) &&
      loadConversations(ownerId).some((chat) => chat.id === id && !chat.temporary)
    );
  } catch {
    return false;
  }
}
