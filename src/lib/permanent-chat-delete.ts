import { deleteChatWithUndo, readChatDeleteIntents } from "./chat-delete-undo";
import {
  loadConversations,
  saveConversations,
  chatStoragePrincipal,
  conversationStorageKey,
  archivedConversationStorageKey,
  clearDraft,
  type Conversation,
} from "./chat-store";
import { canWriteChatHistory } from "./chat-history-bridge";

/** A five-second grace period precedes the content-free deletion tombstone. */
export async function permanentlyDeleteChat(
  owner: string | null,
  chat: Conversation,
  current: () => boolean = () => true,
): Promise<boolean> {
  if (!current() || !canWriteChatHistory(owner)) return false;
  return deleteChatWithUndo(owner, chat.id, current, () =>
    commitPermanentChatDeletion(owner, chat, current),
  );
}
async function commitPermanentChatDeletion(
  owner: string | null,
  chat: Conversation,
  current: () => boolean,
): Promise<boolean> {
  if (!current() || !canWriteChatHistory(owner)) return false;
  if (
    !chat.temporary &&
    !(await saveConversations(
      owner,
      loadConversations(owner).filter((item) => item.id !== chat.id),
    ))
  )
    throw new Error("Chat deletion could not be saved.");
  if (!current()) return true;
  clearDraft(owner, chat.id);
  for (const snapshotKey of [
    conversationStorageKey(owner),
    archivedConversationStorageKey(owner),
  ]) {
    const raw = localStorage.getItem(snapshotKey);
    if (!raw) continue;
    const records = JSON.parse(raw);
    if (Array.isArray(records))
      localStorage.setItem(
        snapshotKey,
        JSON.stringify(records.filter((item: { id?: string }) => item.id !== chat.id)),
      );
  }
  // Remove any legacy recoverable duplicate of this exact chat as well.
  const key = `kova-chat-trash-v1:${chatStoragePrincipal(owner)}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const value = JSON.parse(raw);
      if (Array.isArray(value.entries)) {
        value.entries = value.entries.filter(
          (entry: { conversation?: { id?: string } }) => entry.conversation?.id !== chat.id,
        );
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
  } catch {
    /* Legacy cleanup must not undo a committed deletion. */
  }
  return true;
}

/** Resume ID-only deletion intentions after a reload, preserving the original Undo deadline. */
export function resumePendingChatDeletions(owner: string | null, current: () => boolean) {
  for (const intent of readChatDeleteIntents(owner)) {
    void deleteChatWithUndo(
      owner,
      intent.id,
      current,
      async () => {
        const chat = loadConversations(owner).find((item) => item.id === intent.id);
        return chat ? commitPermanentChatDeletion(owner, chat, current) : true;
      },
      intent.deadline,
    ).catch(() => {
      /* Original chat remains available when persistence fails. */
    });
  }
}
