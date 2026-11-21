import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/**
 * A bottom-aligned mobile dialog with a swipe-to-dismiss handle.
 * Radix owns modal isolation and nested-layer keyboard behavior. In particular,
 * Escape in a child menu must not also dismiss this sheet.
 */
export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  children,
  ariaLabel,
  restoreFocus = true,
  expandable = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  ariaLabel?: string;
  restoreFocus?: boolean;
  expandable?: boolean;
}) {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [dragY, setDragY] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dragStart = useRef<number | null>(null);
  const dragDistance = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const resetDrag = useCallback(() => {
    dragStart.current = null;
    dragDistance.current = 0;
    setDragY(0);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) {
      resetDrag();
      setExpanded(false);
    }
  }, [open, resetDrag]);

  const onTouchStart = (event: React.TouchEvent) => {
    resetDrag();
    if (event.touches.length === 1) dragStart.current = event.touches[0].clientY;
  };
  const onTouchMove = (event: React.TouchEvent) => {
    if (dragStart.current === null) return;
    if (event.touches.length !== 1) {
      resetDrag();
      return;
    }
    const distance = event.touches[0].clientY - dragStart.current;
    dragDistance.current = distance;
    setDragY(Math.max(0, distance));
  };
  const onTouchEnd = () => {
    const distance = dragDistance.current;
    resetDrag();
    if (expandable && distance < -65) setExpanded(true);
    else if (distance > 90) {
      if (expanded) setExpanded(false);
      else onOpenChange(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-testid="mobile-bottom-sheet"
          className="kova-mobile-bottom-sheet"
          data-kova-bottom-sheet=""
          data-sheet-size={expandable ? (expanded ? "expanded" : "compact") : undefined}
          onOpenAutoFocus={() => {
            previouslyFocused.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            // Callers use their existing toolbar buttons rather than DialogTrigger.
            event.preventDefault();
            if (restoreFocus && previouslyFocused.current?.isConnected)
              previouslyFocused.current.focus({ preventScroll: true });
          }}
          style={{
            transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
            transition: reduceMotion || dragY > 0 ? "none" : "transform 180ms ease-out",
          }}
        >
          <div
            className="flex shrink-0 touch-none justify-center pb-1 pt-2.5 cursor-grab active:cursor-grabbing"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={resetDrag}
            data-kova-sheet-handle=""
            aria-hidden="true"
          >
            <div className="h-[5px] w-9 rounded-full bg-muted-foreground/35" />
          </div>
          <div className="flex shrink-0 items-center gap-3 min-h-12 px-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]">
            <DialogPrimitive.Title
              className={
                title
                  ? "min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground"
                  : "sr-only"
              }
            >
              {title || ariaLabel || "Options"}
            </DialogPrimitive.Title>
            {!title && <div className="flex-1" />}
            {expandable && (
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg px-2 text-sm"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            )}
            <DialogPrimitive.Close
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--kova-radius-compact)] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close sheet"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pl-[max(1rem,var(--safe-left))] pb-3 pr-[max(1rem,var(--safe-right))] [scrollbar-gutter:stable]">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
