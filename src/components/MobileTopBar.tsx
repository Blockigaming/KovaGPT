import { Menu, SquarePen } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { useUser, SignInButton, clerkEnabled } from "@/components/auth/ClerkSafe";
import { ResponsiveModelSelector } from "@/components/ResponsiveModelSelector";
import type { ModeId, Tier } from "@/lib/modes";

/**
 * Compact sticky top bar shown on phones and tablets (any viewport below the
 * desktop breakpoint). Provides a menu trigger to open the off-canvas sidebar,
 * brand identity, and a quick "new chat" action. Signed-out users see a
 * compact login action instead of the new-chat icon so they can always
 * reach auth from the top bar. Honors safe-area-inset-top and uses
 * translucent blur so content underneath eases through as it scrolls.
 */
export function MobileTopBar({
  onOpenSidebar,
  onNewChat,
  title,
  mode,
  onModeChange,
  userTier = "free",
}: {
  onOpenSidebar: () => void;
  onNewChat: () => void;
  title?: string;
  mode?: ModeId;
  onModeChange?: (mode: ModeId) => void;
  userTier?: Tier;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const showAuth = isLoaded && clerkEnabled && !isSignedIn;
  return (
    <header className="kova-topbar sticky top-0 z-30 lg:hidden">
      <div className="kova-topbar-inner grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="kova-action w-11 h-11 text-foreground"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex min-w-0 items-center justify-center">
          {mode && onModeChange ? (
            <ResponsiveModelSelector
              mode={mode}
              onChange={onModeChange}
              userTier={userTier}
              placement="topbar"
              compact
            />
          ) : (
            <div className="flex min-w-0 items-center justify-center gap-2">
              <NovaLogo className="w-5 h-5 shrink-0" />
              <span className="font-display font-semibold tracking-tight text-[15px] truncate">
                {title || "KovaGPT"}
              </span>
            </div>
          )}
        </div>
        {showAuth ? (
          <SignInButton mode="modal">
            <button className="mr-1 min-h-11 whitespace-nowrap rounded-md px-3 text-[13px] font-medium text-foreground transition hover:bg-accent/60 active:bg-accent">
              Log in
            </button>
          </SignInButton>
        ) : (
          <button
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            className="kova-action w-11 h-11 text-foreground"
          >
            <SquarePen className="w-5 h-5" />
          </button>
        )}
      </div>
    </header>
  );
}
