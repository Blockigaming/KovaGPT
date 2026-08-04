// Client-side timers & alarms store. Persists to localStorage so timers
// survive page refresh and continue counting from wall-clock time.
// Emits a "kova-timers" event when the list changes so the widget re-renders.
import {
  browserStoragePrincipal,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export type TimerItem = {
  id: string;
  kind: "timer" | "alarm";
  label: string;
  // Absolute unix ms at which this timer/alarm fires.
  fireAt: number;
  // For timers, original duration in ms (used to display total).
  durationMs?: number;
  fired?: boolean;
};

const KEY_BASE = "kova-timers";
const EVT = "kova-timers-change";
type TimerUserKey = string | null | undefined;

function read(userKey: TimerUserKey): TimerItem[] {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  if (!key) return [];
  try {
    const raw = safeBrowserStorage("localStorage")?.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(userKey: TimerUserKey, items: TimerItem[]) {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  const principal = browserStoragePrincipal(userKey);
  if (!key || !principal) return;
  try {
    safeBrowserStorage("localStorage")?.setItem(key, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(EVT, { detail: { principal } }));
  } catch {
    /* ignore */
  }
}

export function listTimers(userKey: TimerUserKey): TimerItem[] {
  return read(userKey);
}

export function subscribeTimers(userKey: TimerUserKey, cb: () => void): () => void {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  const principal = browserStoragePrincipal(userKey);
  if (!key || !principal || typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (event instanceof StorageEvent) {
      if (event.key === key) cb();
      return;
    }
    if ((event as CustomEvent<{ principal?: string }>).detail?.principal === principal) cb();
  };
  window.addEventListener(EVT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function addTimer(userKey: TimerUserKey, durationMs: number, label = "Timer"): TimerItem {
  const item: TimerItem = {
    id: `t_${crypto.randomUUID()}`,
    kind: "timer",
    label,
    durationMs,
    fireAt: Date.now() + durationMs,
  };
  write(userKey, [...read(userKey), item]);
  return item;
}

export function addAlarm(userKey: TimerUserKey, fireAt: number, label = "Alarm"): TimerItem {
  const item: TimerItem = {
    id: `a_${crypto.randomUUID()}`,
    kind: "alarm",
    label,
    fireAt,
  };
  write(userKey, [...read(userKey), item]);
  return item;
}

export function removeTimer(userKey: TimerUserKey, id: string) {
  write(
    userKey,
    read(userKey).filter((t) => t.id !== id),
  );
}

export function markFired(userKey: TimerUserKey, id: string) {
  write(
    userKey,
    read(userKey).map((t) => (t.id === id ? { ...t, fired: true } : t)),
  );
}

export function clearFired(userKey: TimerUserKey) {
  write(
    userKey,
    read(userKey).filter((t) => !t.fired),
  );
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
