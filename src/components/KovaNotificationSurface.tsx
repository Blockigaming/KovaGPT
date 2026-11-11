import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  X,
  Bell,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Info,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { notificationDefinition } from "@/lib/notification-catalog.mjs";
import {
  noticeIsDismissed,
  rememberNoticeDismissal,
} from "@/lib/notification-dismissal-policy.mjs";
import "./kova-notification-surface.css";

export type KovaNotice = {
  id: string;
  title: string;
  message?: string;
  confirmed?: boolean;
  key?: string;
  campaignId?: string;
  anchorSelector?: string;
  primaryLabel?: string;
  onPrimary?: () => void | Promise<void>;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onDismiss?: () => void;
};

/** Emit only from a verified operation stage; never from a speculative click. */
export function publishKovaNotice(notice: KovaNotice) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kova:notice", { detail: notice }));
  }
}

function optionalNoticeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function composingIn(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches("textarea, input:not([type='button']):not([type='submit'])") ||
      target.isContentEditable)
  );
}

/** A single global host: independent of which feature route is mounted. */
export function KovaNotificationSurface({ accountId }: { accountId?: string | null }) {
  const [pending, setPending] = useState<KovaNotice[]>([]);
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [externalDialogOpen, setExternalDialogOpen] = useState(false);
  const [anchorPosition, setAnchorPosition] = useState<{ left: number; top: number } | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const touchStartRef = useRef<{ x: number; y: number; fromHandle: boolean } | null>(null);
  const active = pending[0] ?? null;
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dismiss = useCallback(() => {
    if (active) {
      const group = notificationDefinition(active.id)?.group;
      rememberNoticeDismissal(optionalNoticeStorage(), {
        accountId,
        id: active.id,
        campaignId: active.campaignId,
        group,
      });
      try {
        active.onDismiss?.();
      } catch {
        /* Keep the dialog dismissible on callback failure. */
      }
    }
    setPending((items) => items.slice(1));
  }, [active, accountId]);

  useEffect(() => {
    // Defer low-priority discovery while any other modal owns the focus.
    // Radix portals often render outside the current route, so a page-level
    // flag is insufficient. Never include our own notice panel in the test.
    const scan = () => setExternalDialogOpen(Boolean(document.querySelector(
      '[role="dialog"]:not(.kova-notice-panel), [role="alertdialog"]:not(.kova-notice-panel), [data-state="open"][data-radix-popper-content-wrapper] [role="menu"]',
    )));
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "role"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setActionBusy(false);
    setActionError("");
  }, [active?.key, active?.id]);

  const performPrimary = useCallback(async () => {
    if (!active?.onPrimary || actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      await active.onPrimary();
      dismiss();
    } catch {
      setActionError("That action could not be completed. Please try again.");
    } finally {
      setActionBusy(false);
    }
  }, [active, actionBusy, dismiss]);

  useEffect(() => {
    const focus = (event: FocusEvent) => setEditing(composingIn(event.target));
    const blur = () => {
      window.requestAnimationFrame(() => setEditing(composingIn(document.activeElement)));
    };
    const compositionStart = () => setComposing(true);
    const compositionEnd = () => setComposing(false);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("compositionstart", compositionStart);
    document.addEventListener("compositionend", compositionEnd);
    const handle = (event: Event) => {
      const notice = (event as CustomEvent<KovaNotice>).detail;
      if (
        !notice ||
        typeof notice.title !== "string" ||
        !notice.title.trim() ||
        notice.title.length > 160 ||
        (notice.message && notice.message.length > 2000)
      )
        return;
      const definition = notificationDefinition(notice.id);
      if (!definition || (definition.requiresEvidence && notice.confirmed !== true)) return;
      if (
        noticeIsDismissed(optionalNoticeStorage(), {
          accountId,
          id: notice.id,
          campaignId: notice.campaignId,
          group: definition.group,
        })
      )
        return;
      const key = notice.key ?? notice.id;
      if (definition.surface === "status" || definition.surface === "inline") {
        // Source components own the visible operational status or inline error.
        // Announce its change without duplicating a toast over the active tool.
        setLiveMessage(notice.title);
        return;
      }
      if (definition.surface === "toast") {
        const notificationToast =
          definition.liveRegion === "assertive"
            ? toast.error
            : /(?:_completed|_created|_updated|_sent|_verified|_success|_ready|_restored|_saved|_disconnected)$/.test(
                  notice.id,
                )
              ? toast.success
              : toast;
        notificationToast(notice.title, {
          id: key,
          onDismiss: () => {
            try {
              notice.onDismiss?.();
            } catch {
              /* Ignore notice acknowledgement failures. */
            }
          },
          description: notice.message,
          duration: 3000,
          action:
            notice.onPrimary && notice.primaryLabel
              ? {
                  label: notice.primaryLabel,
                  onClick: () => {
                    try {
                      notice.onDismiss?.();
                    } finally {
                      notice.onPrimary?.();
                    }
                  },
                }
              : undefined,
        });
        return;
      }
      setPending((items) => {
        if (items.some((item) => (item.key ?? item.id) === key)) return items;
        const next = [...items, notice].sort(
          (a, b) =>
            (notificationDefinition(a.id)?.priority ?? 10) -
            (notificationDefinition(b.id)?.priority ?? 10),
        );
        return next.slice(0, 12);
      });
    };
    window.addEventListener("kova:notice", handle);
    return () => {
      window.removeEventListener("kova:notice", handle);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("compositionstart", compositionStart);
      document.removeEventListener("compositionend", compositionEnd);
    };
  }, [accountId]);

  const definition = active ? notificationDefinition(active.id) : null;
  const defer =
    !!definition &&
    ["announcements", "onboarding", "feedback"].includes(definition.group) &&
    (editing || composing || externalDialogOpen);
  const shown = !!active && !!definition && !defer;
  const nonBlocking = definition?.surface === "popover" || definition?.surface === "banner";
  useEffect(() => {
    if (definition?.surface !== "popover" || !active?.anchorSelector) {
      setAnchorPosition(null);
      return;
    }
    const updatePosition = () => {
      try {
        const target = document.querySelector(active.anchorSelector!);
        const rect = target?.getBoundingClientRect();
        if (!rect) { setAnchorPosition(null); return; }
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - 372));
        const top = rect.bottom + 12 + 280 <= window.innerHeight
          ? rect.bottom + 12
          : Math.max(12, rect.top - 280);
        setAnchorPosition({ left, top });
      } catch {
        setAnchorPosition(null);
      }
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [definition?.surface, active?.anchorSelector]);
  const visual = definition
    ? definition.group === "announcements" || definition.group === "billing"
      ? "discovery"
      : definition.group === "security"
        ? "security"
        : [
              "workspace_join_approved",
              "task_completed",
              "subscription_updated",
              "offer_claimed",
            ].includes(active?.id ?? "")
          ? "success"
          : /(?:failed|error|blocked|denied|unavailable|expired|limit)$/.test(active?.id ?? "")
            ? "warning"
            : "information"
    : "information";
  const NoticeIcon =
    visual === "discovery"
      ? Sparkles
      : visual === "security"
        ? ShieldCheck
        : visual === "success"
          ? CheckCircle2
          : visual === "warning"
            ? AlertCircle
            : definition?.group === "tasks"
              ? Bell
              : Info;

  useLayoutEffect(() => {
    if (!shown || nonBlocking) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panelRef.current?.querySelector<HTMLElement>(
      ".kova-notice-primary, .kova-notice-secondary, .kova-notice-close",
    );
    first?.focus({ preventScroll: true });
    return () => {
      const previous = returnFocusRef.current;
      if (previous?.isConnected && document.activeElement === document.body) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [shown, active?.key, active?.id, nonBlocking]);

  useEffect(() => {
    if (!shown || !active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && definition?.dismissible && !actionBusy) {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current || nonBlocking) return;
      const controls = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((control) => control.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [shown, active, definition, dismiss, actionBusy, nonBlocking]);

  if (!shown || !active || !definition)
    return (
      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    );
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
      <div
        className="kova-notice-backdrop"
        role="presentation"
        data-surface={definition.surface}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && definition.dismissible && !actionBusy)
            dismiss();
        }}
      >
        <section
          ref={panelRef}
          className="kova-notice-panel"
          role={nonBlocking ? "status" : definition.priority === 1 ? "alertdialog" : "dialog"}
          aria-modal={nonBlocking ? undefined : true}
          aria-labelledby="kova-notice-title"
          aria-describedby={active.message ? "kova-notice-body" : undefined}
          data-surface={definition.surface}
          data-group={definition.group}
          data-visual={visual}
          style={definition.surface === "popover" && anchorPosition
            ? { "--kova-notice-popover-left": anchorPosition.left + "px",
                "--kova-notice-popover-top": anchorPosition.top + "px" } as CSSProperties
            : undefined}
          aria-busy={actionBusy}
          onTouchStart={(event) => {
            if (!definition.dismissible || actionBusy || event.touches.length !== 1) return;
            const box = panelRef.current?.getBoundingClientRect();
            if (!box) return;
            touchStartRef.current = {
              x: event.touches[0].clientX,
              y: event.touches[0].clientY,
              fromHandle:
                event.touches[0].clientY - box.top <= 42 && panelRef.current?.scrollTop === 0,
            };
          }}
          onTouchEnd={(event) => {
            const start = touchStartRef.current;
            touchStartRef.current = null;
            if (
              !start?.fromHandle ||
              actionBusy ||
              !definition.dismissible ||
              event.changedTouches.length !== 1
            )
              return;
            const dx = event.changedTouches[0].clientX - start.x;
            const dy = event.changedTouches[0].clientY - start.y;
            if (dy > 100 && Math.abs(dx) < 55 && window.matchMedia("(max-width: 640px)").matches)
              dismiss();
          }}
        >
          <div className="kova-notice-symbol" aria-hidden="true">
            <NoticeIcon size={21} strokeWidth={1.8} />
          </div>
          {definition.dismissible && (
            <button
              className="kova-notice-close"
              type="button"
              aria-label="Close notification"
              disabled={actionBusy}
              onClick={dismiss}
            >
              <X size={19} />
            </button>
          )}
          {definition.group === "announcements" && (
            <p className="kova-notice-eyebrow">What's new</p>
          )}
          <h2 id="kova-notice-title">{active.title}</h2>
          {active.message && (
            <p className="kova-notice-description" id="kova-notice-body">
              {active.message}
            </p>
          )}
          {actionError && (
            <p className="kova-notice-action-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="kova-notice-actions">
            {active.onPrimary && active.primaryLabel && (
              <button
                className="kova-notice-primary"
                type="button"
                disabled={actionBusy}
                onClick={() => void performPrimary()}
              >
                {actionBusy && (
                  <Loader2 aria-hidden="true" className="kova-notice-spinner" size={16} />
                )}
                {actionBusy ? "Working…" : active.primaryLabel}
              </button>
            )}
            {definition.dismissible && (
              <button
                className="kova-notice-secondary"
                type="button"
                disabled={actionBusy}
                onClick={() => {
                  active.onSecondary?.();
                  dismiss();
                }}
              >
                {active.secondaryLabel || "Not now"}
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
