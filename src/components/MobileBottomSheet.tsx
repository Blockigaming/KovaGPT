import { useEffect, useRef, useState, type ReactNode } from "react";

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
      first?.focus();
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
      try { navigator.vibrate?.(10); } catch { /* ignore */ }
      onOpenChange(false);
    }
    setDragY(0);
    dragStart.current = null;
  };

  const transform = dragY > 0 ? `translateY(${dragY}px)` : undefined;
  const transition = reduceMotion || dragY > 0 ? "none" : "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title || "Options"}
      className="fixed inset-0 z-[100]"
      data-testid="mobile-bottom-sheet"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200"
      />
      <div
        ref={sheetRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform, transition, paddingBottom: "env(safe-area-inset-bottom)" }}
        className="absolute inset-x-0 bottom-0 bg-popover text-popover-foreground rounded-t-2xl shadow-2xl border-t border-border max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-200"
      >
        <div className="pt-2 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        </div>
        {title && (
          <div className="px-4 pb-2 text-sm font-semibold text-muted-foreground shrink-0">{title}</div>
        )}
        <div className="overflow-y-auto overscroll-contain px-2 pb-4">{children}</div>
      </div>
    </div>
  );
}
