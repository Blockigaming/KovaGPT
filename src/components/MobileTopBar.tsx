import { PenSquare, ChevronDown, Menu } from "lucide-react";
import { useLayout } from "@/hooks/use-mobile";
import { useUser, SignInButton, SignUpButton, clerkEnabled } from "@/components/auth/ClerkSafe";

/**
 * ChatGPT-style compact top bar for phones/tablets:
 *   left: hamburger (open sidebar)
 *   center: "KovaGPT ⌄" pill (visually acts as the model selector)
 *   right: new-chat pencil, or Log in / Sign up when signed out.
 * Honors safe-area-inset-top.
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
  const label = title || "KovaGPT";
  return (
    <header
      className="sticky top-0 z-30 lg:hidden bg-background/90 backdrop-blur-xl"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      role="banner"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center h-11 px-1">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="w-10 h-10 rounded-full flex items-center justify-center text-foreground hover:bg-accent/60 active:scale-95 transition"
        >
          <Menu className="w-[22px] h-[22px]" />
        </button>
        <div className="flex items-center justify-center min-w-0">
          <button
            type="button"
            className="flex items-center gap-1 min-w-0 px-2.5 py-1.5 rounded-full text-foreground active:bg-accent/60 transition"
            aria-label="KovaGPT model"
          >
            <span className="font-display font-semibold tracking-tight text-[17px] truncate">
              {label}
            </span>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          </button>
        </div>
        {showAuth ? (
          <div className="flex items-center gap-1 pr-1">
            <SignInButton mode="modal">
              <button className="text-[13px] font-medium px-2.5 h-8 rounded-full text-foreground hover:bg-accent/60 active:scale-95 transition">
                Log in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="text-[13px] font-semibold px-3 h-8 rounded-full bg-foreground text-background hover:opacity-90 active:scale-95 transition whitespace-nowrap">
                Sign up
              </button>
            </SignUpButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            className="w-10 h-10 rounded-full flex items-center justify-center text-foreground hover:bg-accent/60 active:scale-95 transition"
          >
            <PenSquare className="w-[21px] h-[21px]" />
          </button>
        )}
      </div>
    </header>
  );
}




