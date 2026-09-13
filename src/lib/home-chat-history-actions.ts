import { toast } from "sonner";
import {
  archiveConversation,
  loadConversations,
  removeArchivedConversation,
  saveConversations,
  type Conversation,
} from "./chat-store";
import type { Dispatch, SetStateAction } from "react";
import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
type Context = {
  ownerId: string | null;
  items: Conversation[];
  current(): boolean;
  setItems: Dispatch<SetStateAction<Conversation[]>>;
  activeId: string | null;
  setActive(id: string | null): void;
};
export async function titleHomeChat(context: Context, chat: Conversation) {
  if (!context.current()) return;
  try {
    const signal = AbortSignal.timeout(15000);
    const response = await fetch("/api/title", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        messages: chat.messages.slice(0, 4).map(({ role, content }) => ({ role, content })),
      }),
    });
    if (!response.ok || !context.current()) return;
    const { title } = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readResponseBytesBounded(response, 4096, { signal, timeoutMs: 5000 }),
      ),
    );
    if (context.current() && typeof title === "string" && title.trim() && title.length <= 200)
      context.setItems((items) =>
        items.map((item) => (item.id === chat.id ? { ...item, title } : item)),
      );
  } catch {
    /* Titles are optional; the saved conversation remains available. */
  }
}
export async function restoreHomeChat(context: Context, chat: Conversation, archived = true) {
  if (!context.current()) return;
  const items = [chat, ...loadConversations(context.ownerId).filter((item) => item.id !== chat.id)];
  if (
    (!chat.temporary && !(await saveConversations(context.ownerId, items))) ||
    (archived && !(await removeArchivedConversation(context.ownerId, chat.id)))
  ) {
    if (context.current()) toast.error("Could not restore chat.");
    return;
  }
  if (!context.current()) return;
  context.setItems((current) => [chat, ...current.filter((item) => item.id !== chat.id)]);
  context.setActive(chat.id);
}
export async function removeHomeChat(context: Context, id: string, archive = false) {
  if (!context.current()) return;
  const chat = context.items.find((item) => item.id === id);
  if (!chat) return;
  const saved = archive
    ? await archiveConversation(context.ownerId, chat)
    : chat.temporary ||
      (await saveConversations(
        context.ownerId,
        context.items.filter((item) => item.id !== id),
      ));
  if (!context.current()) return;
  if (!saved) {
    toast.error(
      archive ? "Could not save the archived chat." : "Chat deletion could not be saved.",
    );
    return;
  }
  context.setItems((current) => current.filter((item) => item.id !== id));
  if (context.activeId === id) context.setActive(null);
  toast.success(archive ? "Chat archived" : "Chat deleted", {
    action: { label: "Undo", onClick: () => restoreHomeChat(context, chat, archive) },
  });
}
