import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import { useClerkSafe } from "@/components/auth/ClerkSafe";
import type { notificationDefinition } from "@/lib/notification-catalog.mjs";
import type { KovaNotice } from "./KovaNotificationSurface";
import "./kova-notification-surface.css";

export function KovaNotificationPanel({
  active,
  definition,
  dismiss,
}: {
  active: KovaNotice;
  definition: NonNullable<ReturnType<typeof notificationDefinition>>;
  dismiss: () => void;
}) {
  const { openSignIn } = useClerkSafe();
  const authenticationNeeded = active.id === "sign_in_required" || active.id === "session_expired";
  const primaryAction = active.onPrimary ?? (authenticationNeeded ? openSignIn : undefined);
  const primaryActionLabel = active.primaryLabel ?? (authenticationNeeded ? "Sign in" : undefined);
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; fromHandle: boolean } | null>(null);
  const [anchorPosition, setAnchorPosition] = useState<{ left: number; top: number } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const performPrimary = useCallback(async () => {
    if (!primaryAction || actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      await primaryAction();
      if (mounted.current) dismiss();
    } catch {
      if (mounted.current) setActionError("That action could not be completed. Please try again.");
    } finally {
      if (mounted.current) setActionBusy(false);
    }
  }, [primaryAction, actionBusy, dismiss]);

  const nonBlocking = definition.surface === "popover" || definition.surface === "banner";
  useEffect(() => {
    if (definition.surface !== "popover" || !active.anchorSelector) {
      setAnchorPosition(null);
      return;
    }
    const updatePosition = () => {
      try {
        const target = document.querySelector(active.anchorSelector!);
        const rect = target?.getBoundingClientRect();
        if (!rect) {
          setAnchorPosition(null);
          return;
        }
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - 372));
        const top =
          rect.bottom + 12 + 280 <= window.innerHeight
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
  }, [definition.surface, active.anchorSelector]);
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
            ].includes(active.id ?? "")
          ? "success"
          : /(?:failed|error|blocked|denied|unavailable|expired|limit)$/.test(active.id ?? "")
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
            : definition.group === "tasks"
              ? Bell
              : Info;

  useLayoutEffect(() => {
    if (nonBlocking) return;
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
  }, [nonBlocking]);

  useEffect(() => {
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
  }, [definition, dismiss, actionBusy, nonBlocking]);

  return (
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
        style={
          definition.surface === "popover" && anchorPosition
            ? ({
                "--kova-notice-popover-left": anchorPosition.left + "px",
                "--kova-notice-popover-top": anchorPosition.top + "px",
              } as CSSProperties)
            : undefined
        }
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
        {definition.group === "announcements" && <p className="kova-notice-eyebrow">What's new</p>}
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
          {primaryAction && primaryActionLabel && (
            <button
              className="kova-notice-primary"
              type="button"
              disabled={actionBusy}
              onClick={() => void performPrimary()}
            >
              {actionBusy && (
                <Loader2 aria-hidden="true" className="kova-notice-spinner" size={16} />
              )}
              {actionBusy ? "Working…" : primaryActionLabel}
            </button>
          )}
          {definition.dismissible && (
            <button
              className="kova-notice-secondary"
              type="button"
              disabled={actionBusy}
              onClick={() => {
                try {
                  active.onSecondary?.();
                } finally {
                  dismiss();
                }
              }}
            >
              {active.secondaryLabel || "Not now"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
