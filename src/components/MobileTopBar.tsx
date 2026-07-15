import { Menu, SquarePen } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { useLayout } from "@/hooks/use-mobile";

/**
 * Compact sticky top bar shown ONLY on phones (mobile layout mode).
 * Provides a menu trigger to open the off-canvas sidebar, brand identity,
 * and a quick "new chat" action. Honors safe-area-inset-top and uses
 * translucent blur so content underneath eases through as it scrolls.
 */
export function MobileTopBar({
  onOpenSidebar,
  onNewChat,
  title,
}: {
  onOpenSidebar: () => void;
  onNewChat: () => void;
  title?: string;
}) {
  const { isMobile } = useLayout();
  if (!isMobile) return null;
  return (
    <header
      className="sticky top-0 z-30 md:hidden bg-background/85 backdrop-blur-lg border-b border-border/60"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      role="banner"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 h-14 px-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="w-11 h-11 rounded-full flex items-center justify-center text-foreground hover:bg-accent/60 active:scale-95 transition"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center justify-center gap-2 min-w-0">
          <NovaLogo className="w-5 h-5 shrink-0" />
          <span className="font-display font-semibold tracking-tight text-[16px] truncate">
            {title || "KovaGPT"}
          </span>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          aria-label="New chat"
          className="w-11 h-11 rounded-full flex items-center justify-center text-foreground hover:bg-accent/60 active:scale-95 transition"
        >
          <SquarePen className="w-6 h-6" />
        </button>
      </div>
    </header>
  );
}
