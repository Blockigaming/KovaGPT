// Floating widget in the bottom-right that shows active timers/alarms,
// counts down live, plays a beep + notification when a timer fires, and
// exposes a quick "add timer" affordance.
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  addTimer,
  formatRemaining,
  listTimers,
  markFired,
  removeTimer,
  subscribeTimers,
  type TimerItem,
} from "@/lib/timers";
import { Timer as TimerIcon, X, Plus, Bell } from "lucide-react";
import { toast } from "sonner";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

function beep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    o.start();
    o.stop(ctx.currentTime + 1);
  } catch {
    /* silent */
  }
}

function notify(label: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("KovaGPT", { body: `${label} finished`, silent: false });
    }
  } catch {
    /* ignore */
  }
}

export function TimersWidget({
  userKey,
  principalResolved,
}: {
  userKey: string | null;
  principalResolved: boolean;
}) {
  const principal = principalResolved ? browserStoragePrincipal(userKey) : null;
  const [items, setItems] = useState<TimerItem[]>([]);
  const [itemsPrincipal, setItemsPrincipal] = useState<string | null>(null);
  const ready = principal !== null && itemsPrincipal === principal;
  const visibleItems = useMemo(() => (ready ? items : []), [items, ready]);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(5);
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(() => {
    if (!principalResolved || !principal) {
      setItems([]);
      setItemsPrincipal(null);
      return;
    }
    setItems(listTimers(userKey));
    setItemsPrincipal(principal);
  }, [principal, principalResolved, userKey]);

  useEffect(() => {
    notifiedIdsRef.current.clear();
    refresh();
    const unsub = subscribeTimers(principalResolved ? userKey : undefined, refresh);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [principalResolved, refresh, userKey]);

  useEffect(() => {
    if (!principalResolved || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      setItems([]);
      setItemsPrincipal(principal);
      setOpen(false);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [principal, principalResolved, userKey]);

  // Fire each due timer at most once during this mounted browser session, even when
  // browser storage is unavailable and the durable fired flag cannot be written.
  useEffect(() => {
    if (!ready) return;
    const due = visibleItems.filter(
      (timer) => !timer.fired && timer.fireAt <= now && !notifiedIdsRef.current.has(timer.id),
    );
    if (due.length === 0) return;
    const dueIds = new Set(due.map((timer) => timer.id));
    due.forEach((timer) => notifiedIdsRef.current.add(timer.id));
    setItems((current) =>
      current.map((timer) => (dueIds.has(timer.id) ? { ...timer, fired: true } : timer)),
    );
    for (const timer of due) {
      markFired(userKey, timer.id);
      beep();
      notify(timer.label);
      toast.success(`${timer.label} - done`, { duration: 6000 });
    }
  }, [now, ready, userKey, visibleItems]);

  const active = visibleItems
    .filter((timer) => !timer.fired && !notifiedIdsRef.current.has(timer.id))
    .sort((a, b) => a.fireAt - b.fireAt);
  const nextItem = active[0];

  const requestNotifPerm = () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  };

  return (
    <div className="fixed bottom-auto left-[max(1rem,var(--safe-left))] right-[max(1rem,var(--safe-right))] top-[calc(4rem+var(--safe-top))] z-40 flex flex-col-reverse items-end gap-2 pointer-events-none lg:bottom-[max(1rem,var(--safe-bottom))] lg:left-auto lg:top-auto lg:flex-col">
      {open && (
        <div className="pointer-events-auto w-full rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur sm:w-72">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <TimerIcon className="w-3.5 h-3.5" /> Timers
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-accent"
              aria-label="Close timers"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {!ready ? (
            <div className="px-1 py-2 text-xs text-muted-foreground" role="status">
              Loading timers…
            </div>
          ) : (
            visibleItems.length === 0 && (
              <div className="px-1 py-2 text-xs text-muted-foreground">No timers yet.</div>
            )
          )}
          <ul className="max-h-56 overflow-y-auto space-y-1">
            {visibleItems.map((t) => {
              const remaining = t.fireAt - now;
              const done = t.fired || remaining <= 0;
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-accent/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm truncate">{t.label}</div>
                    <div
                      className={`text-xs tabular-nums ${done ? "text-emerald-500" : "text-muted-foreground"}`}
                    >
                      {done ? "Done" : formatRemaining(remaining)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!ready) return;
                      if (!removeTimer(userKey, t.id)) {
                        toast.error("The timer could not be removed from this browser.");
                      }
                    }}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-background/60"
                    aria-label={`${done ? "Remove" : "Cancel"} ${t.label}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <input
              type="number"
              min={1}
              max={600}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
              step={1}
              disabled={!ready}
              className="h-11 w-16 rounded-md border border-border bg-background px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Minutes"
            />
            <span className="text-xs text-muted-foreground">min</span>
            <button
              type="button"
              disabled={!ready}
              onClick={() => {
                if (!ready) return;
                const timer = addTimer(userKey, minutes * 60 * 1000, `${minutes} min timer`);
                if (!timer) {
                  toast.error("The timer could not be saved in this browser.");
                  return;
                }
                requestNotifPerm();
              }}
              className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-full bg-foreground px-4 text-xs text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="w-3 h-3" /> Start
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-xs font-medium shadow-lg backdrop-blur transition hover:bg-accent"
        aria-label={ready ? "Timers" : "Timers (loading)"}
      >
        {nextItem ? (
          <>
            <Bell className="w-3.5 h-3.5 text-primary" />
            <span className="tabular-nums">{formatRemaining(nextItem.fireAt - now)}</span>
            <span className="text-muted-foreground truncate max-w-[9rem]">{nextItem.label}</span>
          </>
        ) : (
          <>
            <TimerIcon className="w-3.5 h-3.5" />
            <span>Timers</span>
          </>
        )}
      </button>
    </div>
  );
}
