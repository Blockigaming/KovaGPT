import { lazy, Suspense, useCallback, useId, useLayoutEffect, useState } from "react";
import { CatchBoundary } from "@tanstack/react-router";
import { toast } from "sonner";
import type { KovaNotice, SubscribeToNotices } from "./KovaNotificationSurface";
import { notificationDefinition } from "@/lib/notification-catalog.mjs";
import {
  noticeIsDismissed,
  rememberNoticeDismissal,
} from "@/lib/notification-dismissal-policy.mjs";

const KovaNotificationPanel = lazy(() =>
  import("./KovaNotificationPanel").then((module) => ({ default: module.KovaNotificationPanel })),
);

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
export function KovaNotificationController({
  accountId,
  subscribe,
}: {
  accountId?: string | null;
  subscribe: SubscribeToNotices;
}) {
  const toastScope = useId();
  const [pending, setPending] = useState<KovaNotice[]>([]);
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [externalDialogOpen, setExternalDialogOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const active = pending[0] ?? null;
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

  useLayoutEffect(() => {
    // Defer low-priority discovery while any other modal owns the focus.
    // Radix portals often render outside the current route, so a page-level
    // flag is insufficient. Never include our own notice panel in the test.
    const scan = () => {
      const candidates = document.querySelectorAll<HTMLElement>(
        '[role="dialog"]:not(.kova-notice-panel), [role="alertdialog"]:not(.kova-notice-panel), [data-state="open"][data-radix-popper-content-wrapper] [role="menu"]',
      );
      const anotherVisibleDialog = Array.from(candidates).some(
        (element) =>
          !element.closest(".kova-notice-panel") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden",
      );
      setExternalDialogOpen(anotherVisibleDialog);
    };
    scan();
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scan();
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "role", "aria-hidden"],
    });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
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
    setEditing(composingIn(document.activeElement));
    let current = true;
    const toastIds = new Set<string>();
    const scopedId = (key: string) => toastScope + ":" + key;
    const handle = (notice: KovaNotice) => {
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
        const toastId = scopedId(key);
        toastIds.add(toastId);
        const acknowledge = () => {
          toastIds.delete(toastId);
          if (!current) return;
          try {
            notice.onDismiss?.();
          } catch {
            /* The provider inbox is durable even if acknowledgement fails. */
          }
        };
        const notificationToast =
          definition.liveRegion === "assertive"
            ? toast.error
            : /(?:_claimed|_completed|_created|_updated|_sent|_verified|_success|_ready|_restored|_saved|_disconnected)$/.test(
                  notice.id,
                )
              ? toast.success
              : toast;
        notificationToast(notice.title, {
          id: toastId,
          onDismiss: acknowledge,
          onAutoClose: acknowledge,
          description: notice.message,
          duration: 3000,
          action:
            notice.onPrimary && notice.primaryLabel
              ? {
                  label: notice.primaryLabel,
                  onClick: () => {
                    if (!current) return;
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
    const unsubscribe = subscribe(handle);
    return () => {
      current = false;
      for (const id of toastIds) toast.dismiss(id);
      unsubscribe();
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("compositionstart", compositionStart);
      document.removeEventListener("compositionend", compositionEnd);
    };
  }, [accountId, subscribe, toastScope]);

  const definition = active ? notificationDefinition(active.id) : null;
  const lowPriority =
    !!definition && ["announcements", "onboarding", "feedback"].includes(definition.group);
  const defer =
    !!definition &&
    ((externalDialogOpen && (definition.exclusive || lowPriority)) ||
      (lowPriority && (editing || composing)));
  const shown = !!active && !!definition && !defer;
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
      {shown && active && definition && (
        <CatchBoundary
          getResetKey={() => active.key ?? active.id}
          errorComponent={() => (
            <div
              role="alert"
              className="fixed inset-x-4 top-4 z-50 mx-auto max-w-md rounded-xl bg-popover p-4 text-popover-foreground shadow"
            >
              <p className="font-medium">{active.title}</p>
              {active.message && <p className="mt-1 text-sm">{active.message}</p>}
              <button type="button" className="mt-2 min-h-11 underline" onClick={dismiss}>
                Close notification
              </button>
            </div>
          )}
        >
          <Suspense fallback={null}>
            <KovaNotificationPanel
              key={active.key ?? active.id}
              active={active}
              definition={definition}
              dismiss={dismiss}
            />
          </Suspense>
        </CatchBoundary>
      )}
    </>
  );
}
