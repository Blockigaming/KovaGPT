import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Conversation } from "@/lib/chat-store";
import { subscribeToChatReplies } from "@/lib/chat-reply-activity";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

const toastId = (chatId: string) => `chat-reply:${chatId}`;

export function useChatReplyActivity(
  ownerId: string | undefined,
  conversations: Conversation[],
  activeId: string | null,
  onSelect: (id: string) => void,
) {
  const current = useRef({ ownerId, conversations, activeId, onSelect });
  current.current = { ownerId, conversations, activeId, onSelect };
  const unread = useRef(new Set<string>());
  const [display, setDisplay] = useState<{ ownerId: string; ids: ReadonlySet<string> } | null>(
    null,
  );

  useEffect(() => {
    setDisplay(null);
    if (!ownerId) return;
    const ids = unread.current;
    const update = () => setDisplay({ ownerId, ids: new Set(ids) });
    const clear = () => {
      for (const id of ids) toast.dismiss(toastId(id));
      ids.clear();
    };
    const unsubscribe = subscribeToChatReplies((activity) => {
      const view = current.current;
      if (
        activity?.ownerId !== ownerId ||
        view.ownerId !== ownerId ||
        view.activeId === activity.chatId
      )
        return;
      const { chatId } = activity;
      const chat = view.conversations.find((item) => item.id === chatId);
      if (!chat) return;
      ids.add(chatId);
      update();
      toast("New reply", {
        id: toastId(chatId),
        position: "top-right",
        description: chat.title,
        duration: 6000,
        action: {
          label: "Open chat",
          onClick: () => {
            const latest = current.current;
            if (
              latest.ownerId === ownerId &&
              ids.has(chatId) &&
              latest.conversations.some((item) => item.id === chatId)
            )
              latest.onSelect(chatId);
          },
        },
      });
    });
    const reset = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, ownerId)) {
        clear();
        update();
      }
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      unsubscribe();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
      clear();
    };
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId || !activeId || !unread.current.delete(activeId)) return;
    toast.dismiss(toastId(activeId));
    setDisplay({ ownerId, ids: new Set(unread.current) });
  }, [activeId, ownerId]);

  return display?.ownerId === ownerId ? display?.ids : undefined;
}
