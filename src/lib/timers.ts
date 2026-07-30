// Client-side timers & alarms store. Persists to localStorage so timers
// survive page refresh and continue counting from wall-clock time.
// Emits a "kova-timers" event when the list changes so the widget re-renders.

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

const KEY = "kova-timers-v1";
const EVT = "kova-timers-change";

function read(): TimerItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(items: TimerItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

export function listTimers(): TimerItem[] {
  return read();
}

export function subscribeTimers(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function addTimer(durationMs: number, label = "Timer"): TimerItem {
  const item: TimerItem = {
    id: `t_${crypto.randomUUID()}`,
    kind: "timer",
    label,
    durationMs,
    fireAt: Date.now() + durationMs,
  };
  write([...read(), item]);
  return item;
}

export function addAlarm(fireAt: number, label = "Alarm"): TimerItem {
  const item: TimerItem = {
    id: `a_${crypto.randomUUID()}`,
    kind: "alarm",
    label,
    fireAt,
  };
  write([...read(), item]);
  return item;
}

export function removeTimer(id: string) {
  write(read().filter((t) => t.id !== id));
}

export function markFired(id: string) {
  write(read().map((t) => (t.id === id ? { ...t, fired: true } : t)));
}

export function clearFired() {
  write(read().filter((t) => !t.fired));
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
