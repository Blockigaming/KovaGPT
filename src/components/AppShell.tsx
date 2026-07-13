import { lazy, Suspense, useEffect, useState, useCallback, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { type Settings, DEFAULT_SETTINGS } from "@/components/SettingsDialog";
const SettingsDialog = lazy(() => import("@/components/SettingsDialog").then(m => ({ default: m.SettingsDialog })));
const OnboardingDialog = lazy(() => import("@/components/OnboardingDialog").then(m => ({ default: m.OnboardingDialog })));
import { TimersWidget } from "@/components/TimersWidget";
import { AppErrorBoundary, OfflineBanner } from "@/components/states";
import { installShortcutListener } from "@/lib/shortcuts";
import { PanelLeft, Plus, Settings as SettingsIcon } from "lucide-react";
import {
  type Conversation,
  loadConversations,
  saveConversations,
} from "@/lib/chat-store";


/**
 * Shared shell that renders the chat Sidebar alongside any page (e.g. /apps,
 * /library). Conversation actions navigate back to the home chat route.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const openHelp = useCallback(() => { navigate({ to: "/help" as never }); }, [navigate]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setConversations(loadConversations());
  }, []);

  useEffect(() => {
    return installShortcutListener({
      "new-chat": () => { try { localStorage.removeItem("nova-gpt-pending-active"); } catch { /* ignore */ } navigate({ to: "/" }); },
      "search": () => { window.dispatchEvent(new CustomEvent("kova-open-search")); },
      "open-projects": () => { navigate({ to: "/projects" as never }); },
      "open-library": () => { navigate({ to: "/library" }); },
      "open-settings": () => { setSettingsTab(undefined); setSettingsOpen(true); },
      "generate-image": () => { navigate({ to: "/images" }); },
      "toggle-sidebar": () => { setSidebarOpen((v) => !v); },
      "focus-input": () => {
        const el = document.querySelector<HTMLTextAreaElement>('textarea, [contenteditable="true"]');
        el?.focus();
      },
    });
  }, [navigate]);

  const openSettings = useCallback((tab?: string) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const goToConversation = (id: string) => {
    try {
      localStorage.setItem("nova-gpt-pending-active", id);
    } catch { /* ignore */ }
    navigate({ to: "/" });
  };

  const handleNew = () => {
    try { localStorage.removeItem("nova-gpt-pending-active"); } catch { /* ignore */ }
    navigate({ to: "/" });
  };

  const handleDelete = (id: string) => {
    const next = conversations.filter((c) => c.id !== id);
    setConversations(next);
    saveConversations(next);
  };

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
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

      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <OfflineBanner />
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed top-3 left-3 z-30 p-2 rounded-md bg-background/90 border border-border hover:bg-accent transition shadow-sm"
            aria-label="Open sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        <AppErrorBoundary>{children}</AppErrorBoundary>
      </div>

      {/* Mobile floating actions */}
      <div className="md:hidden fixed left-2 bottom-[max(0.5rem,calc(env(safe-area-inset-bottom)+0.25rem))] z-30 flex items-center gap-2">
        <button
          onClick={handleNew}
          className="h-11 px-4 rounded-2xl bg-[#3b82f6] text-white shadow-lg flex items-center gap-2 active:scale-95 transition font-medium text-sm hover:bg-[#2563eb]"
          aria-label="New chat"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </button>
        <button
          onClick={() => openSettings()}
          className="w-11 h-11 rounded-2xl bg-background border border-border shadow-lg flex items-center justify-center active:scale-95 transition"
          aria-label="Open settings"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>
      </div>


      <Suspense fallback={null}>
        {settingsOpen && (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onChange={setSettings}
            onClearAll={() => {
              try {
                localStorage.removeItem("nova-gpt-conversations-v2");
              } catch { /* ignore */ }
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
