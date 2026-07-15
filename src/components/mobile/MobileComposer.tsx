import { type ReactNode } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useLayout } from "@/hooks/use-mobile";

/**
 * Docked, keyboard-aware container for the mobile chat composer.
 *
 * Wraps the existing <ChatInput> so business logic is unchanged, but
 * gives it a true mobile chrome: pinned to the bottom, lifts above
 * the soft keyboard via the VisualViewport API, and respects the
 * home-indicator safe area.
 *
 * Desktop returns null so the component is completely absent from
 * the DOM — no `display:none` hack.
 */
export function MobileComposer({ children }: { children: ReactNode }) {
  const { isMobile } = useLayout();
  const kb = useKeyboardInset();
  if (!isMobile) return null;
  return (
    <div
      className="sticky bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-background/0 pt-3 px-2"
      style={{
        paddingBottom: `calc(env(safe-area-inset-bottom) + ${kb > 0 ? 8 : 12}px)`,
        transform: kb > 0 ? `translateY(-${kb}px)` : undefined,
        transition: "transform 180ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
      data-testid="mobile-composer"
    >
      {children}
    </div>
  );
}
