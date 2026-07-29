import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listCloudConversations,
  syncCloudConversations,
  type CloudConversationRow,
} from "@/lib/cloud-conversations.functions";
import { reconcileCloudHistory } from "@/lib/cloud-conversations";
import {
  loadArchivedConversations,
  loadConversations,
  saveArchivedConversations,
  type Conversation,
} from "@/lib/chat-store";

type SyncState = "idle" | "loading" | "synced" | "syncing" | "error";

export function useCloudChatHistory({
  enabled,
  userId,
  conversations,
  setConversations,
  paused = false,
}: {
  enabled: boolean;
  userId: string | null;
  conversations: Conversation[];
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  paused?: boolean;
}) {
  const listCloud = useServerFn(listCloudConversations);
  const syncCloud = useServerFn(syncCloudConversations);
  const [state, setState] = useState<SyncState>("idle");
  const [error, setError] = useState<string | null>(null);
  const versionsRef = useRef(new Map<string, number>());
  const readyRef = useRef(false);
  const hydratedRef = useRef(false);
  const deletedRef = useRef(new Map<string, { conversation: Conversation; updatedAt: number }>());
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const pushChanges = useCallback(
    async (explicit?: Array<{ conversation: Conversation; archived: boolean }>) => {
      if (!enabled || !readyRef.current) return;
      const archived = loadArchivedConversations();
      const candidates = explicit ?? [
        ...conversationsRef.current.map((conversation) => ({ conversation, archived: false })),
        ...archived.map((conversation) => ({ conversation, archived: true })),
      ];
      const changed = candidates.filter(
        ({ conversation }) =>
          !conversation.temporary &&
          !deletedRef.current.has(conversation.id) &&
          conversation.updatedAt > (versionsRef.current.get(conversation.id) ?? -1),
      );
      const deleted = [...deletedRef.current.entries()].map(([id, item]) => ({
        conversation_id: id,
        payload: item.conversation,
        archived: false,
        deleted: true,
        client_updated_at: item.updatedAt,
      }));
      const rows = [
        ...changed.map(({ conversation, archived: isArchived }) => ({
          conversation_id: conversation.id,
          payload: conversation,
          archived: isArchived,
          deleted: false,
          client_updated_at: conversation.updatedAt,
        })),
        ...deleted,
      ];
      if (!rows.length) return;
      setState("syncing");
      setError(null);
      try {
        for (let index = 0; index < rows.length; index += 50) {
          await syncCloud({ data: { rows: rows.slice(index, index + 50) } });
        }
        changed.forEach(({ conversation }) =>
          versionsRef.current.set(conversation.id, conversation.updatedAt),
        );
        deleted.forEach((row) => {
          versionsRef.current.set(row.conversation_id, row.client_updated_at);
          deletedRef.current.delete(row.conversation_id);
        });
        setState("synced");
      } catch (cause) {
        setState("error");
        setError(cause instanceof Error ? cause.message : "Cloud chat history could not be saved.");
      }
    },
    [enabled, syncCloud],
  );

  const refresh = useCallback(async () => {
    if (!enabled || !userId) return;
    readyRef.current = false;
    setState("loading");
    setError(null);
    try {
      const rows = (await listCloud()) as CloudConversationRow[];
      versionsRef.current = new Map(
        rows.map((row) => [row.conversation_id, row.client_updated_at]),
      );
      const deviceActive = hydratedRef.current
        ? conversationsRef.current
        : conversationsRef.current.length
          ? conversationsRef.current
          : loadConversations();
      const reconciled = reconcileCloudHistory(deviceActive, loadArchivedConversations(), rows);
      setConversations(reconciled.active);
      saveArchivedConversations(reconciled.archived);
      hydratedRef.current = true;
      readyRef.current = true;
      setState("synced");
      if (reconciled.pending.length) await pushChanges(reconciled.pending);
    } catch (cause) {
      readyRef.current = true;
      setState("error");
      setError(cause instanceof Error ? cause.message : "Cloud chat history could not be loaded.");
    }
  }, [enabled, listCloud, pushChanges, setConversations, userId]);

  useEffect(() => {
    versionsRef.current.clear();
    deletedRef.current.clear();
    readyRef.current = false;
    hydratedRef.current = false;
    if (!enabled || !userId) {
      setState("idle");
      setError(null);
      return;
    }
    void refresh();
  }, [enabled, refresh, userId]);

  useEffect(() => {
    if (!enabled || !readyRef.current || paused) return;
    const timer = window.setTimeout(() => void pushChanges(), 900);
    return () => window.clearTimeout(timer);
  }, [conversations, enabled, paused, pushChanges]);

  const markDeleted = useCallback(
    (conversation: Conversation) => {
      if (!enabled) return;
      deletedRef.current.set(conversation.id, {
        conversation,
        updatedAt: Math.max(Date.now(), conversation.updatedAt + 1),
      });
      window.setTimeout(() => void pushChanges(), 0);
    },
    [enabled, pushChanges],
  );

  const cancelDeletion = useCallback((id: string) => {
    deletedRef.current.delete(id);
  }, []);

  return { state, error, refresh, pushChanges, markDeleted, cancelDeletion };
}
