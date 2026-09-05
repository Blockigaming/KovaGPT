import { supabase, getSupabaseClientConfigStatus } from "@/integrations/supabase/client";
import {
  loadWorkSessions,
  workSessionsStorageKey,
  loadAgentRuns,
  loadWorkTasks,
  loadWorkTemplates,
  agentWorkspaceStorageKey,
  workTasksStorageKey,
  workTemplatesStorageKey,
} from "@/lib/work-store";
import {
  applyWorkSyncPage,
  createWorkSyncState,
  queueWorkRecent,
  synchronizeWorkTurn,
  assertWorkSyncWritable,
  readWorkSyncState,
  resolveWorkConflict,
  setWorkSyncWritableOwner,
  writeWorkSyncState,
  WORK_STORE_CHANGED_EVENT,
  type RecentWorkKind,
  type WorkSyncState,
  workSyncStorageKey,
} from "@/lib/work-sync-state";

export type WorkSyncStatus = {
  ownerId: string | null;
  phase:
    | "local"
    | "connecting"
    | "syncing"
    | "saved"
    | "offline"
    | "unavailable"
    | "conflict"
    | "other-tab";
  pending: number;
  conflicts: { key: string; title: string }[];
  message?: string;
};
const INITIAL: WorkSyncStatus = { ownerId: null, phase: "local", pending: 0, conflicts: [] };
let status = INITIAL;
const listeners = new Set<() => void>();
let retry: (() => void) | null = null;
export const getWorkSyncStatus = () => status;
export const getServerWorkSyncStatus = () => INITIAL;
export function subscribeWorkSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function retryWorkSync() {
  retry?.();
}
function publish(next: WorkSyncStatus) {
  status = next;
  for (const listener of listeners) listener();
}
export function notifyWorkStore(ownerId: string | null) {
  window.dispatchEvent(new CustomEvent(WORK_STORE_CHANGED_EVENT, { detail: { ownerId } }));
}

/** Pin the bearer to the expected account; never let authFetch silently substitute a newly signed-in user. */
export async function requestWorkSync(
  ownerId: string,
  path: string,
  signal: AbortSignal,
  body?: unknown,
) {
  const timeout = AbortSignal.timeout(15_000);
  const combined = AbortSignal.any([signal, timeout]);
  const sessionResult = await Promise.race([
    supabase.auth.getSession(),
    new Promise<never>((_, reject) => {
      if (combined.aborted) reject(new Error("work_sync_request_canceled"));
      else
        combined.addEventListener("abort", () => reject(new Error("work_sync_request_canceled")), {
          once: true,
        });
    }),
  ]);
  const session = sessionResult.data.session;
  if (combined.aborted || session?.user.id !== ownerId || !session.access_token)
    throw new Error("work_sync_identity_changed");
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    signal: combined,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new Error("work_sync_response_too_large");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("work_sync_unavailable");
  }
  if (!response.ok) {
    const code =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "work_sync_unavailable";
    const error = new Error(code) as Error & { status: number; retryAfter: number };
    error.status = response.status;
    error.retryAfter = Math.min(
      300,
      Math.max(6, Number(response.headers.get("Retry-After")) || 60),
    );
    throw error;
  }
  return payload;
}

export function startWorkSync(ownerId: string): () => void {
  const controller = new AbortController();
  let stopped = false,
    held = false,
    running = false,
    timer: number | undefined,
    lastPull = 0;
  let unlock: (() => void) | undefined;
  let dispose = () => {};
  const alive = () => !stopped && held && !controller.signal.aborted;
  const load = () => {
    const state = readWorkSyncState(localStorage, ownerId);
    if (!state) throw new Error("work_sync_local_state_missing");
    return state;
  };
  const describe = (phase: WorkSyncStatus["phase"], message?: string) => {
    if (stopped) return;
    let state: WorkSyncState | null = null;
    try {
      state = readWorkSyncState(localStorage, ownerId);
    } catch {
      /* report recovery state */
    }
    const conflicts = Object.entries(state?.pending ?? {})
      .filter(([, p]) => p.conflict)
      .map(([key, p]) => ({
        key,
        title:
          typeof p.desired === "object" && p.desired
            ? String(p.desired.name ?? p.desired.objective ?? "Saved work")
            : (state?.records[p.id]?.title ?? "Recent work"),
      }));
    publish({
      ownerId,
      phase: conflicts.length ? "conflict" : phase,
      conflicts,
      pending: Object.keys(state?.pending ?? {}).length,
      ...(message ? { message } : {}),
    });
  };
  const save = (state: WorkSyncState) => {
    if (!alive()) throw new Error("work_sync_identity_changed");
    writeWorkSyncState(localStorage, state);
    notifyWorkStore(ownerId);
  };
  const schedule = (ms = 6_000) => {
    window.clearTimeout(timer);
    if (!stopped) timer = window.setTimeout(() => void cycle(), ms);
  };
  const cycle = async () => {
    if (!alive() || running) return;
    if (!navigator.onLine) {
      describe("offline", "Changes are kept on this device until you reconnect.");
      schedule(30_000);
      return;
    }
    running = true;
    let delay = 6_000;
    try {
      describe("syncing");
      if (!readWorkSyncState(localStorage, ownerId)) {
        const page = await requestWorkSync(
          ownerId,
          "/api/work/sync?cursor=0&limit=40",
          controller.signal,
        );
        if (!alive()) return;
        const initial = createWorkSyncState(ownerId, {
          session: loadWorkSessions(ownerId),
          task: loadWorkTasks(ownerId),
          template: loadWorkTemplates(ownerId),
          agent_draft: loadAgentRuns(ownerId),
        });
        save(applyWorkSyncPage(initial, page));
      }
      // The atomic envelope now contains every local body, including pending/conflicting copies.
      // Retire duplicate caches so later deletion cannot leave or resurrect an old local body.
      for (const key of [
        workSessionsStorageKey(ownerId),
        workTasksStorageKey(ownerId),
        workTemplatesStorageKey(ownerId),
        agentWorkspaceStorageKey(ownerId),
      ])
        localStorage.removeItem(key);
      const pull = lastPull === 0 || Date.now() - lastPull > 30_000;
      await synchronizeWorkTurn({
        load,
        save,
        alive,
        pull,
        mutationId: () => crypto.randomUUID(),
        request: (path, body) => requestWorkSync(ownerId, path, controller.signal, body),
      });
      if (pull) lastPull = Date.now();
      const current = load();
      describe(Object.keys(current.pending).length ? "syncing" : "saved");
      if (!Object.keys(current.pending).length) delay = 30_000;
    } catch (error) {
      if (!alive()) return;
      const code = error instanceof Error ? error.message : "work_sync_unavailable";
      lastPull = 0;
      delay = (error as { retryAfter?: number }).retryAfter
        ? (error as { retryAfter: number }).retryAfter * 1_000
        : 60_000;
      describe(
        code === "work_sync_conflict" ? "conflict" : "unavailable",
        code === "work_sync_storage_quota_exceeded"
          ? "Account storage is full. Your pending changes remain on this device."
          : "Sync is unavailable. Your saved work and pending changes remain on this device.",
      );
    } finally {
      running = false;
      if (alive()) schedule(delay);
    }
  };
  const wake = () => {
    if (alive() && !running) {
      lastPull = 0;
      schedule();
    }
  };
  const changed = (event: Event) => {
    if (
      (event as CustomEvent<{ ownerId?: string }>).detail?.ownerId === ownerId &&
      !running &&
      alive()
    ) {
      describe("syncing");
      schedule();
    }
  };
  const conflict = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        ownerId: string;
        key: string;
        choice: "account" | "device" | "new_session";
      }>
    ).detail;
    if (!alive() || detail?.ownerId !== ownerId) return;
    try {
      save(resolveWorkConflict(load(), detail.key, detail.choice));
      lastPull = 0;
      wake();
    } catch {
      describe("unavailable", "The conflict changed. Refresh sync before trying again.");
    }
  };
  const storageCleared = (event: StorageEvent) => {
    if (
      event.key === null ||
      (event.key === workSyncStorageKey(ownerId) && event.newValue === null)
    )
      dispose();
  };
  describe("connecting");
  retry = wake;
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  window.addEventListener(WORK_STORE_CHANGED_EVENT, changed);
  window.addEventListener("kova:work-sync-resolve", conflict);
  window.addEventListener("storage", storageCleared);
  if (!getSupabaseClientConfigStatus().configured || !navigator.locks)
    describe(
      "unavailable",
      "Saved work remains on this device. Account sync is unavailable in this browser.",
    );
  else
    void navigator.locks
      .request(`kova-work-sync:${ownerId}`, { signal: controller.signal }, async () => {
        if (stopped) return;
        held = true;
        setWorkSyncWritableOwner(ownerId);
        await new Promise<void>((resolve) => {
          unlock = resolve;
          void cycle();
        });
        setWorkSyncWritableOwner(null, ownerId);
        held = false;
      })
      .catch(() => {
        if (!stopped) describe("unavailable");
      });
  // Waiting for the per-account tab lease is read-only, preventing split local queues.
  const waitingTimer = window.setTimeout(() => {
    if (!stopped && !held && navigator.locks && getSupabaseClientConfigStatus().configured)
      describe("other-tab");
  }, 500);
  dispose = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    window.clearTimeout(timer);
    window.clearTimeout(waitingTimer);
    unlock?.();
    if (held) setWorkSyncWritableOwner(null, ownerId);
    window.removeEventListener("online", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener(WORK_STORE_CHANGED_EVENT, changed);
    window.removeEventListener("kova:work-sync-resolve", conflict);
    window.removeEventListener("storage", storageCleared);
    retry = null;
    publish(INITIAL);
  };
  return dispose;
}

export function recordWorkRecent(
  ownerId: string,
  kind: RecentWorkKind,
  id: string,
  operation: "keep" | "pin" | "unpin" | "forget" = "keep",
) {
  assertWorkSyncWritable(ownerId);
  const state = readWorkSyncState(localStorage, ownerId);
  if (!state || status.ownerId !== ownerId || status.phase === "other-tab") return;
  writeWorkSyncState(localStorage, queueWorkRecent(state, kind, id, operation));
  notifyWorkStore(ownerId);
}
