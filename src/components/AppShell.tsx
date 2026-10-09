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
  archiveConversation,
  newId,
} from "@/lib/chat-store";
import { chatHistorySnapshot } from "@/lib/chat-history-bridge";
import { useNovaSettings } from "@/lib/use-nova-settings";
import { saveStoredSettings } from "@/lib/settings-storage";
import { stageOnboardingHandoff } from "@/lib/onboarding-handoff";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";
import { persistChatRoute } from "@/lib/chat-route-persistence";
import { toast } from "sonner";
import { MAPS_RELEASE_APPROVED } from "@/lib/maps-release-gate";

/**
 * Shared shell that renders the chat Sidebar alongside any page (e.g. /apps,
 * /library). Conversation actions navigate back to the home chat route.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const storagePrincipal = chatStoragePrincipal(userKey);
  const principalRef = useRef(storagePrincipal);
  principalRef.current = isLoaded ? storagePrincipal : "loading";
  const selectionRef = useRef(0);
  const historyWriteRef = useRef<object | null>(null);
  useEffect(
    () => () => {
      selectionRef.current += 1;
    },
    [],
  );
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
    selectionRef.current += 1;
    historyWriteRef.current = null;
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
      selectionRef.current += 1;
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
          selectionRef.current += 1;
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

  const goToConversation = async (id: string) => {
    if (!principalReady) return;
    const selection = ++selectionRef.current;
    const current = () =>
      principalRef.current === storagePrincipal && selectionRef.current === selection;
    const saved = await persistChatRoute(userKey, conversations, id, current);
    if (!current()) return;
    if (!saved) {
      toast.error("This chat could not be saved. Please retry.");
      return;
    }
    clearPendingActive(userKey);
    void navigate({ to: "/c/$conversationId", params: { conversationId: id } });
  };

  const handleNew = () => {
    selectionRef.current += 1;
    try {
      clearPendingActive(userKey);
    } catch {
      /* ignore */
    }
    navigate({ to: "/" });
  };

  const updateHistory = async (
    update: (items: Conversation[]) => Conversation[],
    failureMessage: string,
    beforeSave?: (items: Conversation[]) => boolean | Promise<boolean>,
  ) => {
    if (!principalReady || historyWriteRef.current) return false;
    const operation = {};
    historyWriteRef.current = operation;
    const selection = selectionRef.current;
    const current = () =>
      principalRef.current === storagePrincipal && selectionRef.current === selection;
    try {
      if (beforeSave && !(await beforeSave(loadConversations(userKey)))) {
        if (current()) toast.error(failureMessage);
        return false;
      }
      if (!current()) return false;
      const next = update(loadConversations(userKey));
      const saved = await saveConversations(userKey, next, {
        snapshot: chatHistorySnapshot(userKey),
      });
      if (!current()) return false;
      if (!saved) {
        toast.error(failureMessage);
        return false;
      }
      setConversationState({ principal: storagePrincipal, items: next });
      return true;
    } catch {
      if (current()) toast.error(failureMessage);
      return false;
    } finally {
      if (historyWriteRef.current === operation) historyWriteRef.current = null;
    }
  };
  const handleDelete = (id: string) =>
    updateHistory(
      (items) => items.filter((item) => item.id !== id),
      "This chat could not be deleted. Please retry.",
    );
  const handleRename = (id: string, value: string) => {
    const title = value.trim().slice(0, 160);
    if (!title) return false;
    return updateHistory(
      (items) =>
        items.map((item) => (item.id === id ? { ...item, title, updatedAt: Date.now() } : item)),
      "This chat could not be renamed. Please retry.",
    );
  };
  const handleArchive = (id: string) =>
    updateHistory(
      (items) => items.filter((item) => item.id !== id),
      "This chat could not be archived. Please retry.",
      (items) => {
        const chat = items.find((item) => item.id === id);
        return chat ? archiveConversation(userKey, chat) : false;
      },
    );
  const handleDuplicate = (id: string) =>
    updateHistory((items) => {
      const source = items.find((item) => item.id === id);
      if (!source) throw new Error("Chat unavailable");
      const copy = {
        ...source,
        id: newId(),
        title: `${source.title} (copy)`,
        messages: source.messages.map((message) => ({ ...message, id: newId() })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return [copy, ...items];
    }, "This chat could not be duplicated. Please retry.");

  return (
    <div className="kova-app-shell relative flex h-[100dvh] w-full overflow-hidden bg-[var(--surface-workspace)] text-foreground">
      <Sidebar
        conversations={conversations}
        activeId={null}
        onSelect={goToConversation}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
        onArchive={handleArchive}
        onDuplicate={handleDuplicate}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={openSettings}
        onOpenHelp={openHelp}
        mapsReleaseApproved={MAPS_RELEASE_APPROVED}
      />

      <div
        className="kova-app-content flex-1 min-w-0 flex flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        data-sidebar={sidebarOpen ? "open" : "closed"}
      >
        <OfflineBanner />
        <MobileTopBar onOpenSidebar={() => setSidebarOpen(true)} onNewChat={handleNew} />
        <div className="kova-core-utilities flex shrink-0 justify-end px-4 py-2 lg:px-8">
          <TimersWidget
            userKey={userKey}
            principalResolved={isLoaded}
            mobileSidebarOpen={sidebarOpen}
          />
        </div>
        {!sidebarOpen && !user && (
          <button
            onClick={(event) => {
              const keyboardActivated = event.detail === 0;
              setSidebarOpen(true);
              if (!keyboardActivated) return;
              window.requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>('[aria-label="Collapse sidebar"]')
                  ?.focus({ preventScroll: true });
              });
            }}
            className="kova-floating-sidebar-trigger kova-sidebar-toggle hidden lg:flex fixed top-3 left-3 z-30 h-10 w-10 rounded-xl transition items-center justify-center"
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
        <OnboardingDialog
          onCompletion={(completion) => {
            const { responseLength } = completion;
            const next = { ...settings, responseLength };
            setSettings(next);
            try {
              saveStoredSettings(userKey, next);
            } catch {
              /* The in-memory preference still applies until navigation. */
            }
            stageOnboardingHandoff(completion);
          }}
        />
      </Suspense>
    </div>
  );
}
