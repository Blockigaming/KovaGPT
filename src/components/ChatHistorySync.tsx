import { useEffect, useState, useSyncExternalStore } from "react";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  createChatHistoryController,
  type ChatHistoryStatus,
} from "@/lib/chat-history-controller.mjs";
import { loadChatHistoryDevice, commitChatHistoryDevice } from "@/lib/chat-history-idb.mjs";
import { visibleChatHistory, restoreChatHistoryState } from "@/lib/chat-history-state.mjs";
import {
  registerChatHistoryView,
  closeChatHistoryOwner,
  notifyChatHistoryChanged,
  type ChatHistoryView,
} from "@/lib/chat-history-bridge";
import { loadConversations, loadArchivedConversations } from "@/lib/chat-store";
import { requestWorkSync } from "@/lib/work-sync-client";
import {
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  isPrincipalBrowserStorageClearedEvent,
  dispatchPrincipalBrowserStorageCleared,
} from "@/lib/principal-browser-storage.mjs";

const EMPTY: ChatHistoryStatus = {
  ownerId: null,
  phase: "local",
  error: null,
  pending: 0,
  migration: 0,
  conflicts: [],
};
let current = EMPTY;
const listeners = new Set<() => void>();
const controls = new Map<string, ReturnType<typeof createChatHistoryController>>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = (value: ChatHistoryStatus) => {
  current = value;
  for (const listener of listeners) listener();
};

export function ChatHistorySyncRuntime() {
  const { isLoaded, user } = useUser();
  const ownerId = isLoaded ? user?.id : undefined;
  useEffect(() => {
    if (!ownerId) return;
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: ReturnType<typeof createChatHistoryController> | null = null;
    const legacy = {
      active: loadConversations(ownerId),
      archived: loadArchivedConversations(ownerId),
    };
    const view: ChatHistoryView = {
      ready: false,
      writable: false,
      dirty: false,
      active: [],
      archived: [],
      markDirty() {
        controller?.markDirty();
        view.dirty = true;
      },
      write: (items, archived, automatic) =>
        controller?.write(items, archived, automatic) ?? Promise.resolve(false),
    };
    const unregister = registerChatHistoryView(ownerId, view);
    const channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("kova-chat-history");
    const event = (phase: string, error: string | null = null) =>
      publish({ ...EMPTY, ownerId, phase, error });
    const reset = (e: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(e, ownerId)) return;
      closeChatHistoryOwner(ownerId);
      lifetime.abort();
      controller?.stop();
      unregister();
      controls.delete(ownerId);
      event("cleared");
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    const readOnlyRefresh = async () => {
      if (lifetime.signal.aborted || view.writable || document.visibilityState === "hidden") return;
      try {
        const stored = await loadChatHistoryDevice(ownerId);
        if (!stored || stored.cleared || lifetime.signal.aborted || stored.ownerId !== ownerId)
          return;
        const state = await restoreChatHistoryState(stored, ownerId);
        if (lifetime.signal.aborted) return;
        view.active = visibleChatHistory(state);
        view.archived = visibleChatHistory(state, true);
        view.ready = true;
        notifyChatHistoryChanged(ownerId, "cloud");
      } catch {
        event("device_error");
      }
    };
    if (channel)
      channel.onmessage = (e) => {
        if (e.data?.ownerId !== ownerId) return;
        if (e.data.reset === true) dispatchPrincipalBrowserStorageCleared(ownerId);
        else if (!view.writable) {
          clearTimeout(timer);
          timer = setTimeout(() => void readOnlyRefresh(), 500);
        }
      };
    const tick = async () => {
      if (lifetime.signal.aborted) return;
      await controller?.pump();
      if (!lifetime.signal.aborted)
        timer = setTimeout(
          () => void tick(),
          current.pending || !controller?.getState()?.complete ? 1200 : 15000,
        );
    };
    const online = () => {
      clearTimeout(timer);
      void tick();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", readOnlyRefresh);
    event("connecting");
    if (!navigator.locks) {
      unregister();
      event("unavailable");
    } else
      void navigator.locks
        .request(`kova-chat-history:${ownerId}`, { ifAvailable: true }, async (lock) => {
          if (lifetime.signal.aborted) return;
          if (!lock) {
            event("other_tab");
            await readOnlyRefresh();
            return;
          }
          controller = createChatHistoryController({
            ownerId,
            signal: lifetime.signal,
            loadDevice: loadChatHistoryDevice,
            commitDevice: commitChatHistoryDevice,
            getLegacy: () => legacy,
            transport: ({ method, epoch, cursor, body, signal }) =>
              requestWorkSync(
                ownerId,
                method === "GET"
                  ? `/api/chat/history?cursor=${cursor ?? 0}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}`
                  : "/api/chat/history",
                signal,
                body,
              ),
            changed: ({ active, archived, source, dirty }) => {
              if (lifetime.signal.aborted) return;
              view.active = active;
              view.archived = archived;
              view.ready = true;
              view.dirty = dirty;
              notifyChatHistoryChanged(ownerId, source);
              channel?.postMessage({ ownerId });
            },
            status: (value) => {
              view.dirty = controller?.dirty ?? false;
              if (!lifetime.signal.aborted) publish(value);
            },
          });
          controls.set(ownerId, controller);
          try {
            await controller.initialize();
            if (!lifetime.signal.aborted) {
              view.writable = true;
              void tick();
            }
          } catch {
            view.writable = true;
            unregister();
            event("device_error");
          }
          await new Promise<void>((resolve) => {
            if (lifetime.signal.aborted) resolve();
            else lifetime.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        })
        .catch(() => {
          if (!lifetime.signal.aborted) {
            unregister();
            event("unavailable");
          }
        });
    return () => {
      closeChatHistoryOwner(ownerId);
      lifetime.abort();
      controller?.stop();
      unregister();
      controls.delete(ownerId);
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", readOnlyRefresh);
      if (current.ownerId === ownerId) publish(EMPTY);
    };
  }, [ownerId]);
  return null;
}

export function ChatHistorySyncStatus() {
  const { user } = useUser();
  const state = useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );
  const [busy, setBusy] = useState(false);
  if (!user || state.ownerId !== user.id) return null;
  const labels: Record<string, string> = {
    local: "Earlier chat history remains on this device",
    blocked: "Some chat changes could not sync. Check available storage and retry.",
    conflict: "Chat versions need your choice before syncing.",
    connecting: "Connecting chat history…",
    saving_device: "Saving chat on this device…",
    syncing: "Synchronizing chat history…",
    pending: "Chat changes are waiting to sync",
    saved: "Chat history is up to date",
    offline: "Chat sync is offline. Device changes are retained.",
    device_error:
      "Chat history could not be saved on this device. Keep this page open and export important drafts.",
    other_tab: "Chat editing is open in another tab. Close it and reload here to edit.",
    unavailable: "Account chat sync is unavailable in this browser.",
    cleared: "Device history was cleared. Reload to resume account sync.",
  };
  async function act(action: () => Promise<void> | undefined) {
    setBusy(true);
    try {
      await action();
    } catch {
      /* The controller retains unsaved copies and its visible retry state. */
    } finally {
      setBusy(false);
    }
  }
  const controller = controls.get(user.id);
  return (
    <div
      className="mx-auto w-full max-w-3xl px-4 py-1 text-xs text-muted-foreground"
      aria-label="Chat history synchronization"
    >
      <p role="status">{labels[state.phase] ?? "Chat sync is pending"}</p>
      {state.migration > 0 && (
        <p>
          {state.migration} earlier device chat{state.migration === 1 ? "" : "s"} remain on this
          device.{" "}
          <button
            className="underline"
            disabled={busy || !controller}
            onClick={() => void act(() => controller?.migrate())}
          >
            Save existing chats to my account
          </button>
        </p>
      )}
      {["offline", "device_error", "blocked"].includes(state.phase) && (
        <button
          className="underline"
          disabled={busy || !controller}
          onClick={() => void act(() => controller?.retry())}
        >
          Retry chat sync
        </button>
      )}
      {state.conflicts.slice(0, 10).map((conflict) => (
        <details key={conflict.id} className="mt-2 rounded border p-2">
          <summary>Choose which version of “{conflict.title}” to keep</summary>
          <div className="grid gap-2 sm:grid-cols-2">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
              Device draft:{" "}
              {conflict.local?.messages
                .map((m) => m.content)
                .join("\n\n")
                .slice(0, 20000) ?? "Deleted on this device"}
            </pre>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
              Account version:{" "}
              {conflict.cloud?.messages
                .map((m) => m.content)
                .join("\n\n")
                .slice(0, 20000) ?? "Deleted from account"}
            </pre>
          </div>
          <button
            className="mr-3 underline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [JSON.stringify({ device: conflict.local, account: conflict.cloud }, null, 2)],
                  { type: "application/json" },
                ),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "chat-conflict-copies.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download both complete copies
          </button>
          <button
            className="mr-3 underline"
            disabled={busy}
            onClick={() => void act(() => controller?.resolve(conflict.id, "cloud"))}
          >
            Use account version
          </button>
          <button
            className="underline"
            disabled={busy}
            onClick={() => void act(() => controller?.resolve(conflict.id, "keep"))}
          >
            {conflict.epochChanged ? "Save device draft as a new chat" : "Keep device version"}
          </button>
        </details>
      ))}
      {state.conflicts.length > 10 && (
        <p>{state.conflicts.length - 10} more conflicts will appear as these are resolved.</p>
      )}
    </div>
  );
}
