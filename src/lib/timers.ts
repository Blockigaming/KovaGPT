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
const MAX_TIMER_ITEMS = 100;
const MAX_TIMER_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ALARM_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
type TimerUserKey = string | null | undefined;

function read(userKey: TimerUserKey): TimerItem[] {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  if (!key) return [];
  try {
    const raw = safeBrowserStorage("localStorage")?.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate): TimerItem[] => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const item = candidate as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        item.id.length === 0 ||
        item.id.length > 120 ||
        (item.kind !== "timer" && item.kind !== "alarm") ||
        typeof item.label !== "string" ||
        typeof item.fireAt !== "number" ||
        !Number.isFinite(item.fireAt)
      ) {
        return [];
      }
      const durationMs =
        typeof item.durationMs === "number" &&
        Number.isFinite(item.durationMs) &&
        item.durationMs > 0
          ? item.durationMs
          : undefined;
      return [
        {
          id: item.id,
          kind: item.kind,
          label: item.label.slice(0, 120) || (item.kind === "timer" ? "Timer" : "Alarm"),
          fireAt: item.fireAt,
          ...(durationMs === undefined ? {} : { durationMs }),
          ...(item.fired === true ? { fired: true } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

function write(userKey: TimerUserKey, items: TimerItem[]): boolean {
  const key = principalScopedStorageKey(KEY_BASE, userKey);
  const principal = browserStoragePrincipal(userKey);
  if (!key || !principal) return false;
  try {
    const storage = safeBrowserStorage("localStorage");
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(EVT, { detail: { principal } }));
    return true;
  } catch {
    return false;
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

export function addTimer(
  userKey: TimerUserKey,
  durationMs: number,
  label = "Timer",
): TimerItem | null {
  if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > MAX_TIMER_DURATION_MS) {
    return null;
  }
  const current = read(userKey);
  if (current.length >= MAX_TIMER_ITEMS) return null;
  const item: TimerItem = {
    id: `t_${crypto.randomUUID()}`,
    kind: "timer",
    label,
    durationMs,
    fireAt: Date.now() + durationMs,
  };
  return write(userKey, [...current, item]) ? item : null;
}

export function addAlarm(userKey: TimerUserKey, fireAt: number, label = "Alarm"): TimerItem | null {
  if (
    !Number.isFinite(fireAt) ||
    fireAt <= Date.now() ||
    fireAt - Date.now() > MAX_ALARM_AHEAD_MS
  ) {
    return null;
  }
  const current = read(userKey);
  if (current.length >= MAX_TIMER_ITEMS) return null;
  const item: TimerItem = {
    id: `a_${crypto.randomUUID()}`,
    kind: "alarm",
    label,
    fireAt,
  };
  return write(userKey, [...current, item]) ? item : null;
}

export function removeTimer(userKey: TimerUserKey, id: string): boolean {
  return write(
    userKey,
    read(userKey).filter((timer) => timer.id !== id),
  );
}

export function markFired(userKey: TimerUserKey, id: string): boolean {
  return write(
    userKey,
    read(userKey).map((timer) => (timer.id === id ? { ...timer, fired: true } : timer)),
  );
}

export function clearFired(userKey: TimerUserKey): boolean {
  return write(
    userKey,
    read(userKey).filter((timer) => !timer.fired),
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
