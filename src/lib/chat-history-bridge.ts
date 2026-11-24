import type { Conversation } from "./chat-store";
export const CHAT_HISTORY_CHANGED_EVENT = "kova:chat-history-changed";
export type ChatHistoryView = {
  ready: boolean;
  writable: boolean;
  dirty: boolean;
  active: Conversation[];
  archived: Conversation[];
  markDirty(): void;
  write(items: Conversation[], archived: boolean, automatic?: boolean): Promise<boolean>;
};
const views = new Map<string, ChatHistoryView>();
const snapshots = new Map<string, number>();
const closed = new Set<string>();
const activity = new Map<string, () => boolean>();
export const CHAT_HISTORY_WRITER_REQUEST_EVENT = "kova:chat-history-writer-request";

export function registerChatHistoryActivity(ownerId: string, isBusy: () => boolean) {
  activity.set(ownerId, isBusy);
  return () => {
    if (activity.get(ownerId) === isBusy) activity.delete(ownerId);
  };
}

export function chatHistoryIsBusy(ownerId: string) {
  return activity.get(ownerId)?.() ?? false;
}

export function waitForChatHistoryWriter(ownerId: string) {
  if (canSendChatHistory(ownerId)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timeout);
      clearInterval(retry);
      window.removeEventListener(CHAT_HISTORY_CHANGED_EVENT, changed);
      resolve(ready);
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.ownerId === ownerId && canSendChatHistory(ownerId))
        finish(true);
    };
    const request = () =>
      window.dispatchEvent(new CustomEvent(CHAT_HISTORY_WRITER_REQUEST_EVENT, { detail: ownerId }));
    const timeout = window.setTimeout(() => finish(false), 8000);
    const retry = window.setInterval(request, 500);
    window.addEventListener(CHAT_HISTORY_CHANGED_EVENT, changed);
    request();
  });
}
export function chatHistorySnapshot(ownerId: string | null) {
  return snapshots.get(ownerId ?? "guest") ?? 0;
}
export function invalidateChatHistorySnapshot(ownerId: string | null) {
  snapshots.set(ownerId ?? "guest", chatHistorySnapshot(ownerId) + 1);
}
export function closeChatHistoryOwner(ownerId: string | null) {
  closed.add(ownerId ?? "guest");
  invalidateChatHistorySnapshot(ownerId);
}
export function registerChatHistoryView(ownerId: string, view: ChatHistoryView) {
  closed.delete(ownerId);
  views.set(ownerId, view);
  return () => {
    if (views.get(ownerId) === view) views.delete(ownerId);
  };
}
export function chatHistoryView(ownerId: string | null) {
  return ownerId ? views.get(ownerId) : undefined;
}
export function canWriteChatHistory(ownerId: string | null) {
  return !closed.has(ownerId ?? "guest") && (!ownerId || views.get(ownerId)?.writable !== false);
}
export function canSendChatHistory(ownerId: string | null) {
  return canWriteChatHistory(ownerId) && (!ownerId || views.get(ownerId)?.ready === true);
}
export function markChatHistoryDirty(ownerId: string | null) {
  if (ownerId) views.get(ownerId)?.markDirty();
}
export function notifyChatHistoryChanged(ownerId: string, source: "local" | "cloud") {
  if (source === "cloud") invalidateChatHistorySnapshot(ownerId);
  window.dispatchEvent(
    new CustomEvent(CHAT_HISTORY_CHANGED_EVENT, { detail: { ownerId, source } }),
  );
}
