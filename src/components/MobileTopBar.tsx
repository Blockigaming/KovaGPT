import { Menu, MessageSquareDashed, Sliders, SquarePen } from "lucide-react";
import { useUser, SignInButton, clerkEnabled } from "@/components/auth/ClerkSafe";
import { ResponsiveModelSelector } from "@/components/ResponsiveModelSelector";
import type { ModeId, Tier } from "@/lib/modes";

/**
 * Compact sticky top bar shown on phones and tablets (any viewport below the
 * desktop breakpoint). Provides a menu trigger to open the off-canvas sidebar,
 * brand identity / model selector, and a quick "new chat" action.
 * Signed-out users see a compact login action. Honors safe-area-inset-top
 * and uses a translucent surface so content eases through as it scrolls.
 */
export function MobileTopBar({
  onOpenSidebar,
  onNewChat,
  title,
  mode,
  onModeChange,
  userTier = "free",
  temporaryChat = false,
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
  onTemporaryChatChange?: (enabled: boolean) => void;
  /** Opens per-chat rules and pinned files; omitted when there is no chat yet. */
  onOpenChatSettings?: () => void;
  chatRulesActive?: boolean;
  skill?: { name: string; clear: () => void; disabled: boolean };
}) {
  const { isLoaded, isSignedIn } = useUser();
  const showAuth = isLoaded && clerkEnabled && !isSignedIn;

  return (
    <header className="kova-topbar sticky top-0 z-30 lg:hidden">
      <div className="kova-topbar-inner grid min-h-14 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-1 px-2 pb-1">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="kova-action flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-accent/70 active:bg-accent"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        <div className="flex min-w-0 items-center justify-start gap-1.5 pl-0.5">
          {mode && onModeChange ? (
            <ResponsiveModelSelector
              mode={mode}
              onChange={onModeChange}
              userTier={userTier}
              placement="topbar"
              compact
            />
          ) : (
            <div className="flex min-w-0 items-center justify-start">
              <span className="font-display truncate text-[15px] font-semibold tracking-tight">
                {title || "KovaGPT"}
              </span>
            </div>
          )}
          {skill ? (
            <button
              type="button"
              onClick={skill.clear}
              disabled={skill.disabled}
              className="max-w-[5.5rem] shrink truncate rounded-full border border-border/80 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
              aria-label={`Clear workflow skill ${skill.name}`}
              title="Clear skill"
            >
              {skill.name} ×
            </button>
          ) : null}
        </div>

        {showAuth ? (
          <SignInButton mode="modal">
            <button
              type="button"
              className="mr-0.5 min-h-11 justify-self-end whitespace-nowrap rounded-full bg-foreground px-4 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 active:opacity-80"
            >
              Log in
            </button>
          </SignInButton>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            {onOpenChatSettings ? (
              <button
                type="button"
                onClick={onOpenChatSettings}
                aria-label={chatRulesActive ? "Chat settings, rules active" : "Chat settings"}
                title="Chat settings"
                className={`kova-action flex h-11 w-11 items-center justify-center rounded-xl ${
                  chatRulesActive
                    ? "bg-primary/15 text-primary"
                    : "text-foreground hover:bg-accent/70 active:bg-accent"
                }`}
              >
                <Sliders className="h-5 w-5" strokeWidth={1.75} />
              </button>
            ) : null}

            {isSignedIn && onTemporaryChatChange ? (
              <button
                type="button"
                onClick={() => onTemporaryChatChange(!temporaryChat)}
                aria-label={temporaryChat ? "Turn off temporary chat" : "Start temporary chat"}
                aria-pressed={temporaryChat}
                title={temporaryChat ? "Temporary chat on" : "Start temporary chat"}
                data-state={temporaryChat ? "on" : "off"}
                className={`kova-action flex h-11 w-11 items-center justify-center rounded-xl ${
                  temporaryChat
                    ? "bg-primary/15 text-primary"
                    : "text-foreground hover:bg-accent/70 active:bg-accent"
                }`}
              >
                <MessageSquareDashed className="h-5 w-5" strokeWidth={1.75} />
              </button>
            ) : null}

            <button
              type="button"
              onClick={onNewChat}
              aria-label="New chat"
              className="kova-action flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-accent/70 active:bg-accent"
            >
              <SquarePen className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
