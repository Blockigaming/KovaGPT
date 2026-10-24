// Utility-row widget that shows active timers/alarms,
// counts down live, shows a silent notification when already permitted, and
// exposes a quick "add timer" affordance.
import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
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

const sessionNotifiedIdsByPrincipal = new Map<string, Set<string>>();

function sessionNotifiedIds(principal: string): Set<string> {
  const current = sessionNotifiedIdsByPrincipal.get(principal);
  if (current) return current;
  const created = new Set<string>();
  sessionNotifiedIdsByPrincipal.set(principal, created);
  return created;
}

function notify(label: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("KovaGPT", { body: `${label} finished`, silent: true });
    }
  } catch {
    /* ignore */
  }
}

export function TimersWidget({
  userKey,
  principalResolved,
  mobileSidebarOpen = false,
}: {
  userKey: string | null;
  principalResolved: boolean;
  mobileSidebarOpen?: boolean;
}) {
  const principal = principalResolved ? browserStoragePrincipal(userKey) : null;
  const [items, setItems] = useState<TimerItem[]>([]);
  const [itemsPrincipal, setItemsPrincipal] = useState<string | null>(null);
  const ready = principal !== null && itemsPrincipal === principal;
  const visibleItems = useMemo(() => (ready ? items : []), [items, ready]);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [panelOffset, setPanelOffset] = useState(0);
  const [minutes, setMinutes] = useState(5);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const notifiedIds = useMemo(
    () => (principal ? sessionNotifiedIds(principal) : new Set<string>()),
    [principal],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const keepPanelInViewport = () => {
      const panel = panelRef.current;
      const container = panel?.parentElement;
      if (!container || !panel) return;
      const width = panel.offsetWidth;
      // right:0 anchors to the relative container, which can be wider than
      // its launcher in a project view. Measure that same containing block.
      const anchoredLeft = container.getBoundingClientRect().right - width;
      const left = Math.min(
        Math.max(anchoredLeft, 16),
        Math.max(16, window.innerWidth - width - 16),
      );
      setPanelOffset(left - anchoredLeft);
    };
    keepPanelInViewport();
    window.addEventListener("resize", keepPanelInViewport);
    return () => window.removeEventListener("resize", keepPanelInViewport);
  }, [open]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    } else if (wasOpenRef.current) {
      launcherRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

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

  // Fire each due timer at most once in this browser tab, even across route remounts and when
  // browser storage is unavailable and the durable fired flag cannot be written.
  useEffect(() => {
    if (!ready) return;
    const due = visibleItems.filter(
      (timer) => !timer.fired && timer.fireAt <= now && !notifiedIds.has(timer.id),
    );
    if (due.length === 0) return;
    const dueIds = new Set(due.map((timer) => timer.id));
    due.forEach((timer) => notifiedIds.add(timer.id));
    setItems((current) =>
      current.map((timer) => (dueIds.has(timer.id) ? { ...timer, fired: true } : timer)),
    );
    for (const timer of due) {
      markFired(userKey, timer.id);
      notify(timer.label);
      toast.success(`${timer.label} - done`, { duration: 6000 });
    }
  }, [notifiedIds, now, ready, userKey, visibleItems]);

  const active = visibleItems
    .filter((timer) => !timer.fired && !notifiedIds.has(timer.id))
    .sort((a, b) => a.fireAt - b.fireAt);
  const nextItem = active[0];

  return (
    <div className={`relative z-40 flex items-end ${mobileSidebarOpen ? "max-lg:invisible" : ""}`}>
      {open && (
        <div
          ref={panelRef}
          id="kova-timers-panel"
          role="region"
          aria-label="Timer controls"
          tabIndex={-1}
          style={{ transform: `translateX(${panelOffset}px)` }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
          className="absolute right-0 top-full mt-2 max-h-[calc(100dvh-12rem-var(--safe-top)-var(--safe-bottom))] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-3 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
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
              }}
              className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-full bg-foreground px-4 text-xs text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="w-3 h-3" /> Start
            </button>
          </div>
        </div>
      )}
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-transparent px-4 py-2 text-xs font-medium transition hover:bg-accent"
        aria-label={ready ? "Timers" : "Timers (loading)"}
        aria-expanded={open}
        aria-controls="kova-timers-panel"
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
