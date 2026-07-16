import { Menu, SquarePen, ChevronDown } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { useLayout } from "@/hooks/use-mobile";
import { useUser, SignInButton, SignUpButton, clerkEnabled } from "@/components/auth/ClerkSafe";

/**
 * ChatGPT-style compact top bar for phones/tablets. Left: sidebar menu.
 * Center: brand + subtle chevron (visual hint of active model). Right:
 * new-chat pencil, or Log in / Sign up when auth is available and the
 * user is signed out. Honors safe-area-inset-top.
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
      className="sticky top-0 z-30 lg:hidden bg-background/85 backdrop-blur-xl border-b border-border/40"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      role="banner"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 h-12 px-1.5">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="w-10 h-10 rounded-full flex items-center justify-center text-foreground hover:bg-accent/60 active:scale-95 transition"
        >
          <Menu className="w-[22px] h-[22px]" />
        </button>
        <div className="flex items-center justify-center min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-full active:bg-accent/60 transition">
            <NovaLogo className="w-4 h-4 shrink-0" />
            <span className="font-display font-semibold tracking-tight text-[15px] truncate">
              {label}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          </div>
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
            <SquarePen className="w-[22px] h-[22px]" />
          </button>
        )}
      </div>
    </header>
  );
}

