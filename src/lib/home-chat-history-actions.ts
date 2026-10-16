import { toast } from "sonner";
import {
  archiveConversation,
  loadConversations,
  removeArchivedConversation,
  saveConversations,
  newId,
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
  restore?: (chat: Conversation, archived: boolean) => Promise<void>;
};
export async function renameHomeChat(context: Context, id: string, value: string) {
  const title = value.trim().slice(0, 160);
  const chat = context.items.find((item) => item.id === id);
  if (!context.current() || !chat || !title) return false;
  const updatedAt = Date.now();
  try {
    const next = context.items.map((item) =>
      item.id === id ? { ...item, title, updatedAt } : item,
    );
    const saved =
      chat.temporary ||
      (await saveConversations(
        context.ownerId,
        next.filter((item) => !item.temporary),
      ));
    if (!context.current()) return false;
    if (!saved) throw new Error("Save unavailable");
    context.setItems((items) =>
      items.map((item) => (item.id === id ? { ...item, title, updatedAt } : item)),
    );
    return true;
  } catch {
    if (context.current()) toast.error("This chat could not be renamed. Please retry.");
    return false;
  }
}

export async function duplicateHomeChat(context: Context, id: string) {
  const chat = context.items.find((item) => item.id === id);
  if (!context.current() || !chat) return false;
  const copy: Conversation = {
    ...chat,
    id: newId(),
    title: `${chat.title} (copy)`,
    messages: chat.messages.map((message) => ({ ...message, id: newId() })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    const saved =
      copy.temporary ||
      (await saveConversations(
        context.ownerId,
        [copy, ...context.items].filter((item) => !item.temporary),
      ));
    if (!context.current()) return false;
    if (!saved) throw new Error("Save unavailable");
    context.setItems((items) => [copy, ...items]);
    toast.success("Chat duplicated");
    return true;
  } catch {
    if (context.current()) toast.error("This chat could not be duplicated. Please retry.");
    return false;
  }
}
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
        context.items.filter((item) => item.id !== id && !item.temporary),
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
    action: {
      label: "Undo",
      onClick: () =>
        context.restore ? context.restore(chat, archive) : restoreHomeChat(context, chat, archive),
    },
  });
}
