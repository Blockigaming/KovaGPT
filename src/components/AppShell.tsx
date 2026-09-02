import { lazy, Suspense, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
const SettingsDialog = lazy(() =>
  import("@/components/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const OnboardingDialog = lazy(() =>
  import("@/components/OnboardingDialog").then((m) => ({ default: m.OnboardingDialog })),
);
import { TimersWidget } from "@/components/TimersWidget";
import { AppErrorBoundary, OfflineBanner } from "@/components/states";
import { MobileTopBar } from "@/components/MobileTopBar";
import { installShortcutListener } from "@/lib/shortcuts";
import { PanelLeft } from "lucide-react";
import { useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import {
  type Conversation,
  chatStoragePrincipal,
  clearPendingActive,
  loadConversations,
  saveConversations,
  savePendingActive,
} from "@/lib/chat-store";
import { useNovaSettings } from "@/lib/use-nova-settings";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

/**
 * Shared shell that renders the chat Sidebar alongside any page (e.g. /apps,
 * /library). Conversation actions navigate back to the home chat route.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isLoaded, user } = useUser();
  const { openSignIn } = useClerkSafe();
  const userKey = user?.id ?? null;
  const storagePrincipal = chatStoragePrincipal(userKey);
  const [conversationState, setConversationState] = useState<{
    principal: string | null;
    items: Conversation[];
  }>({ principal: null, items: [] });
  const principalReady = isLoaded && conversationState.principal === storagePrincipal;
  const conversations = principalReady ? conversationState.items : [];
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth < 1024) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("kova-sidebar-open");
    } catch {
      /* ignore */
    }
    setSidebarOpen(saved === null ? true : saved === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth < 1024) return;
    try {
      localStorage.setItem("kova-sidebar-open", sidebarOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarOpen]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const openHelp = useCallback(() => {
    navigate({ to: "/help" as never });
  }, [navigate]);
  const [settings, setSettings] = useNovaSettings(userKey, isLoaded);

  const openSettings = useCallback(
    (tab?: string) => {
      if (isLoaded && !user) {
        setSettingsOpen(false);
        openSignIn();
        return;
      }
      if (!isLoaded) return;
      settingsReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSettingsTab(tab);
      setSettingsOpen(true);
    },
    [isLoaded, openSignIn, user],
  );

  useEffect(() => {
    if (!isLoaded) {
      setConversationState({ principal: null, items: [] });
      setSettingsOpen(false);
      return;
    }
    setSettingsOpen(false);
    setConversationState({
      principal: storagePrincipal,
      items: loadConversations(userKey),
    });
  }, [isLoaded, storagePrincipal, userKey]);

  useEffect(() => {
    if (!isLoaded) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      setConversationState({ principal: null, items: [] });
      setSettingsOpen(false);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, userKey]);

  useEffect(() => {
    return installShortcutListener(
      {
        "new-chat": () => {
          try {
            clearPendingActive(userKey);
          } catch {
            /* ignore */
          }
          navigate({ to: "/" });
        },
        search: () => {
          window.dispatchEvent(new CustomEvent("kova-open-search"));
        },
        "open-projects": () => {
          navigate({ to: "/projects" as never });
        },
        "open-library": () => {
          navigate({ to: "/library" });
        },
        "open-settings": () => openSettings(),
        "generate-image": () => {
          navigate({ to: "/images" });
        },
        "toggle-sidebar": () => {
          setSidebarOpen((value) => !value);
        },
        "focus-input": () => {
          const element = document.querySelector<HTMLTextAreaElement>(
            'textarea, [contenteditable="true"]',
          );
          element?.focus();
        },
      },
      isLoaded ? userKey : undefined,
    );
  }, [isLoaded, navigate, openSettings, userKey]);

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      openSettings(tab);
    };
    window.addEventListener("kova-open-settings", handleOpenSettings);
    return () => window.removeEventListener("kova-open-settings", handleOpenSettings);
  }, [openSettings]);

  const goToConversation = (id: string) => {
    if (!principalReady) return;
    try {
      savePendingActive(userKey, id);
    } catch {
      /* ignore */
    }
    navigate({ to: "/" });
  };

  const handleNew = () => {
    try {
      clearPendingActive(userKey);
    } catch {
      /* ignore */
    }
    navigate({ to: "/" });
  };

  const handleDelete = (id: string) => {
    if (!principalReady) return;
    const next = conversations.filter((conversation) => conversation.id !== id);
    setConversationState({ principal: storagePrincipal, items: next });
    saveConversations(userKey, next);
  };

  return (
    <div
      className="relative flex h-[100dvh] w-full overflow-hidden bg-[var(--surface-workspace)] text-foreground"
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (touch && touch.clientX < 24 && window.innerWidth < 1024) {
          (event.currentTarget as HTMLDivElement).dataset.swipeStart = String(touch.clientX);
          (event.currentTarget as HTMLDivElement).dataset.swipeY = String(touch.clientY);
        }
      }}
      onTouchMove={(event) => {
        const element = event.currentTarget as HTMLDivElement;
        const start = element.dataset.swipeStart
          ? parseFloat(element.dataset.swipeStart)
          : Number.NaN;
        const startY = element.dataset.swipeY ? parseFloat(element.dataset.swipeY) : Number.NaN;
        if (!Number.isNaN(start) && event.touches[0]) {
          const dx = event.touches[0].clientX - start;
          const dy = Math.abs(event.touches[0].clientY - startY);
          if (dx > 60 && dy < 40) {
            setSidebarOpen(true);
            delete element.dataset.swipeStart;
          }
        }
      }}
      onTouchEnd={(event) => {
        delete (event.currentTarget as HTMLDivElement).dataset.swipeStart;
      }}
    >
      <Sidebar
        conversations={conversations}
        activeId={null}
        onSelect={goToConversation}
        onNew={handleNew}
        onDelete={handleDelete}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
        onOpenSettings={openSettings}
        onOpenHelp={openHelp}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <OfflineBanner />
        <MobileTopBar onOpenSidebar={() => setSidebarOpen(true)} onNewChat={handleNew} />
        {!sidebarOpen ? (
          <button
            onClick={() => {
              setSidebarOpen(true);
              window.requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>('[aria-label="Collapse sidebar"]')
                  ?.focus({ preventScroll: true });
              });
            }}
            className="fixed left-3 top-3 z-30 hidden items-center justify-center rounded-md border border-border bg-background/90 p-2 shadow-sm transition hover:bg-accent lg:flex"
            aria-label="Open sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        ) : null}
        <AppErrorBoundary>{children}</AppErrorBoundary>
      </div>

      <Suspense fallback={null}>
        {settingsOpen && user ? (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            returnFocusTarget={settingsReturnFocusRef.current}
            onChange={setSettings}
            onClearAll={() => {
              setConversationState({ principal: storagePrincipal, items: [] });
            }}
            onOpenHelp={openHelp}
            initialTab={settingsTab}
          />
        ) : null}
        <OnboardingDialog />
      </Suspense>
      <TimersWidget userKey={userKey} principalResolved={isLoaded} />
    </div>
  );
}
