import { PenSquare, Menu } from "lucide-react";
import { useLayout } from "@/hooks/use-mobile";
import { useUser, SignInButton, SignUpButton, clerkEnabled } from "@/components/auth/ClerkSafe";
import { ResponsiveModelSelector } from "@/components/ResponsiveModelSelector";
import type { ModeId, Tier } from "@/lib/modes";

/**
 * Mobile/tablet top bar. Structure mirrors ChatGPT mobile:
 *   left:   hamburger (opens the drawer)
 *   center: KovaGPT model selector pill (opens the mobile model sheet)
 *   right:  new-chat pencil, or Log in / Sign up when signed out.
 *
 * Height is a stable 44px so the layout never jumps as the selector's label
 * changes. Honors safe-area-inset-top.
 */
export function MobileTopBar({
  onOpenSidebar,
  onNewChat,
  mode,
  onModeChange,
  userTier = "free",
}: {
  onOpenSidebar: () => void;
  onNewChat: () => void;
  mode?: ModeId;
  onModeChange?: (m: ModeId) => void;
  userTier?: Tier;
  title?: string;
}) {
  const { isDesktop } = useLayout();
  const { isLoaded, isSignedIn } = useUser();
  if (isDesktop) return null;
  const showAuth = isLoaded && clerkEnabled && !isSignedIn;
  return (
    <header
      className="sticky top-0 z-30 lg:hidden bg-background/85 backdrop-blur-xl"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      role="banner"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center h-11 px-1.5">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="w-11 h-11 -ml-1.5 rounded-full flex items-center justify-center text-foreground active:bg-accent/70 transition"
        >
          <Menu className="w-[22px] h-[22px]" strokeWidth={2} />
        </button>
        <div className="flex items-center justify-center min-w-0">
          {mode && onModeChange ? (
            <ResponsiveModelSelector
              mode={mode}
              onChange={onModeChange}
              userTier={userTier}
              compact
            />
          ) : (
            <span className="font-display font-semibold tracking-tight text-[17px] text-foreground truncate px-2">
              KovaGPT
            </span>
          )}
        </div>
        {showAuth ? (
          <div className="flex items-center gap-1 pr-1">
            <SignInButton mode="modal">
              <button className="text-[13px] font-medium px-2.5 h-8 rounded-full text-foreground active:bg-accent/70 transition">
                Log in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="text-[13px] font-semibold px-3 h-8 rounded-full bg-foreground text-background active:opacity-80 transition whitespace-nowrap">
                Sign up
              </button>
            </SignUpButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            className="w-11 h-11 -mr-1.5 rounded-full flex items-center justify-center text-foreground active:bg-accent/70 transition"
          >
            <PenSquare className="w-[20px] h-[20px]" strokeWidth={2} />
          </button>
        )}
      </div>
    </header>
  );
}
