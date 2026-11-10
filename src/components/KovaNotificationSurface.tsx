import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { notificationDefinition } from "@/lib/notification-catalog.mjs";
import { noticeIsDismissed, rememberNoticeDismissal } from "@/lib/notification-dismissal-policy.mjs";
import "./kova-notification-surface.css";

export type KovaNotice = {
  id: string;
  title: string;
  message?: string;
  confirmed?: boolean;
  key?: string;
  campaignId?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

/** Emit only from a verified operation stage; never from a speculative click. */
export function publishKovaNotice(notice: KovaNotice) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kova:notice", { detail: notice }));
  }
}

function composingIn(target: EventTarget | null) {
  return target instanceof HTMLElement &&
    (target.matches("textarea, input:not([type='button']):not([type='submit'])") ||
      target.isContentEditable);
}

/** A single global host: independent of which feature route is mounted. */
export function KovaNotificationSurface({ accountId }: { accountId?: string | null }) {
  const [pending, setPending] = useState<KovaNotice[]>([]);
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const active = pending[0] ?? null;
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dismiss = useCallback(() => {
    if (active) {
      const group = notificationDefinition(active.id)?.group;
      rememberNoticeDismissal(window.localStorage, {
        accountId, id: active.id, campaignId: active.campaignId, group,
      });
    }
    setPending((items) => items.slice(1));
  }, [active, accountId]);

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
      if (!notice || typeof notice.title !== "string" ||
          !notice.title.trim() || notice.title.length > 160 ||
          (notice.message && notice.message.length > 2000)) return;
      const definition = notificationDefinition(notice.id);
      if (!definition || (definition.requiresEvidence && notice.confirmed !== true)) return;
      if (noticeIsDismissed(window.localStorage, {
        accountId, id: notice.id, campaignId: notice.campaignId, group: definition.group,
      })) return;
      const key = notice.key ?? notice.id;
      if (definition.surface === "status" || definition.surface === "inline") {
        // Source components own the visible operational status or inline error.
        // Announce its change without duplicating a toast over the active tool.
        setLiveMessage(notice.title);
        return;
      }
      if (definition.surface === "toast") {
        toast(notice.title, {
          id: key,
          description: notice.message,
          duration: 3000,
          action: notice.onPrimary && notice.primaryLabel
            ? { label: notice.primaryLabel, onClick: notice.onPrimary } : undefined,
        });
        return;
      }
      setPending((items) => {
        if (items.some((item) => (item.key ?? item.id) === key)) return items;
        const next = [...items, notice].sort(
          (a, b) => (notificationDefinition(a.id)?.priority ?? 10) -
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
  const defer = !!definition && ["announcements", "onboarding", "feedback"].includes(definition.group) &&
    (editing || composing);
  const shown = !!active && !!definition && !defer;

  useLayoutEffect(() => {
    if (!shown) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
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
  }, [shown, active?.key, active?.id]);

  useEffect(() => {
    if (!shown || !active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && definition?.dismissible) {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const controls = [...panelRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      )].filter((control) => control.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [shown, active, definition, dismiss]);

  if (!shown || !active || !definition) return <span className="sr-only" role="status" aria-live="polite">{liveMessage}</span>;
  return (
    <>
    <span className="sr-only" role="status" aria-live="polite">{liveMessage}</span>
    <div className="kova-notice-backdrop" role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && definition.dismissible) dismiss();
      }}>
      <section
        ref={panelRef}
        className="kova-notice-panel"
        role={definition.priority === 1 ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="kova-notice-title"
        aria-describedby={active.message ? "kova-notice-body" : undefined}
        data-surface={definition.surface}
      >
        {definition.dismissible && (
          <button className="kova-notice-close" type="button" aria-label="Close notification"
            onClick={dismiss}><X size={19} /></button>
        )}
        <h2 id="kova-notice-title">{active.title}</h2>
        {active.message && <p id="kova-notice-body">{active.message}</p>}
        <div className="kova-notice-actions">
          {active.onPrimary && active.primaryLabel && (
            <button className="kova-notice-primary" type="button" onClick={() => {
              active.onPrimary?.(); dismiss();
            }}>{active.primaryLabel}</button>
          )}
          {definition.dismissible && (
            <button className="kova-notice-secondary" type="button" onClick={() => {
              active.onSecondary?.(); dismiss();
            }}>{active.secondaryLabel || "Not now"}</button>
          )}
        </div>
      </section>
    </div>
    </>
  );
}
