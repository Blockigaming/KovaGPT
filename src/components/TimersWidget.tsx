// Floating widget in the bottom-right that shows active timers/alarms,
// counts down live, plays a beep + notification when a timer fires, and
// exposes a quick "add timer" affordance.
import { useCallback, useEffect, useMemo, useState } from "react";
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

  // Fire any timers that have hit their fireAt (guard against re-firing).
  useEffect(() => {
    if (!ready) return;
    for (const t of visibleItems) {
      if (!t.fired && t.fireAt <= now) {
        markFired(userKey, t.id);
        beep();
        notify(t.label);
        toast.success(`${t.label} - done`, { duration: 6000 });
      }
    }
  }, [now, ready, userKey, visibleItems]);

  const active = visibleItems.filter((t) => !t.fired);
  const nextItem = active[0];

  const requestNotifPerm = () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  };

  if (visibleItems.length === 0 && !open) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 pointer-events-none flex flex-col items-end gap-2">
      {open && (
        <div className="pointer-events-auto w-72 rounded-2xl border border-border bg-card/95 backdrop-blur shadow-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <TimerIcon className="w-3.5 h-3.5" /> Timers
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-accent"
              aria-label="Close timers"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {visibleItems.length === 0 && (
            <div className="text-xs text-muted-foreground px-1 py-2">No timers yet.</div>
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
                    onClick={() => ready && removeTimer(userKey, t.id)}
                    className="p-1 rounded hover:bg-background/60"
                    aria-label="Cancel"
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
              className="w-14 px-2 py-1 text-xs rounded-md border border-border bg-background"
              aria-label="Minutes"
            />
            <span className="text-xs text-muted-foreground">min</span>
            <button
              onClick={() => {
                if (!ready) return;
                addTimer(userKey, minutes * 60 * 1000, `${minutes} min timer`);
                requestNotifPerm();
              }}
              className="ml-auto text-xs px-3 py-1 rounded-full bg-foreground text-background hover:opacity-90 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Start
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/95 backdrop-blur shadow-lg px-3 py-2 text-xs font-medium hover:bg-accent transition"
        aria-label="Timers"
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
