import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PanelLeft, MessageCircleOff, Sliders, SquarePen } from "lucide-react";
import { useUser, SignInButton, SignUpButton, clerkEnabled } from "@/components/auth/ClerkSafe";
import type { ModeId, Tier } from "@/lib/modes";

/**
 * Compact sticky top bar shown on phones and tablets (any viewport below the
 * desktop breakpoint). Provides a menu trigger to open the off-canvas sidebar,
 * brand identity, and a quick "new chat" action. Signed-out users see a
 * compact login and signup actions instead of the new-chat icon so they can always
 * reach auth from the top bar. Honors safe-area-inset-top and uses
 * an opaque ChatGPT-style action bar with consistent 44px touch targets.
 */
export function MobileTopBar({
  onOpenSidebar,
  onNewChat,
  title,
  temporaryChat = false,
  chatStarted = false,
  conversationActions,
  onTemporaryChatChange,
  onOpenChatSettings,
  chatRulesActive = false,
  skill,
}: {
  onOpenSidebar: () => void;
  onNewChat: () => void;
  title?: string;
  mode?: ModeId;
  onModeChange?: (mode: ModeId) => void;
  userTier?: Tier;
  temporaryChat?: boolean;
  chatStarted?: boolean;
  conversationActions?: ReactNode;
  onTemporaryChatChange?: (enabled: boolean, trigger: HTMLButtonElement) => void;
  /** Opens per-chat rules and pinned files; omitted when there is no chat yet. */
  onOpenChatSettings?: (trigger: HTMLButtonElement) => void;
  chatRulesActive?: boolean;
  skill?: { name: string; clear: () => void; disabled: boolean };
}) {
  const { isLoaded, isSignedIn } = useUser();
  const showAuth = isLoaded && clerkEnabled && !isSignedIn;

  return (
    <header
      data-ui-reference="chatgpt-mobile-topbar"
      className="kova-topbar sticky top-0 z-30 lg:hidden"
    >
      <div className="kova-topbar-inner grid min-h-14 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-1 px-2 pb-1">
        <Button
          variant="ghost"
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          aria-controls="kova-primary-navigation"
          aria-haspopup="dialog"
          className="kova-action kova-sidebar-toggle w-11 h-11 text-foreground"
        >
          <PanelLeft className="w-5 h-5" aria-hidden="true" />
        </Button>
        <div className="flex min-w-0 items-center justify-start gap-1 pl-1">
          <span
            role="heading"
            aria-level={1}
            data-kova-navigation-heading=""
            className="spec400-mobile-page-title min-w-0 truncate text-sm font-medium"
          >
            {title || "KovaGPT"}
          </span>
          {skill ? (
            <Button
              variant="ghost"
              type="button"
              onClick={skill.clear}
              disabled={skill.disabled}
              className="min-h-11 min-w-11 max-w-[5.5rem] shrink truncate rounded-full border border-border/80 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
              aria-label={`Clear workflow skill ${skill.name}`}
              title="Clear skill"
            >
              {skill.name} ×
            </Button>
          ) : null}
        </div>
        {showAuth && !chatStarted ? (
          <div className="flex items-center justify-end gap-1">
            <SignInButton mode="modal">
              <Button
                variant="ghost"
                type="button"
                className="kova-auth-primary min-h-11 whitespace-nowrap rounded-full bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80"
              >
                Log in
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button
                variant="ghost"
                type="button"
                className="kova-auth-sign-up min-h-11 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80"
              >
                Sign up
              </Button>
            </SignUpButton>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            {conversationActions}
            {!conversationActions && onOpenChatSettings ? (
              <Button
                variant="ghost"
                type="button"
                onClick={(event) => onOpenChatSettings(event.currentTarget)}
                aria-label={chatRulesActive ? "Chat settings, rules active" : "Chat settings"}
                title="Chat settings"
                className={`kova-action flex h-11 w-11 items-center justify-center rounded-xl ${
                  chatRulesActive
                    ? "bg-muted text-foreground"
                    : "text-foreground hover:bg-accent/70 active:bg-accent"
                }`}
              >
                <Sliders className="h-5 w-5" strokeWidth={1.75} />
              </Button>
            ) : null}
            {isSignedIn && !chatStarted && onTemporaryChatChange ? (
              <Button
                variant="ghost"
                type="button"
                onClick={(event) => onTemporaryChatChange(!temporaryChat, event.currentTarget)}
                aria-label={temporaryChat ? "Turn off temporary chat" : "Start temporary chat"}
                aria-pressed={temporaryChat}
                title={temporaryChat ? "Temporary chat on" : "Start temporary chat"}
                data-state={temporaryChat ? "on" : "off"}
                className={`kova-action flex h-11 w-11 items-center justify-center rounded-xl ${
                  temporaryChat
                    ? "bg-muted text-foreground"
                    : "text-foreground hover:bg-accent/70 active:bg-accent"
                }`}
              >
                <MessageCircleOff className="h-5 w-5" aria-hidden="true" />
              </Button>
            ) : null}

            <Button
              variant="ghost"
              type="button"
              onClick={onNewChat}
              aria-label="New chat"
              className="kova-action flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-accent/70 active:bg-accent"
            >
              <SquarePen className="h-5 w-5" strokeWidth={1.75} />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
