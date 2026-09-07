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
import { useUser } from "@/components/auth/ClerkSafe";
import {
  type Conversation,
  chatStoragePrincipal,
  clearPendingActive,
  loadConversations,
  subscribeToConversationChanges,
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
  const userKey = user?.id ?? null;
  const storagePrincipal = chatStoragePrincipal(userKey);
  const [conversationState, setConversationState] = useState<{
    principal: string | null;
    items: Conversation[];
  }>({ principal: null, items: [] });
  const principalReady = isLoaded && conversationState.principal === storagePrincipal;
  const conversations = principalReady ? conversationState.items : [];
  // Default closed to avoid a flash-of-open sidebar during SSR/hydration on
  // narrow viewports; on desktop we restore the persisted user preference.
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
    return subscribeToConversationChanges(userKey, (items) =>
      setConversationState({ principal: storagePrincipal, items }),
    );
  }, [isLoaded, userKey, storagePrincipal]);

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
        "open-settings": () => {
          settingsReturnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setSettingsTab(undefined);
          setSettingsOpen(true);
        },
        "generate-image": () => {
          navigate({ to: "/images" });
        },
        "toggle-sidebar": () => {
          setSidebarOpen((v) => !v);
        },
        "focus-input": () => {
          const el = document.querySelector<HTMLTextAreaElement>(
            'textarea, [contenteditable="true"]',
          );
          el?.focus();
        },
      },
      isLoaded ? userKey : undefined,
    );
  }, [isLoaded, navigate, userKey]);

  const openSettings = useCallback((tab?: string) => {
    settingsReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

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

  const handleDelete = async (id: string) => {
    if (!principalReady) return;
    const next = conversations.filter((c) => c.id !== id);
    if (!(await saveConversations(userKey, next))) return;
    setConversationState({ principal: storagePrincipal, items: next });
  };

  return (
    <div
      className="kova-app-shell relative flex h-[100dvh] w-full overflow-hidden bg-[var(--surface-workspace)] text-foreground"
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t && t.clientX < 24 && window.innerWidth < 1024) {
          (e.currentTarget as HTMLDivElement).dataset.swipeStart = String(t.clientX);
          (e.currentTarget as HTMLDivElement).dataset.swipeY = String(t.clientY);
        }
      }}
      onTouchMove={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        const start = el.dataset.swipeStart ? parseFloat(el.dataset.swipeStart) : NaN;
        const startY = el.dataset.swipeY ? parseFloat(el.dataset.swipeY) : NaN;
        if (!isNaN(start) && e.touches[0]) {
          const dx = e.touches[0].clientX - start;
          const dy = Math.abs(e.touches[0].clientY - startY);
          if (dx > 60 && dy < 40) {
            setSidebarOpen(true);
            delete el.dataset.swipeStart;
          }
        }
      }}
      onTouchEnd={(e) => {
        delete (e.currentTarget as HTMLDivElement).dataset.swipeStart;
      }}
    >
      <Sidebar
        conversations={conversations}
        activeId={null}
        onSelect={goToConversation}
        onNew={handleNew}
        onDelete={handleDelete}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={openSettings}
        onOpenHelp={openHelp}
      />

      <div className="kova-app-content flex-1 min-w-0 flex flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <OfflineBanner />
        <MobileTopBar onOpenSidebar={() => setSidebarOpen(true)} onNewChat={handleNew} />
        {!sidebarOpen && (
          <button
            onClick={() => {
              setSidebarOpen(true);
              window.requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>('[aria-label="Collapse sidebar"]')
                  ?.focus({ preventScroll: true });
              });
            }}
            className="kova-floating-sidebar-trigger hidden lg:flex fixed top-3 left-3 z-30 h-10 w-10 rounded-xl bg-background/90 border border-border hover:bg-accent transition shadow-sm items-center justify-center"
            aria-label="Open sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        <AppErrorBoundary>{children}</AppErrorBoundary>
      </div>

      <Suspense fallback={null}>
        {settingsOpen && (
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
        )}
        <OnboardingDialog />
      </Suspense>
      <TimersWidget
        userKey={userKey}
        principalResolved={isLoaded}
        mobileSidebarOpen={sidebarOpen}
      />
    </div>
  );
}
