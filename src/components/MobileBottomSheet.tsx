import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Native-feeling bottom sheet for phones and touch tablets.
 * Features:
 *  - Backdrop dim + tap-outside dismiss
 *  - Escape-key dismiss (for keyboard-connected tablets)
 *  - Focus trap (Tab / Shift+Tab wraps within the sheet)
 *  - Focus restoration on close
 *  - Scroll lock on body while open
 *  - Drag handle with swipe-down to dismiss (touch)
 *  - Rounded top corners, safe-area padding
 *  - Respects prefers-reduced-motion (disables slide transition)
 */
export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  children,
  ariaLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const on = () => setReduceMotion(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  // Scroll lock + focus save/restore
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // focus first focusable element in the sheet
    requestAnimationFrame(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (first ?? sheetRef.current)?.focus();
    });
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Escape + Tab focus trap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const onTouchStart = (e: React.TouchEvent) => {
    dragStart.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStart.current == null) return;
    const dy = e.touches[0].clientY - dragStart.current;
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => {
    if (dragY > 90) {
      onOpenChange(false);
    }
    setDragY(0);
    dragStart.current = null;
  };

  const transform = dragY > 0 ? `translateY(${dragY}px)` : undefined;
  const transition = reduceMotion || dragY > 0 ? "none" : "transform 160ms ease-out";

  const sheet = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? undefined : ariaLabel || "Options"}
      aria-labelledby={title ? titleId : undefined}
      className="fixed inset-0 z-[100]"
      data-testid="mobile-bottom-sheet"
    >
      <div
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/50 animate-in fade-in-0 duration-150"
      />
      <div
        ref={sheetRef}
        tabIndex={-1}
        style={{ transform, transition, paddingBottom: "env(safe-area-inset-bottom)" }}
        className="absolute inset-x-0 bottom-0 flex max-h-[min(88dvh,44rem)] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-popover text-popover-foreground shadow-lg animate-in slide-in-from-bottom duration-150"
      >
        <div
          className="flex shrink-0 touch-none justify-center pb-2 pt-2.5 cursor-grab active:cursor-grabbing"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          aria-hidden="true"
        >
          <div className="h-1 w-9 rounded-full bg-muted-foreground/35" />
        </div>
        <div className="flex shrink-0 items-center gap-3 px-4 pb-2">
          {title ? (
            <div
              id={titleId}
              className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground"
            >
              {title}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--kova-radius-compact)] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close sheet"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-[max(.5rem,var(--safe-left))] pb-4 pr-[max(.5rem,var(--safe-right))] [scrollbar-gutter:stable]">
          {children}
        </div>
      </div>
    </div>
  );

  // The composer uses backdrop filtering, which creates a containing block for
  // fixed descendants. Portaling keeps the sheet anchored to the visual viewport
  // in landscape and while the on-screen keyboard changes the page geometry.
  return typeof document === "undefined" ? null : createPortal(sheet, document.body);
}
