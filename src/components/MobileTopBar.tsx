import { Menu, SquarePen } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { useLayout } from "@/hooks/use-mobile";
import { useUser, SignInButton, SignUpButton, clerkEnabled } from "@/components/auth/ClerkSafe";

/**
 * Compact sticky top bar shown on phones and tablets (any viewport below the
 * desktop breakpoint). Provides a menu trigger to open the off-canvas sidebar,
 * brand identity, and a quick "new chat" action. Signed-out users see a
 * compact "Sign up" pill instead of the new-chat icon so they can always
 * reach auth from the top bar. Honors safe-area-inset-top and uses
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
  const { isDesktop } = useLayout();
  const { isLoaded, isSignedIn } = useUser();
  if (isDesktop) return null;
  const showAuth = isLoaded && clerkEnabled && !isSignedIn;
  return (
    <header
      className="sticky top-0 z-30 lg:hidden bg-background/80 backdrop-blur-xl border-b border-border/50"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      role="banner"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 min-h-14 px-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="w-11 h-11 rounded-full flex items-center justify-center text-foreground hover:bg-accent/60 active:scale-95 transition"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center justify-center gap-2 min-w-0">
          <NovaLogo className="w-5 h-5 shrink-0" />
          <span className="font-display font-semibold tracking-tight text-[15px] truncate">
            {title || "KovaGPT"}
          </span>
        </div>
        {showAuth ? (
          <div className="flex items-center gap-1.5 pr-1">
            <SignInButton mode="modal">
              <button className="text-[13px] font-medium px-3 min-h-11 rounded-full text-foreground hover:bg-accent/60 active:scale-95 transition">
                Log in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="text-[13px] font-semibold px-3 min-h-11 rounded-full bg-foreground text-background hover:opacity-90 active:scale-95 transition whitespace-nowrap">
                Sign up
              </button>
            </SignUpButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            className="w-11 h-11 rounded-full flex items-center justify-center text-foreground hover:bg-accent/60 active:scale-95 transition"
          >
            <SquarePen className="w-5 h-5" />
          </button>
        )}
      </div>
    </header>
  );
}
