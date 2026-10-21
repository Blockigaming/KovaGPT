import { confirmPermanentChat } from "../components/ChatDeleteConfirmation";
import {
  chatStoragePrincipal,
  sanitizeArchivedConversations,
  loadConversations,
  saveConversations,
  type Conversation,
} from "./chat-store";
import { canWriteChatHistory } from "./chat-history-bridge";
import {
  DEFAULT_TRASH_RETENTION_MS,
  expireTrash,
  validateRetention,
  type TrashState,
} from "./chat-trash-policy.mjs";
export const TRASH_CHANGED_EVENT = "kova:chat-trash-changed";
export const trashStorageKey = (owner: string | null) =>
  `kova-chat-trash-v1:${chatStoragePrincipal(owner)}`;
export function readChatTrash(owner: string | null): TrashState {
  const fallback = { retentionMs: DEFAULT_TRASH_RETENTION_MS, entries: [] };
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(trashStorageKey(owner));
  if (!raw) return fallback;
  // Never overwrite corrupt/unreadable storage with an empty state.
  const value = JSON.parse(raw);
  validateRetention(value.retentionMs);
  if (!Array.isArray(value.entries)) throw new Error("Trash could not be read.");
  for (const entry of value.entries) {
    if (
      !Number.isSafeInteger(entry.deletedAt) ||
      !Number.isSafeInteger(entry.expiresAt) ||
      entry.deletedAt < 0 ||
      entry.expiresAt < entry.deletedAt ||
      sanitizeArchivedConversations([entry.conversation], owner).length !== 1
    )
      throw new Error("Trash could not be read.");
  }
  return {
    retentionMs: value.retentionMs,
    entries: value.entries.map((entry: TrashState["entries"][number]) => ({
      ...entry,
      conversation: sanitizeArchivedConversations([entry.conversation], owner)[0],
    })),
  };
}
export function writeChatTrash(owner: string | null, state: TrashState) {
  if (!canWriteChatHistory(owner))
    throw new Error("Chat changes are unavailable for this account.");
  localStorage.setItem(trashStorageKey(owner), JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(TRASH_CHANGED_EVENT, { detail: { owner } }));
}
/** Only an app-visit sweep; deliberately NOT a server scheduler. */
export function sweepChatTrash(owner: string | null, now = Date.now()) {
  const state = readChatTrash(owner);
  const next = expireTrash(state, now);
  if (next.entries.length !== state.entries.length) writeChatTrash(owner, next);
  return next;
}
export async function moveChatToTrash(
  owner: string | null,
  chat: Conversation,
  items: Conversation[],
  current: () => boolean = () => true,
) {
  if (!current() || !canWriteChatHistory(owner)) return false;
  let state = readChatTrash(owner);
  if (chat.temporary || state.retentionMs === 0) {
    if (
      !(await confirmPermanentChat(chat.title, Boolean(chat.temporary))) ||
      !current() ||
      !canWriteChatHistory(owner)
    )
      return false;
    if (chat.temporary) return true;
    // A changed retention preference while confirming must never lose a recoverable copy.
    state = readChatTrash(owner);
  }
  if (state.retentionMs !== 0) {
    const deletedAt = Date.now();
    // Persist the recoverable copy BEFORE changing history; a failed history write retains it.
    writeChatTrash(owner, {
      ...state,
      entries: [
        { conversation: chat, deletedAt, expiresAt: deletedAt + state.retentionMs },
        ...state.entries.filter((entry) => entry.conversation.id !== chat.id),
      ],
    });
  }
  if (!current()) return false;
  const saved = await saveConversations(
    owner,
    items.filter((item) => item.id !== chat.id),
  );
  if (!saved) throw new Error("Chat history could not be updated. The recoverable copy is kept.");
  return true;
}
export async function restoreChatTrash(
  owner: string | null,
  id: string,
  current: () => boolean = () => true,
) {
  if (!current() || !canWriteChatHistory(owner)) return false;
  const state = readChatTrash(owner);
  const entry = state.entries.find((item) => item.conversation.id === id);
  if (!entry || entry.expiresAt <= Date.now()) return false;
  const items = loadConversations(owner);
  // An active copy wins if a previous restore/remove partially succeeded.
  const chat = items.find((item) => item.id === id) ?? entry.conversation;
  if (
    !(await saveConversations(owner, [chat, ...items.filter((item) => item.id !== id)])) ||
    !current()
  )
    return false;
  const latest = readChatTrash(owner);
  writeChatTrash(owner, {
    ...latest,
    entries: latest.entries.filter((item) => item.conversation.id !== id),
  });
  return true;
}
