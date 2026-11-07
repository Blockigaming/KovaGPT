import { moveChatToTrash } from "@/lib/chat-trash";
import { toast } from "sonner";
import { lazy, Suspense, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { settingsSectionForTab } from "@/lib/settings-types";
import { Sidebar } from "@/components/Sidebar";
import { useSidebarPreference } from "@/hooks/use-sidebar-preference";
import { focusReopenedSidebar } from "@/lib/sidebar-keyboard-focus";
const SettingsDialog = lazy(() =>
  import("@/components/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const OnboardingDialog = lazy(() =>
  import("@/components/OnboardingDialog").then((m) => ({ default: m.OnboardingDialog })),
);
const ShareChatDialog = lazy(() =>
  import("@/components/ShareChatDialog").then((m) => ({ default: m.ShareChatDialog })),
);
import { WorkspacePageUtilities } from "@/components/WorkspacePageUtilities";
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
  savePendingActive,
  saveConversations,
} from "@/lib/chat-store";
import { chatHistorySnapshot } from "@/lib/chat-history-bridge";
import { useNovaSettings } from "@/lib/use-nova-settings";
import { saveStoredSettings } from "@/lib/settings-storage";
import { stageOnboardingHandoff } from "@/lib/onboarding-handoff";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";
import { MAPS_RELEASE_APPROVED } from "@/lib/maps-release-gate";

/**
 * Shared shell that renders the chat Sidebar alongside any page (e.g. /apps,
 * /library). Conversation actions navigate back to the home chat route.
 */
export function AppShell({
  children,
  utilitiesInHeader = false,
  hideUtilities = false,
  hideMobileTopBar = false,
}: {
  children: ReactNode;
  utilitiesInHeader?: boolean;
  hideUtilities?: boolean;
  hideMobileTopBar?: boolean;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pageTitle =
    (
      {
        library: "Library",
        projects: "Projects",
        work: "Work",
        "scheduled-tasks": "Scheduled tasks",
        apps: "Connections",
        settings: "Settings",
        images: "Images",
        profile: "Profile",
        billing: "Subscriptions",
        help: "Help",
      } as Record<string, string>
    )[pathname.split("/")[1]] ?? "KovaGPT";
  const { isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const storagePrincipal = chatStoragePrincipal(userKey);
  const trashPrincipalRef = useRef({ principal: storagePrincipal, ready: isLoaded, generation: 0 });
  if (
    trashPrincipalRef.current.principal !== storagePrincipal ||
    trashPrincipalRef.current.ready !== isLoaded
  ) {
    trashPrincipalRef.current = {
      principal: storagePrincipal,
      ready: isLoaded,
      generation: trashPrincipalRef.current.generation + 1,
    };
  }
  const [conversationState, setConversationState] = useState<{
    principal: string | null;
    items: Conversation[];
  }>({ principal: null, items: [] });
  const principalReady = isLoaded && conversationState.principal === storagePrincipal;
  const conversations = principalReady ? conversationState.items : [];
  const [sidebarOpen, setSidebarOpen] = useSidebarPreference();
  const sidebarKeyboardFocusRef = useRef(false);
  useEffect(() => {
    if (!sidebarOpen || !sidebarKeyboardFocusRef.current) return;
    sidebarKeyboardFocusRef.current = false;
    return focusReopenedSidebar();
  }, [sidebarOpen]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareChatId, setShareChatId] = useState<string | null>(null);
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
    setShareChatId(null);
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
      trashPrincipalRef.current.generation += 1;
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
          void navigate({ to: "/settings/$section", params: { section: "responses" } });
        },
        "generate-image": () => {
          navigate({ to: "/images" });
        },
        "toggle-sidebar": () => {
          if (document.querySelector('.kova-settings-dialog[role="dialog"]')) return;
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
  }, [isLoaded, navigate, setSidebarOpen, userKey]);

  const openSettings = useCallback(
    (tab?: string) => {
      if (window.matchMedia("(max-width: 1023px)").matches) {
        settingsReturnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setSettingsTab(tab);
        setSettingsOpen(true);
        return;
      }
      void navigate({
        to: "/settings/$section" as never,
        params: { section: settingsSectionForTab(tab) } as never,
        replace: pathname.startsWith("/settings/"),
      });
    },
    [navigate, pathname],
  );

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
    const chat = conversations.find((item) => item.id === id);
    if (!chat) return;
    const generation = trashPrincipalRef.current.generation;
    const current = () =>
      trashPrincipalRef.current.generation === generation && trashPrincipalRef.current.ready;
    try {
      if (!(await moveChatToTrash(userKey, chat, conversations, current)) || !current()) return;
      setConversationState({ principal: storagePrincipal, items: loadConversations(userKey) });
      toast.success("Chat removed. Recoverable chats are in Settings → Data controls → Trash.");
    } catch {
      if (current()) toast.error("Could not save Trash. Your chat was kept.");
    }
  };

  const utilities = hideUtilities ? null : (
    <div className="kova-core-utilities">
      <TimersWidget
        userKey={userKey}
        principalResolved={isLoaded}
        mobileSidebarOpen={sidebarOpen}
      />
    </div>
  );

  const updateSidebarChat = async (id: string, update: (chat: Conversation) => Conversation) => {
    if (!principalReady) return false;
    const generation = trashPrincipalRef.current.generation;
    const current = () =>
      trashPrincipalRef.current.generation === generation && trashPrincipalRef.current.ready;
    const snapshot = chatHistorySnapshot(userKey);
    const latest = loadConversations(userKey);
    if (!latest.some((chat) => chat.id === id) || !current()) return false;
    const next = latest.map((chat) => (chat.id === id ? update(chat) : chat));
    if (!(await saveConversations(userKey, next, { snapshot })) || !current()) return false;
    setConversationState({ principal: storagePrincipal, items: next });
    return true;
  };

  return (
    <div
      className="kova-app-shell relative flex h-[100dvh] w-full overflow-hidden bg-[var(--surface-workspace)] text-foreground"
      data-ui="modern"
    >
      <Sidebar
        conversations={conversations}
        activeId={null}
        onSelect={goToConversation}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={async (id, title) =>
          updateSidebarChat(id, (chat) => ({ ...chat, title, updatedAt: Date.now() }))
        }
        onTogglePin={(id) => {
          void updateSidebarChat(id, (chat) => ({
            ...chat,
            pinned: !chat.pinned,
            pinnedAt: chat.pinned ? undefined : Date.now(),
          }))
            .then((saved) => {
              if (!saved) toast.error("Your chat wasn't changed. Reopen it and try again.");
            })
            .catch(() => toast.error("Your chat wasn't changed. Try again."));
        }}
        onShare={setShareChatId}
        open={sidebarOpen && !settingsOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={openSettings}
        onOpenHelp={openHelp}
        mapsReleaseApproved={MAPS_RELEASE_APPROVED}
      />

      <div
        className="kova-app-content flex-1 min-w-0 flex flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        data-sidebar={sidebarOpen && !settingsOpen ? "open" : "closed"}
      >
        <OfflineBanner />
        {!hideMobileTopBar && (
          <MobileTopBar
            title={pageTitle}
            onOpenSidebar={() => setSidebarOpen(true)}
            onNewChat={handleNew}
          />
        )}
        {!utilitiesInHeader && !hideUtilities ? (
          <div className="kova-workspace-utilities flex shrink-0 justify-end">{utilities}</div>
        ) : null}
        {!sidebarOpen && !user && (
          <button
            type="button"
            onClick={(event) => {
              sidebarKeyboardFocusRef.current = event.detail === 0;
              setSidebarOpen(true);
            }}
            className="kova-floating-sidebar-trigger kova-sidebar-toggle hidden lg:flex fixed top-3 left-3 z-30 h-10 w-10 rounded-xl transition items-center justify-center"
            aria-label="Open sidebar"
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
        <WorkspacePageUtilities.Provider value={utilitiesInHeader ? utilities : null}>
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </WorkspacePageUtilities.Provider>
      </div>

      <Suspense fallback={null}>
        {shareChatId !== null && (
          <ShareChatDialog
            open
            onOpenChange={(open) => {
              if (!open) setShareChatId(null);
            }}
            conversation={conversations.find((chat) => chat.id === shareChatId) ?? null}
          />
        )}
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
