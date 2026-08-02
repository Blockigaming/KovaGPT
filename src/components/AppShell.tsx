import { lazy, Suspense, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { type Settings, DEFAULT_SETTINGS } from "@/lib/settings-types";
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
import {
  type Conversation,
  loadConversations,
  saveConversations,
  subscribeToConversationChanges,
} from "@/lib/chat-store";

/**
 * Shared shell that renders the chat Sidebar alongside any page (e.g. /apps,
 * /library). Conversation actions navigate back to the home chat route.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Default closed to avoid a flash-of-open sidebar during SSR/hydration on
  // narrow viewports; on desktop we restore the persisted user preference.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarRestored, setSidebarRestored] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth < 1024) {
      setSidebarRestored(true);
      return;
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("kova-sidebar-open");
    } catch {
      /* ignore */
    }
    setSidebarOpen(saved === null ? true : saved === "1");
    const frame = window.requestAnimationFrame(() => setSidebarRestored(true));
    return () => window.cancelAnimationFrame(frame);
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setConversations(loadConversations());
    return subscribeToConversationChanges(setConversations);
  }, []);

  useEffect(() => {
    return installShortcutListener({
      "new-chat": () => {
        try {
          localStorage.removeItem("nova-gpt-pending-active");
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
    });
  }, [navigate]);

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
    try {
      localStorage.setItem("nova-gpt-pending-active", id);
    } catch {
      /* ignore */
    }
    navigate({ to: "/" });
  };

  const handleNew = () => {
    try {
      localStorage.removeItem("nova-gpt-pending-active");
    } catch {
      /* ignore */
    }
    navigate({ to: "/" });
  };

  const handleDelete = (id: string) => {
    const next = conversations.filter((c) => c.id !== id);
    setConversations(next);
    saveConversations(next);
  };

  const handleRename = (id: string, title: string) => {
    const next = conversations.map((conversation) =>
      conversation.id === id ? { ...conversation, title, updatedAt: Date.now() } : conversation,
    );
    setConversations(next);
    saveConversations(next);
  };

  return (
    <div
      className="relative flex h-[100dvh] w-full overflow-hidden bg-[var(--surface-workspace)] text-foreground"
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
        onRename={handleRename}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={openSettings}
        onOpenHelp={openHelp}
        focusToggleOnChange={sidebarRestored}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <OfflineBanner />
        <MobileTopBar onOpenSidebar={() => setSidebarOpen(true)} onNewChat={handleNew} />
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="hidden lg:flex fixed top-3 left-3 z-30 p-2 rounded-md bg-background/90 border border-border hover:bg-accent transition shadow-sm items-center justify-center"
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
              try {
                localStorage.removeItem("nova-gpt-conversations-v2");
              } catch {
                /* ignore */
              }
              setConversations([]);
            }}
            onOpenHelp={openHelp}
            initialTab={settingsTab}
          />
        )}
        <OnboardingDialog />
      </Suspense>
      <TimersWidget />
    </div>
  );
}
