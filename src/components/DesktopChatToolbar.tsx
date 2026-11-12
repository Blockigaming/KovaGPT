import type { MouseEventHandler, ReactNode } from "react";
import { lazy, Suspense } from "react";
import { PanelLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignInButton, SignUpButton } from "@/components/auth/ClerkSafe";

const TemporaryChatToggle = lazy(() =>
  import("@/components/TemporaryChatStartDialog").then((module) => ({
    default: module.TemporaryChatToggle,
  })),
);

export default function DesktopChatToolbar({
  sidebarOpen,
  isSignedIn,
  isLoaded,
  chatStarted,
  chatTitle,
  selectedWorkflowSkill,
  isStreaming,
  clearWorkflowSkill,
  jumpToLatestButton,
  freeOfferButton,
  actions,
  tempChat,
  tempChatConfirmed,
  onOpenSidebar,
  onToggleTemporaryChat,
}: {
  sidebarOpen: boolean;
  isSignedIn?: boolean;
  isLoaded: boolean;
  chatStarted: boolean;
  chatTitle?: string;
  selectedWorkflowSkill: { name: string } | null;
  isStreaming: boolean;
  clearWorkflowSkill: () => void;
  jumpToLatestButton: ReactNode;
  freeOfferButton: ReactNode;
  actions: ReactNode;
  tempChat: boolean;
  tempChatConfirmed: boolean;
  onOpenSidebar: MouseEventHandler<HTMLButtonElement>;
  onToggleTemporaryChat: (trigger: HTMLButtonElement | null) => void;
}) {
  return (
    <header className="kova-topbar kova-desktop-topbar relative hidden h-[56px] items-center gap-1 px-4 lg:flex">
      <div
        hidden={sidebarOpen || Boolean(isSignedIn)}
        className="flex items-center gap-1 mr-2 shrink-0"
      >
        <button
          onClick={onOpenSidebar}
          className="kova-topbar-button kova-sidebar-toggle shrink-0 rounded-xl p-2 transition"
          aria-label="Open sidebar"
          title="Open sidebar"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center min-w-0 flex-1 relative">
        <div className="spec400-chat-title">
          {chatStarted ? chatTitle || "Chat" : sidebarOpen ? "" : "KovaGPT"}
        </div>
        {selectedWorkflowSkill ? (
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={clearWorkflowSkill}
            disabled={isStreaming}
            className="ml-2 max-w-56 text-muted-foreground"
            aria-label={`Clear workflow skill ${selectedWorkflowSkill.name}`}
            title="Clear skill"
          >
            <span className="truncate">{selectedWorkflowSkill.name}</span>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {jumpToLatestButton}
        {freeOfferButton}
        {actions}
        {isLoaded && isSignedIn && !chatStarted && (
          <Suspense fallback={<span className="h-9 w-9" aria-hidden="true" />}>
            <TemporaryChatToggle
              enabled={tempChat}
              confirmed={tempChatConfirmed}
              onToggle={(trigger) => {
                onToggleTemporaryChat(trigger);
              }}
            />
          </Suspense>
        )}
        {isLoaded && !isSignedIn && !chatStarted ? (
          <>
            <SignInButton mode="modal">
              <button className="kova-auth-primary h-10 rounded-full bg-foreground px-4 text-sm font-semibold text-background hover:opacity-90 active:scale-[0.98] transition">
                Log in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="kova-auth-sign-up h-10 whitespace-nowrap rounded-full px-4 text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition">
                Sign up for free
              </button>
            </SignUpButton>
          </>
        ) : null}
      </div>
    </header>
  );
}
