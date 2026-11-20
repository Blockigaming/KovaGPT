import { permanentlyDeleteChat } from "./permanent-chat-delete";
import { toast } from "sonner";
import {
  newId,
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
type ChatForTitle = Pick<Conversation, "id" | "messages">;
export type HomeChatAction =
  | { kind: "delete" | "duplicate" | "pin"; id: string }
  | { kind: "rename"; id: string; title: string }
  | { kind: "restore"; chat: Conversation }
  | { kind: "title"; chat: ChatForTitle };

export async function runHomeChatAction(context: Context, action: HomeChatAction) {
  if (!context.current()) return;
  switch (action.kind) {
    case "title":
      return titleHomeChat(context, action.chat);
    case "restore":
      return restoreHomeChat(context, action.chat);
    case "delete":
      return removeHomeChat(context, action.id);
    case "rename":
      context.setItems((items) =>
        items.map((chat) =>
          chat.id === action.id ? { ...chat, title: action.title, updatedAt: Date.now() } : chat,
        ),
      );
      return;
    case "pin":
      context.setItems((items) =>
        items.map((chat) =>
          chat.id === action.id
            ? { ...chat, pinned: !chat.pinned, pinnedAt: chat.pinned ? undefined : Date.now() }
            : chat,
        ),
      );
      return;
    case "duplicate":
      context.setItems((items) => {
        const source = items.find((chat) => chat.id === action.id);
        if (!source) return items;
        const timestamp = Date.now();
        const copy = {
          ...source,
          id: newId(),
          title: `${source.title} (copy)`,
          messages: source.messages.map((message) => ({ ...message, id: newId() })),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        return [copy, ...items];
      });
      toast.success("Chat duplicated");
  }
}

export async function titleHomeChat(context: Context, chat: ChatForTitle) {
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
export async function removeHomeChat(context: Context, id: string) {
  if (!context.current()) return;
  const chat = context.items.find((item) => item.id === id);
  if (!chat) return;
  const wasActive = context.activeId === id;
  if (wasActive) context.setActive(null);
  try {
    if (!(await permanentlyDeleteChat(context.ownerId, chat, context.current))) {
      if (context.current() && wasActive) context.setActive(id);
      return;
    }
    if (!context.current()) return;
    context.setItems((items) => items.filter((item) => item.id !== id));
  } catch {
    if (context.current()) {
      if (wasActive) context.setActive(id);
      toast.error("Could not delete the chat. Try again.");
    }
  }
}
