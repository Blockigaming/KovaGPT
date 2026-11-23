/**
 * Images currently rendered in a conversation, so the image viewer's canvas can show
 * them together. Kept in memory only: a reload or a different chat starts empty.
 */
type Entry = { src: string; alt: string; order: number };
const chats = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
const snapshots = new Map<string, Entry[]>();
const EMPTY: Entry[] = [];
const changed = (chat: string) => {
  snapshots.delete(chat);
  listeners.forEach((listener) => listener());
};
let counter = 0;

export function chatKeyFromScope(scope: string): string | null {
  try {
    const parsed: unknown = JSON.parse(scope);
    return Array.isArray(parsed) && parsed.length >= 2 ? JSON.stringify(parsed.slice(0, 2)) : null;
  } catch {
    return null;
  }
}

export function registerConversationImage(chat: string, src: string, alt: string) {
  let images = chats.get(chat);
  if (!images) chats.set(chat, (images = new Map()));
  if (!images.has(src)) images.set(src, { src, alt, order: counter++ });
  changed(chat);
  return () => {
    images.delete(src);
    if (!images.size) chats.delete(chat);
    changed(chat);
  };
}

/** A stable array per change, as useSyncExternalStore requires. */
export function conversationImages(chat: string): Entry[] {
  const images = chats.get(chat);
  if (!images) return EMPTY;
  let snapshot = snapshots.get(chat);
  if (!snapshot) {
    snapshot = [...images.values()].sort((a, b) => a.order - b.order);
    snapshots.set(chat, snapshot);
  }
  return snapshot;
}

export function subscribeConversationImages(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
