import { Button } from "@/components/ui/button";
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
import { loadSettings } from "@/lib/use-nova-settings";
import {
  configureMemoryWrites,
  enqueueMemoryWrite,
  isMemoryWriteBlocked,
} from "@/lib/memory-write-coordinator.mjs";
import { writeMemoryForPrincipal } from "@/lib/chat-summary-snapshot.mjs";
import { automaticMemorySource } from "@/lib/reviewed-memory-policy.mjs";
import { loadConversations, loadArchivedConversations } from "@/lib/chat-store";
import { requestWorkSync } from "@/lib/work-sync-client";
import {
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  isPrincipalBrowserStorageClearedEvent,
  dispatchPrincipalBrowserStorageCleared,
} from "@/lib/principal-browser-storage.mjs";

type ChatHistoryPresentation = ChatHistoryStatus & {
  recoveryPhase?: ChatHistoryStatus["phase"];
};

function chatHistoryPresentation(
  previous: ChatHistoryPresentation,
  next: ChatHistoryStatus,
): ChatHistoryPresentation {
  const recoverable = [
    "offline",
    "rate_limited",
    "device_error",
    "blocked",
    "auth_required",
  ].includes(next.phase);
  const waiting = ["connecting", "saving_device", "syncing", "pending"].includes(next.phase);
  const recoveryPhase = recoverable
    ? next.phase
    : previous.ownerId === next.ownerId && waiting
      ? previous.recoveryPhase
      : undefined;
  return { ...next, recoveryPhase };
}

const EMPTY: ChatHistoryPresentation = {
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
  current = chatHistoryPresentation(current, value);
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
    const summarized = new Map<string, number>();
    const pendingSummaries = new Set<string>();
    let memoryLifetime = new AbortController();
    const syncConversationSummaries = () => {
      if (lifetime.signal.aborted || !controller) return;
      const settings = loadSettings(ownerId);
      const enabled =
        settings.rememberAcross &&
        settings.automaticMemory === true &&
        !isMemoryWriteBlocked(ownerId);
      configureMemoryWrites({ principal: ownerId, enabled: settings.rememberAcross });
      if (!enabled) {
        memoryLifetime.abort();
        return;
      }
      if (memoryLifetime.signal.aborted) memoryLifetime = new AbortController();
      const signal = AbortSignal.any([lifetime.signal, memoryLifetime.signal]);
      for (const record of Object.values(controller.getState()?.records ?? {})) {
        const revision = record.revision;
        if (
          record.dirty ||
          record.conflict ||
          record.localHash !== record.serverHash ||
          typeof revision !== "number"
        )
          continue;
        let conversation;
        try {
          conversation = automaticMemorySource(record.local, ownerId).conversation;
        } catch {
          continue;
        }
        const id = conversation.id;
        if (summarized.get(id) === revision || pendingSummaries.has(id)) continue;
        // Timestamped new prompts are still streaming until the reply gets its
        // completion instant. Older synced conversations can be summarized too.
        const latestPrompt = conversation.messages
          .slice()
          .reverse()
          .find((message) => message.role === "user");
        if (!conversation.messages.at(-1)?.createdAt && latestPrompt?.createdAt) continue;
        pendingSummaries.add(id);
        void enqueueMemoryWrite({
          principal: ownerId,
          run: async () => {
            signal.throwIfAborted();
            const result = await writeMemoryForPrincipal(conversation, ownerId, {
              automaticMemory: true,
              contextSummaries: false,
              signal,
            });
            if (result.memoryUpdated) summarized.set(id, revision);
          },
        })
          .catch(() => undefined)
          .finally(() => pendingSummaries.delete(id));
      }
    };
    window.addEventListener("kova:settings-saved", syncConversationSummaries);
    window.addEventListener("storage", syncConversationSummaries);
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
    let ticking = false;
    const tick = async () => {
      if (lifetime.signal.aborted || ticking || document.visibilityState === "hidden") return;
      ticking = true;
      try {
        await controller?.pump();
      } finally {
        ticking = false;
      }
      if (!lifetime.signal.aborted)
        timer = setTimeout(
          () => void tick(),
          Math.max(
            controller?.retryDelay ?? 0,
            current.pending || !controller?.getState()?.complete ? 1200 : 15000,
          ),
        );
    };
    const online = () => {
      clearTimeout(timer);
      void tick();
    };
    window.addEventListener("online", online);
    const visibility = () => {
      if (document.visibilityState !== "hidden") {
        void readOnlyRefresh();
        online();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    event("connecting");
    async function acquire(lock: Lock | null): Promise<void> {
      if (!ownerId || lifetime.signal.aborted) return;
      if (!lock) {
        event("other_tab");
        await readOnlyRefresh();
        if (lifetime.signal.aborted) return;
        // Wait for the current writer to release ownership. Never steal its
        // lock or make this tab writable before initialization completes.
        return navigator.locks.request(
          `kova-chat-history:${ownerId}`,
          { signal: lifetime.signal },
          acquire,
        );
      }
      event("connecting");
      controller = createChatHistoryController({
        ownerId,
        retireArchives: true,
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
          if (!lifetime.signal.aborted) {
            publish(value);
            syncConversationSummaries();
          }
        },
      });
      controls.set(ownerId, controller);
      try {
        await controller.initialize();
        if (!lifetime.signal.aborted) {
          view.writable = true;
          // Publish the writable boundary after the device snapshot. A lazy
          // controller must be ready before the composer accepts a first send.
          notifyChatHistoryChanged(ownerId, "cloud");
          void tick();
        }
      } catch {
        if (lifetime.signal.aborted) return;
        view.writable = true;
        unregister();
        event("device_error");
      }
      await new Promise<void>((resolve) => {
        if (lifetime.signal.aborted) resolve();
        else lifetime.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    if (!navigator.locks) {
      unregister();
      event("unavailable");
    } else
      void navigator.locks
        .request(`kova-chat-history:${ownerId}`, { ifAvailable: true }, acquire)
        .catch(() => {
          if (!lifetime.signal.aborted) {
            unregister();
            event("unavailable");
          }
        });
    return () => {
      memoryLifetime.abort();
      window.removeEventListener("kova:settings-saved", syncConversationSummaries);
      window.removeEventListener("storage", syncConversationSummaries);
      closeChatHistoryOwner(ownerId);
      lifetime.abort();
      controller?.stop();
      unregister();
      controls.delete(ownerId);
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visibility);
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
  useEffect(() => {
    setBusy(false);
  }, [user?.id]);
  const working = busy || ["connecting", "saving_device", "syncing"].includes(state.phase);
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
    auth_required:
      "Your session needs verification before chat sync can resume. Sign in again, then retry.",
    rate_limited: "Sync is busy. Your chats are saved here and will retry shortly.",
    offline: "Chats are saved on this device. Reconnecting to your account…",
    device_error:
      "Chat history could not be saved on this device. Keep this page open and export important drafts.",
    unavailable: "Account chat sync is unavailable in this browser.",
    cleared: "Device history was cleared. Reload to resume account sync.",
  };
  const critical =
    state.conflicts.length > 0 ||
    ["device_error", "blocked", "auth_required", "cleared", "conflict"].includes(state.phase);
  // Keep a pending migration decision in place while background sync runs.
  // Collapsing it during a pointer press moves the transcript's native controls.
  // Routine sync and passive multi-tab lock handoffs are silent. Real conflicts,
  // unsaved device data and blocked persistence still require recoverable UI.
  const visible =
    state.migration > 0 ||
    state.conflicts.length > 0 ||
    ["device_error", "blocked", "auth_required", "cleared"].includes(state.phase);
  if (!visible) return null;
  const labelPhase =
    state.migration > 0 && !critical ? "local" : (state.recoveryPhase ?? state.phase);
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
      className="mx-auto my-2 max-h-[min(30dvh,16rem)] w-[calc(100%-1.5rem)] max-w-3xl overflow-y-auto rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm [overflow-wrap:anywhere] [&_button]:h-auto [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-2"
      aria-label="Chat history synchronization"
      aria-busy={working || undefined}
    >
      <p role="status" aria-live="polite" className="font-medium text-foreground/80">
        {labels[labelPhase] ?? "Chat sync is pending"}
      </p>
      {state.migration > 0 && (
        <div className="mt-2 space-y-2">
          <p>
            {state.migration} earlier device chat{state.migration === 1 ? "" : "s"} remain on this
            device.
          </p>
          <Button
            data-ui-reference="chatgpt.chat-history.control"
            variant="outline"
            className="rounded-full font-medium text-foreground hover:bg-background"
            disabled={working || !controller}
            onClick={() => void act(() => controller?.migrate())}
          >
            Save existing chats to my account
          </Button>
        </div>
      )}
      {state.recoveryPhase && critical && (
        <Button
          data-ui-reference="chatgpt.chat-history.control"
          variant="outline"
          className="mt-1 rounded-full font-medium text-foreground hover:bg-background"
          disabled={working || !controller}
          onClick={() => void act(() => controller?.retry())}
        >
          <span
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            {working && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
            )}
          </span>
          Retry chat sync
        </Button>
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
          <Button
            data-ui-reference="chatgpt.chat-history.control"
            variant="link"
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
          </Button>
          <Button
            data-ui-reference="chatgpt.chat-history.control"
            variant="link"
            className="mr-3 underline"
            disabled={working}
            onClick={() => void act(() => controller?.resolve(conflict.id, "cloud"))}
          >
            Use account version
          </Button>
          <Button
            data-ui-reference="chatgpt.chat-history.control"
            variant="link"
            className="underline"
            disabled={working}
            onClick={() => void act(() => controller?.resolve(conflict.id, "keep"))}
          >
            {conflict.epochChanged ? "Save device draft as a new chat" : "Keep device version"}
          </Button>
        </details>
      ))}
      {state.conflicts.length > 10 && (
        <p>{state.conflicts.length - 10} more conflicts will appear as these are resolved.</p>
      )}
    </div>
  );
}
