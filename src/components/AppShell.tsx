import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog, type Settings, DEFAULT_SETTINGS } from "@/components/SettingsDialog";

import { OnboardingDialog } from "@/components/OnboardingDialog";
import { TimersWidget } from "@/components/TimersWidget";
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
  const [helpOpen, setHelpOpen] = useState(false);
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
        onOpenHelp={() => setHelpOpen(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed top-3 left-3 z-30 p-2 rounded-md bg-background/90 border border-border hover:bg-accent transition shadow-sm"
            aria-label="Open sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        {children}
      </div>

      {/* Mobile floating actions */}
      <div className="md:hidden fixed right-3 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5rem))] z-30 flex flex-col gap-2">
        <button
          onClick={handleNew}
          className="w-11 h-11 rounded-full bg-foreground text-background shadow-lg flex items-center justify-center active:scale-95 transition"
          aria-label="New chat"
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          onClick={() => openSettings()}
          className="w-11 h-11 rounded-full bg-background border border-border shadow-lg flex items-center justify-center active:scale-95 transition"
          aria-label="Open settings"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>
      </div>

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
        onOpenHelp={() => setHelpOpen(true)}
        initialTab={settingsTab}
      />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <OnboardingDialog />
      <TimersWidget />
    </div>
  );
}
