import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { SignUpPrompt } from "@/components/SignUpPrompt";
import {
  PanelLeft,
  Search,
  MessageSquareDashed,
  Check,
  Share2,
  Download,
  Sliders,
  Lightbulb,
  ListChecks,
  PenLine,
  Sparkles,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";

import { ChatMessage } from "@/components/ChatMessage";
import {
  ChatInput,
  type ComposerToolId,
  type PendingAttachment,
  type RecentLibraryFile,
} from "@/components/ChatInput";
import { MobileTopBar } from "@/components/MobileTopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { ResponsiveModelSelector } from "@/components/ResponsiveModelSelector";
import { ChatBranchBar } from "@/components/ChatBranchBar";
import { useChatBranches } from "@/hooks/useChatBranches";
import { NovaLogo } from "@/components/NovaLogo";

import { type Settings, DEFAULT_SETTINGS } from "@/components/SettingsDialog";

const SettingsDialog = lazy(() =>
  import("@/components/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const OnboardingDialog = lazy(() =>
  import("@/components/OnboardingDialog").then((m) => ({ default: m.OnboardingDialog })),
);
const LimitReachedDialog = lazy(() =>
  import("@/components/LimitReachedDialog").then((m) => ({ default: m.LimitReachedDialog })),
);
const ShareChatDialog = lazy(() =>
  import("@/components/ShareChatDialog").then((m) => ({ default: m.ShareChatDialog })),
);
const ChatWorkspaceDialog = lazy(() =>
  import("@/components/ChatWorkspaceDialog").then((m) => ({ default: m.ChatWorkspaceDialog })),
);
const TemporaryChatStartDialog = lazy(() =>
  import("@/components/TemporaryChatStartDialog").then((m) => ({
    default: m.TemporaryChatStartDialog,
  })),
);
import { applyThemeMode, loadThemeMode } from "@/lib/theme";
import { loadSettings, settingsKey } from "@/lib/use-nova-settings";
import {
  blockMemoryWrites,
  configureMemoryWrites,
  enqueueMemoryWrite,
  isMemoryWriteBlocked,
  memoryWriteBlockStorageKey,
} from "@/lib/memory-write-coordinator.mjs";

import { getUsage } from "@/lib/limits";

import {
  useUser,
  useClerkSafe,
  SignInButton,
  SignUpButton,
  UserButton,
  clerkEnabled,
} from "@/components/auth/ClerkSafe";
import { type ModeId } from "@/lib/modes";
import {
  type Conversation,
  type Message,
  type TemporaryChatContext,
  deriveTitle,
  branchConversation,
  chatStoragePrincipal,
  clearDraft,
  clearPendingActive,
  draftStorageKey,
  loadDraft,
  loadConversations,
  loadArchivedConversations,
  loadPendingActive,
  newId,
  saveConversations,
  saveDraft,
  archiveConversation,
  removeArchivedConversation,
} from "@/lib/chat-store";
import { toast } from "sonner";
import { loadPersonality, personalityToInstruction } from "@/components/PersonalitySliders";
import { useTier } from "@/hooks/useTier";
import {
  consumePrincipalHandoff,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export const Route = createFileRoute("/")({
  component: KovaGPT,
  head: () => ({
    meta: [
      { title: "KovaGPT" },
      {
        name: "description",
        content:
          "KovaGPT - a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { property: "og:title", content: "KovaGPT" },
      {
        property: "og:description",
        content:
          "KovaGPT - a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { property: "og:url", content: "https://kovagpt.com/" },
      { property: "og:image", content: "https://kovagpt.com/og/home.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KovaGPT" },
      {
        name: "twitter:description",
        content:
          "KovaGPT - a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { name: "twitter:image", content: "https://kovagpt.com/og/home.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/" }],
  }),
});

const EMPTY_CONVERSATIONS: Conversation[] = [];

const EMPTY_STATE_STARTERS = [
  {
    label: "Brainstorm ideas",
    prompt: "Help me brainstorm thoughtful ideas for ",
    icon: Lightbulb,
  },
  {
    label: "Make a plan",
    prompt: "Create a practical step-by-step plan for ",
    icon: ListChecks,
  },
  {
    label: "Improve writing",
    prompt: "Help me rewrite this clearly while preserving the meaning:\n\n",
    icon: PenLine,
  },
  {
    label: "Explore a topic",
    prompt: "Explain this topic clearly, including the most important context: ",
    icon: Sparkles,
  },
] as const;

// Some environments report non-canonical locales (e.g. "en-US@posix"), which the
// API rejects. Fall back to a canonical tag instead of failing the request.
function safeLocale(): string {
  const raw = typeof navigator !== "undefined" ? navigator.language : "en-US";
  try {
    return Intl.getCanonicalLocales(raw)[0] ?? "en-US";
  } catch {
    return "en-US";
  }
}

function KovaGPT() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { tier } = useTier();
  const { openSignUp } = useClerkSafe();
  const userKey = user?.id ?? null;
  const storagePrincipal = chatStoragePrincipal(userKey);
  const storagePrincipalRef = useRef(storagePrincipal);
  storagePrincipalRef.current = storagePrincipal;
  const storageGenerationRef = useRef(0);
  const [conversationState, setConversationState] = useState<{
    principal: string | null;
    items: Conversation[];
  }>({ principal: null, items: [] });
  const principalReady = isLoaded && conversationState.principal === storagePrincipal;
  const conversations = principalReady ? conversationState.items : EMPTY_CONVERSATIONS;
  const setConversations = useCallback(
    (next: SetStateAction<Conversation[]>) => {
      setConversationState((previous) => {
        // Async work started by a prior account must never write into the
        // currently active account's browser namespace.
        if (!isLoaded || storagePrincipalRef.current !== storagePrincipal) return previous;
        const current = previous.principal === storagePrincipal ? previous.items : [];
        const items = typeof next === "function" ? next(current) : next;
        return { principal: storagePrincipal, items };
      });
    },
    [isLoaded, storagePrincipal],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mode, setMode] = useState<ModeId>("instant");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamAnnouncement, setStreamAnnouncement] = useState("");
  const [tempChat, setTempChat] = useState(false);
  const [tempChatContext, setTempChatContext] = useState<TemporaryChatContext>("clean");
  const [tempChatStartOpen, setTempChatStartOpen] = useState(false);
  const [tempChatConfirmed, setTempChatConfirmed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const commandReturnFocusRef = useRef<HTMLElement | null>(null);
  const [commandQuery, setCommandQuery] = useState("");
  const [workspaceItems, setWorkspaceItems] = useState<
    import("@/lib/workspace.functions").RecentItem[]
  >([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<"loading" | "ready" | "error">("ready");
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);
  const retryWorkspaceSearch = useCallback(() => {
    setWorkspaceReloadKey((current) => current + 1);
  }, []);
  const [selectedTool, setSelectedTool] = useState<ComposerToolId | null>(null);
  const [recentLibraryFiles, setRecentLibraryFiles] = useState<RecentLibraryFile[]>([]);
  const [recentLibraryLoading, setRecentLibraryLoading] = useState(false);
  const [recentLibraryError, setRecentLibraryError] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<{
    conversationId: string;
    messageId: string;
  } | null>(null);

  // Start closed to avoid a flash-of-open sidebar on narrow viewports during
  // SSR/hydration. On desktop we honor the persisted user preference so the
  // sidebar remembers its collapsed state across reloads.
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

  const loadRecentLibraryFiles = useCallback(async () => {
    if (!isLoaded) return;
    const generation = storageGenerationRef.current;
    const requestPrincipal = storagePrincipal;
    const isCurrent = () =>
      generation === storageGenerationRef.current &&
      requestPrincipal === storagePrincipalRef.current;
    setRecentLibraryLoading(true);
    setRecentLibraryError(null);
    try {
      const { listMyLibrary } = await import("@/lib/library.functions");
      const rows = isSignedIn ? await listMyLibrary() : [];
      if (!isCurrent()) return;
      setRecentLibraryFiles(
        rows
          .filter((item) => item.file_name || item.content_text || item.file_type)
          .slice(0, 12)
          .map((item) => ({
            id: item.id,
            title: item.title,
            fileName: item.file_name || item.title,
            fileType: item.file_type || item.item_type,
            fileSize: item.file_size,
            createdAt: item.created_at,
            projectName: item.source === "chat" ? "Saved from chat" : null,
          })),
      );
    } catch (error) {
      if (!isCurrent()) return;
      console.warn("[recentLibraryFiles]", error);
      setRecentLibraryError("Recent Library files are unavailable.");
    } finally {
      if (isCurrent()) setRecentLibraryLoading(false);
    }
  }, [isLoaded, isSignedIn, storagePrincipal]);

  useEffect(() => {
    void loadRecentLibraryFiles();
  }, [loadRecentLibraryFiles]);

  // Draft persistence: keep an unsent message per conversation so users don't
  // lose typing when switching chats.
  const lastLoadedDraftRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tempChat) {
      lastLoadedDraftRef.current = null;
      setInput("");
      return;
    }
    if (!principalReady) return;
    const key = draftStorageKey(userKey, activeId);
    if (lastLoadedDraftRef.current === key) return;
    lastLoadedDraftRef.current = key;
    try {
      setInput(loadDraft(userKey, activeId));
    } catch {
      setInput("");
    }
  }, [activeId, principalReady, tempChat, userKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tempChat || !principalReady) return;
    const key = draftStorageKey(userKey, activeId);
    if (lastLoadedDraftRef.current !== key) return;
    try {
      saveDraft(userKey, activeId, input);
    } catch {
      /* ignore */
    }
  }, [input, activeId, principalReady, tempChat, userKey]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const openSettings = useCallback((tab?: string) => {
    settingsReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);
  // Listen for global open-settings events (fired from UserButton profile click).
  useEffect(() => {
    const h = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      openSettings(tab);
    };
    window.addEventListener("kova-open-settings", h);
    return () => window.removeEventListener("kova-open-settings", h);
  }, [openSettings]);

  // Family Sharing: if the URL carries ?family_invite=TOKEN, redeem it once
  // the user is signed in and drop the param.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const token = url.searchParams.get("family_invite");
    if (!token) return;
    if (!isSignedIn) {
      toast.message("Sign in to accept the family invite");
      openSignUp();
      return;
    }
    (async () => {
      try {
        const { acceptFamilyInvite } = await import("@/lib/family.functions");
        await acceptFamilyInvite({ data: { token } });
        toast.success("Joined family plan.");
      } catch (e) {
        toast.error((e as Error).message || "Could not accept invite.");
      } finally {
        url.searchParams.delete("family_invite");
        window.history.replaceState({}, "", url.toString());
      }
    })();
  }, [isSignedIn, openSignUp]);
  const navigate = useNavigate();
  const openHelp = useCallback(() => {
    navigate({ to: "/help" as never });
  }, [navigate]);
  const [shareChatId, setShareChatId] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [chatRulesActive, setChatRulesActive] = useState(false);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsPrincipal, setSettingsPrincipal] = useState<string | null>(null);
  const settingsReady = isLoaded && settingsPrincipal === storagePrincipal;
  const [signupPromptOpen, setSignupPromptOpen] = useState(false);
  const [signupPromptShown, setSignupPromptShown] = useState(false);
  const [limitDialog, setLimitDialog] = useState<{
    open: boolean;
    kind: "image" | "chat" | "upload";
    message?: string;
  }>({ open: false, kind: "image" });
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Load (or reload) settings whenever the signed-in user changes so each
  // account gets its own personalization, behavior, appearance, etc.
  useEffect(() => {
    if (!isLoaded) {
      storageGenerationRef.current += 1;
      setConversationState({ principal: null, items: [] });
      setSettingsPrincipal(null);
      setTempChat(false);
      setTempChatContext("clean");
      setTempChatStartOpen(false);
      setTempChatConfirmed(false);
      return;
    }
    storageGenerationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setIsStreaming(false);
    setTempChat(false);
    setTempChatContext("clean");
    setTempChatStartOpen(false);
    setTempChatConfirmed(false);
    setActiveId(null);
    setInput("");
    setAttachments([]);
    setSelectedTool(null);
    setCommandOpen(false);
    setCommandQuery("");
    setEditingMessage(null);
    setShareChatId(null);
    setSettingsOpen(false);
    setRecentLibraryFiles([]);
    setRecentLibraryLoading(false);
    setRecentLibraryError(null);
    lastLoadedDraftRef.current = null;

    const loaded = loadSettings(userKey, { migrateLegacyGuest: userKey === null });
    setSettings(loaded);
    setSettingsPrincipal(storagePrincipal);
    applyThemeMode(userKey === null ? loadThemeMode() : (loaded.mode ?? "system"));
    // Keep each signed-in account and the guest workspace in a separate
    // browser namespace. Switching accounts must render empty until the new
    // principal's data has loaded.
    const loadedConvs = loadConversations(userKey);
    setConversationState({ principal: storagePrincipal, items: loadedConvs });
    try {
      const pending = loadPendingActive(userKey);
      if (pending && loadedConvs.some((c) => c.id === pending)) {
        setActiveId(pending);
      }
      clearPendingActive(userKey);
    } catch {
      /* ignore */
    }
  }, [isLoaded, userKey, isSignedIn, storagePrincipal]);

  // Re-apply theme only after this principal's settings are ready.
  // Guest mode is canonical in kova-theme-mode and must not be
  // overwritten by the default settings state during hydration.
  useEffect(() => {
    if (!settingsReady) return;
    applyThemeMode(userKey === null ? loadThemeMode() : (settings.mode ?? "system"));
  }, [settings.mode, settingsReady, userKey]);

  // Debounced persistence - avoid JSON.stringify on every keystroke / stream token,
  // which was the main source of typing/streaming lag.
  useEffect(() => {
    if (!settingsReady || typeof window === "undefined") return;
    const generation = storageGenerationRef.current;
    const t = setTimeout(() => {
      if (generation !== storageGenerationRef.current) return;
      safeBrowserStorage("localStorage")?.setItem(settingsKey(userKey), JSON.stringify(settings));
    }, 400);
    return () => clearTimeout(t);
  }, [settings, settingsReady, userKey]);

  useEffect(() => {
    if (!principalReady) return;
    const generation = storageGenerationRef.current;
    const t = setTimeout(() => {
      if (generation !== storageGenerationRef.current) return;
      saveConversations(
        userKey,
        conversations.filter((c) => !c.temporary),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [conversations, principalReady, userKey]);

  useEffect(() => {
    if (!isLoaded) return;
    const handlePrincipalReset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      storageGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      lastLoadedDraftRef.current = null;
      setConversationState({ principal: null, items: [] });
      setSettings(DEFAULT_SETTINGS);
      setSettingsPrincipal(null);
      setActiveId(null);
      setInput("");
      setAttachments([]);
      setSelectedTool(null);
      setEditingMessage(null);
      setShareChatId(null);
      setCommandOpen(false);
      setCommandQuery("");
      setIsStreaming(false);
      setTempChat(false);
      setTempChatContext("clean");
      setTempChatStartOpen(false);
      setTempChatConfirmed(false);
      setRecentLibraryFiles([]);
      setRecentLibraryLoading(false);
      setRecentLibraryError(null);
      configureMemoryWrites({ principal: null, enabled: false });
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, handlePrincipalReset);
    return () =>
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, handlePrincipalReset);
  }, [isLoaded, userKey]);

  useEffect(() => {
    if (!principalReady) return;
    let rejectedHandoff = false;
    const storage = safeBrowserStorage("sessionStorage");
    const candidates: Array<{ createdAt: number; apply: () => void }> = [];
    const consume = <T,>(baseKey: string, prepare: (value: T) => () => void) => {
      const result = consumePrincipalHandoff<T>(storage, baseKey, userKey);
      if (!result.ok) {
        if (result.reason !== "missing") rejectedHandoff = true;
        return;
      }
      try {
        candidates.push({ createdAt: result.createdAt, apply: prepare(result.value) });
      } catch {
        rejectedHandoff = true;
      }
    };

    // Consume every registered home handoff before choosing one. This makes
    // the newest valid handoff deterministic and prevents lower-priority
    // leftovers from replaying on the next render.
    consume<{
      name: string;
      items: { title: string; content: string }[];
    }>("kova-active-context-pack", (pack) => {
      if (
        typeof pack?.name !== "string" ||
        !Array.isArray(pack.items) ||
        !pack.items.every(
          (item) => typeof item?.title === "string" && typeof item?.content === "string",
        )
      ) {
        throw new Error("invalid_context_pack_handoff");
      }
      const context = pack.items.map((item) => `## ${item.title}\n${item.content}`).join("\n\n");
      return () =>
        setInput(
          `Use this saved context pack, “${pack.name}”, to help with my request:\n\n${context}\n\nMy request: `,
        );
    });

    consume<{
      objective: string;
      context: string;
      steps: { text: string; done?: boolean; approval?: boolean }[];
    }>("kova-work-context", (task) => {
      if (
        typeof task?.objective !== "string" ||
        typeof task.context !== "string" ||
        !Array.isArray(task.steps) ||
        !task.steps.every((step) => typeof step?.text === "string")
      ) {
        throw new Error("invalid_work_handoff");
      }
      return () =>
        setInput(
          `Continue this work task without claiming background execution.\n\nObjective: ${task.objective}\nContext: ${task.context || "None provided"}\nPlan:\n${task.steps.map((step) => `- [${step.done ? "x" : " "}] ${step.text}`).join("\n")}\n\nNext, help me with: `,
        );
    });

    consume<string>("kova-app-chat-context", (appContext) => {
      if (typeof appContext !== "string") throw new Error("invalid_app_handoff");
      return () => setInput(appContext);
    });

    consume<{
      prompt: string;
      pack?: { name: string; items: { title: string; content: string }[] } | null;
    }>("kova-prompt-launch", (launch) => {
      if (
        typeof launch?.prompt !== "string" ||
        (launch.pack != null &&
          (typeof launch.pack.name !== "string" ||
            !Array.isArray(launch.pack.items) ||
            !launch.pack.items.every(
              (item) => typeof item?.title === "string" && typeof item?.content === "string",
            )))
      ) {
        throw new Error("invalid_prompt_handoff");
      }
      const context = launch.pack
        ? `\n\nContext pack “${launch.pack.name}”:\n${launch.pack.items.map((item) => `## ${item.title}\n${item.content}`).join("\n\n")}`
        : "";
      return () => setInput(`${launch.prompt}${context}`);
    });

    consume<string>("kova-research-launch", (research) => {
      if (typeof research !== "string") throw new Error("invalid_research_handoff");
      return () => {
        setInput(research);
        setSelectedTool("deep_research");
      };
    });

    const newest = candidates.sort((left, right) => right.createdAt - left.createdAt)[0];
    if (newest) newest.apply();
    if (rejectedHandoff) toast.error("Saved workspace context could not be attached");
  }, [principalReady, userKey]);

  // Memory is retained across sign-in/sign-out transitions per user request.

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const activeTemporary = active ? Boolean(active.temporary) : null;
  const activeTemporaryContext = active?.temporary ? (active.temporaryContext ?? "clean") : null;
  const historyConversations = useMemo(
    () => conversations.filter((conversation) => !conversation.temporary),
    [conversations],
  );
  const archivedConversations =
    typeof window === "undefined" ? [] : loadArchivedConversations(userKey);

  useEffect(() => {
    if (activeTemporary !== null) setTempChat(activeTemporary);
    if (activeTemporaryContext !== null) setTempChatContext(activeTemporaryContext);
  }, [activeTemporary, activeTemporaryContext]);

  // Branch rows are keyed by the family's root conversation, so a branched chat
  // and its original share one durable branch tree.
  const branchRootId = active ? (active.branchRootId ?? active.id) : null;
  const branchState = useChatBranches(branchRootId, Boolean(active?.temporary));

  /**
   * Switching a branch must switch what the person is actually reading. If the
   * mapped conversation is not on this device we say so instead of pretending.
   */
  const activateBranch = useCallback(
    async (branchId: string) => {
      const target = branchState.branches.find((branch) => branch.id === branchId);
      if (!target) throw new Error("That branch no longer exists.");
      const exists = conversations.some(
        (conversation) => conversation.id === target.conversationId,
      );
      if (!exists) {
        throw new Error("That branch's conversation isn't available on this device.");
      }
      await branchState.activate(branchId);
      setActiveId(target.conversationId);
      return target;
    },
    [branchState, conversations, setActiveId],
  );

  /**
   * Applies an accepted inline edit or a restored version to a message. The
   * original text is kept in the durable version chain, so nothing is lost.
   */
  const replaceMessageContent = useCallback(
    (conversationId: string, messageId: string, nextContent: string) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id !== conversationId
            ? conversation
            : {
                ...conversation,
                updatedAt: Date.now(),
                messages: conversation.messages.map((message) =>
                  message.id === messageId ? { ...message, content: nextContent } : message,
                ),
              },
        ),
      );
    },
    [setConversations],
  );

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    },
    [],
  );

  const greeting = "What can I help with?";

  const updateNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 120;
    nearBottomRef.current = near;
    setShowJumpToLatest(!near && Boolean(active?.messages.length));
  }, [active?.messages.length]);

  const activeMessageCount = active?.messages.length;
  const latestMessageContent = active?.messages.at(-1)?.content;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? "auto" : "smooth" });
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [activeMessageCount, latestMessageContent, isStreaming]);

  useEffect(() => {
    if (!settingsReady) return;
    if (userKey && !settings.rememberAcross) blockMemoryWrites(userKey);
    configureMemoryWrites({
      principal: userKey,
      enabled: Boolean(isSignedIn && settings.rememberAcross && tier !== "free"),
    });
  }, [isSignedIn, settings.rememberAcross, settingsReady, tier, userKey]);

  useEffect(() => {
    if (!settingsReady || !userKey) return;
    const blockKey = memoryWriteBlockStorageKey(userKey);
    const applySharedBlock = () => {
      if (!isMemoryWriteBlocked(userKey)) return;
      setSettings((previous) =>
        previous.rememberAcross ? { ...previous, rememberAcross: false } : previous,
      );
    };
    applySharedBlock();
    const onStorage = (event: StorageEvent) => {
      if (event.key === blockKey && event.newValue === "1") applySharedBlock();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [settingsReady, userKey]);

  // Cross-chat memory is opt-in in each browser. Only eligible paid accounts
  // may enqueue bounded, non-temporary conversation windows for summarization.
  useEffect(() => {
    if (
      !settingsReady ||
      !isSignedIn ||
      !userKey ||
      isStreaming ||
      !settings.rememberAcross ||
      tier === "free"
    )
      return;
    if (!active || active.temporary) return;
    const memoryStartIndex = Math.max(0, active.memoryStartIndex ?? 0);
    const memoryMessages = active.messages.slice(memoryStartIndex);
    if (memoryMessages.length < 4) return;
    const memoryTitle = deriveTitle(
      memoryMessages.find((message) => message.role === "user")?.content ?? "Saved chat",
    );
    const handle = setTimeout(() => {
      const payload = {
        chatId: active.id,
        title: memoryTitle.slice(0, 120),
        memoryEnabled: true,
        temporary: false,
        // The memory endpoint accepts only the bounded post-privacy window.
        messages: memoryMessages
          .slice(-30)
          .map((message) => ({ role: message.role, content: message.content.slice(0, 2000) })),
      };
      void enqueueMemoryWrite({
        principal: userKey,
        run: async () => {
          const response = await authFetch("/api/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            throw new Error("memory_write_failed");
          }
        },
      }).catch(() => {
        /* Saved memory is best-effort; foreground chat must remain usable. */
      });
    }, 4000);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active?.id,
    active?.messages.length,
    active?.memoryStartIndex,
    isStreaming,
    isSignedIn,
    settings.rememberAcross,
    settingsReady,
    tier,
    userKey,
  ]);

  // Invite guests only after three successful prompt attempts in this mounted tab.
  const guestPromptTurnsRef = useRef(0);
  const guestPromptTurns = guestPromptTurnsRef.current;
  useEffect(() => {
    if (!isLoaded) return;
    if (signupPromptShown) return;
    if (clerkEnabled && isSignedIn) return;
    if (guestPromptTurns >= 3 && !isStreaming) {
      setSignupPromptOpen(true);
      setSignupPromptShown(true);
    }
  }, [guestPromptTurns, isLoaded, isSignedIn, isStreaming, signupPromptShown]);

  const newChat = useCallback(() => {
    setConversations((previous) => previous.filter((conversation) => !conversation.temporary));
    setActiveId(null);
    setInput("");
    setAttachments([]);
    setEditingMessage(null);
  }, [setConversations]);

  const startTemporaryChat = useCallback(
    (context: TemporaryChatContext) => {
      try {
        clearDraft(userKey, activeId);
      } catch {
        /* Storage may be unavailable; temporary input still stays in memory only. */
      }
      // Persisted and temporary turns must never share one conversation.
      newChat();
      setTempChatContext(context);
      setTempChat(true);
      setTempChatStartOpen(false);
      setTempChatConfirmed(true);
      window.setTimeout(() => setTempChatConfirmed(false), 1400);
      toast.success("Temporary chat enabled", {
        description:
          context === "personalized"
            ? "This chat won't appear in history or create new saved memories. Existing enabled personalization and connected apps may be used."
            : "This chat won't appear in history or be used for cross-chat memory. It also will not use saved profile details, custom instructions, or personality settings. Connected apps are off too.",
      });
    },
    [activeId, newChat, userKey],
  );

  const setTemporaryChatEnabled = useCallback(
    (enabled: boolean) => {
      if (enabled === tempChat) return;
      if (enabled) {
        setTempChatStartOpen(true);
        return;
      }

      // Persisted and temporary turns must never share one conversation.
      newChat();
      setTempChat(enabled);
      setTempChatContext("clean");
      toast.message("Temporary chat disabled", {
        description: settings.rememberAcross
          ? "New chats will be saved on this device and may use saved memory."
          : "New chats will be saved on this device. Saved memory remains off.",
      });
    },
    [newChat, settings.rememberAcross, tempChat],
  );

  const saveTemporaryChat = useCallback(() => {
    if (!active?.temporary || isStreaming) return;
    // A scheduled retry still carries the immutable temporary-context closure.
    // Cancel it before conversion so no old temporary turn can land past the
    // new memory boundary and later be persisted as regular-chat memory.
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const convertedAt = active.messages.length;
    const converted: Conversation = {
      ...active,
      temporary: false,
      temporaryContext: undefined,
      memoryStartIndex: convertedAt,
      updatedAt: Date.now(),
    };
    const nextConversations = conversations
      .map((conversation) => (conversation.id === active.id ? converted : conversation))
      .filter((conversation) => !conversation.temporary);
    if (!saveConversations(userKey, nextConversations)) {
      toast.error("This chat could not be saved", {
        description: "Browser storage is unavailable or full. Free space and try again.",
      });
      return;
    }
    setConversations(nextConversations);
    setTempChat(false);
    setTempChatContext("clean");
    toast.success("Chat saved to history", {
      description:
        "Future messages continue as a regular chat. Earlier temporary turns stay out of saved memory.",
    });
  }, [active, conversations, isStreaming, setConversations, userKey]);

  const openCommandPalette = useCallback(() => {
    commandReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCommandOpen(true);
  }, []);
  useEffect(() => {
    if (!commandOpen || !isSignedIn) {
      setWorkspaceItems([]);
      setWorkspaceStatus("ready");
      return;
    }
    let cancelled = false;
    setWorkspaceStatus("loading");
    void import("@/lib/workspace.functions")
      .then(({ listWorkspaceRecents }) => listWorkspaceRecents())
      .then((items) => {
        if (cancelled) return;
        setWorkspaceItems(items);
        setWorkspaceStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaceItems([]);
        setWorkspaceStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [commandOpen, isSignedIn, userKey, workspaceReloadKey]);

  useEffect(() => {
    const reloadImportedChats = () => {
      setConversations(loadConversations(userKey));
      setActiveId(null);
      setEditingMessage(null);
    };
    window.addEventListener("kova:conversations-imported", reloadImportedChats);
    return () => window.removeEventListener("kova:conversations-imported", reloadImportedChats);
  }, [setConversations, userKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        if (commandOpen) setCommandOpen(false);
        else openCommandPalette();
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "o") {
        event.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandOpen, newChat, openCommandPalette]);

  const deleteChat = useCallback(
    (id: string) => {
      const deleted = conversations.find((conversation) => conversation.id === id);
      setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
      if (activeId === id) setActiveId(null);
      if (deleted) {
        toast.success("Chat deleted", {
          action: {
            label: "Undo",
            onClick: () => {
              setConversations((current) => [
                deleted!,
                ...current.filter((conversation) => conversation.id !== deleted!.id),
              ]);
              setActiveId(deleted!.id);
            },
          },
        });
      }
    },
    [activeId, conversations, setConversations],
  );

  const autoTitle = useCallback(
    async (convId: string, msgs: Message[]) => {
      try {
        const resp = await authFetch("/api/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs.slice(0, 4).map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        const { title } = await resp.json();
        if (title) {
          setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)));
        }
      } catch {
        /* ignore */
      }
    },
    [setConversations],
  );

  const send = useCallback(
    async (
      text: string,
      atts: PendingAttachment[],
      _retryAttempt = 0,
      retryConversationId?: string,
      retryHistory?: Message[],
    ) => {
      const MAX_AUTO_RETRIES = 2;
      const trimmed = text.trim();
      if (!principalReady || (!trimmed && atts.length === 0) || inFlightRef.current) return;
      const requestGeneration = storageGenerationRef.current;
      const requestPrincipal = storagePrincipal;
      const isCurrentRequest = () =>
        requestGeneration === storageGenerationRef.current &&
        requestPrincipal === storagePrincipalRef.current;

      if (_retryAttempt === 0 && retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (_retryAttempt === 0 && !isSignedIn) guestPromptTurnsRef.current += 1;

      const nextConvId = retryConversationId ?? activeId ?? newId();
      const existingConversation = nextConvId
        ? conversations.find((conversation) => conversation.id === nextConvId)
        : undefined;
      const isNewConversation = !retryConversationId && !existingConversation;

      const activeTool = selectedTool;

      const userMsg: Message = {
        id: newId(),
        role: "user",
        content: trimmed,
        attachments: atts.map((a) =>
          a.kind === "library_file"
            ? {
                kind: "library_file" as const,
                libraryItemId: a.libraryItemId || "",
                name: a.name,
                fileType: a.fileType ?? null,
                size: a.size ?? null,
                sourceProject: a.sourceProject ?? null,
              }
            : a.kind === "text_file"
              ? {
                  kind: "text_file" as const,
                  name: a.name,
                  content: a.textContent ?? "",
                  fileType: a.fileType ?? null,
                  size: a.size ?? null,
                }
              : { kind: "image" as const, dataUrl: a.dataUrl },
        ),
      };
      const assistantMsg: Message = { id: newId(), role: "assistant", content: "" };

      const editIndex =
        existingConversation && editingMessage?.conversationId === existingConversation.id
          ? existingConversation.messages.findIndex(
              (message) => message.id === editingMessage.messageId,
            )
          : -1;
      const priorMessages =
        retryHistory ??
        (existingConversation
          ? editIndex >= 0
            ? existingConversation.messages.slice(0, editIndex)
            : existingConversation.messages.slice()
          : []);

      setConversations((prev) => {
        if (isNewConversation) {
          const c: Conversation = {
            id: nextConvId,
            title: "New chat",
            messages: [userMsg, assistantMsg],
            mode,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            temporary: tempChat,
            temporaryContext: tempChat ? tempChatContext : undefined,
          };
          return [c, ...prev.filter((conversation) => conversation.id !== nextConvId)];
        }

        return prev.map((c) =>
          c.id === nextConvId
            ? {
                ...c,
                messages: [...priorMessages, userMsg, assistantMsg],
                memoryStartIndex:
                  typeof c.memoryStartIndex === "number"
                    ? Math.min(Math.max(0, c.memoryStartIndex), priorMessages.length)
                    : undefined,
                updatedAt: Date.now(),
              }
            : c,
        );
      });
      setActiveId(nextConvId);
      setInput("");
      setAttachments([]);
      setEditingMessage(null);
      setIsStreaming(true);
      inFlightRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      let pendingContent = "";
      let assistantFrame: number | null = null;
      const flushAssistant = () => {
        assistantFrame = null;
        const chunk = pendingContent;
        pendingContent = "";
        if (!chunk) return;
        if (!isCurrentRequest()) return;
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== nextConvId) return c;
            const messages = c.messages.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: m.content + chunk, pendingImage: false }
                : m,
            );
            return { ...c, messages, updatedAt: Date.now() };
          }),
        );
      };
      const updateAssistant = (chunk: string) => {
        pendingContent += chunk;
        if (assistantFrame === null) assistantFrame = requestAnimationFrame(flushAssistant);
      };

      const markPendingImage = () => {
        if (!isCurrentRequest()) return;
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== nextConvId) return c;
            const messages = c.messages.map((m) =>
              m.id === assistantMsg.id ? { ...m, pendingImage: true } : m,
            );
            return { ...c, messages, updatedAt: Date.now() };
          }),
        );
      };

      let assembledReply = "";

      try {
        const payloadMessages = [
          ...priorMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          {
            role: userMsg.role,
            content: userMsg.content,
            attachments: userMsg.attachments,
          },
        ];

        const resp = await authFetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": userMsg.id,
          },
          body: JSON.stringify({
            messages: payloadMessages,
            mode: activeTool === "deep_research" ? "thinking" : mode,
            clientTool: activeTool,
            // Main-chat ids are device-local until a user-owned memory row
            // exists. Do not submit an unclaimable relationship for a
            // service-role Deep Research write.
            chatId: activeTool === "deep_research" ? undefined : nextConvId,
            temporary: tempChat,
            temporaryContext: tempChat ? tempChatContext : undefined,
            user:
              tempChat && tempChatContext === "clean"
                ? undefined
                : {
                    name: settings.displayName,
                    pronouns: settings.preferredPronouns,
                    email: settings.email,
                    phone: settings.phone,
                    address: [
                      settings.addressLine1,
                      settings.addressLine2,
                      settings.city,
                      settings.region,
                      settings.postalCode,
                      settings.country,
                    ]
                      .filter(Boolean)
                      .join(", "),
                    extraFacts: settings.extraFacts,
                    customInstructions: settings.customInstructions,
                    mood: settings.mood,
                    responseLength: settings.responseLength,
                    language: settings.language,
                    rememberAcross: settings.rememberAcross,
                    webSearch: settings.webSearch,
                  },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: safeLocale(),
            personality:
              tempChat && tempChatContext === "clean"
                ? undefined
                : personalityToInstruction(
                    loadPersonality(isLoaded ? userKey : undefined),
                    isLoaded ? userKey : undefined,
                  ) || undefined,
          }),
          signal: controller.signal,
        });
        if (!isCurrentRequest()) {
          void resp.body?.cancel().catch(() => undefined);
          return;
        }

        if (!resp.ok || !resp.body) {
          const errJson = await resp.json().catch(() => ({ error: "Request failed" }));
          const errMsg = errJson.error || `HTTP ${resp.status}`;
          const requestId = errJson.requestId || resp.headers.get("x-request-id") || undefined;
          const category = errJson.category || undefined;
          if (resp.status === 429 && /limit/i.test(errMsg)) {
            const kind: "image" | "chat" = /image/i.test(errMsg) ? "image" : "chat";
            setLimitDialog({ open: true, kind, message: errMsg });
          }
          const err = new Error(errMsg) as Error & {
            requestId?: string;
            category?: string;
            retryable?: boolean;
          };
          err.requestId = requestId;
          err.category = category;
          err.retryable = Boolean(errJson.retryable);
          throw err;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        while (!done) {
          const { done: d, value } = await reader.read();
          if (!isCurrentRequest()) {
            void reader.cancel().catch(() => undefined);
            return;
          }
          if (d) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line || line.startsWith(":")) continue;
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              done = true;
              break;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.kind === "image_pending") {
                markPendingImage();
              }
              if (delta?.kind === "activity" && delta?.label) {
                setConversations((prev) =>
                  prev.map((c) => {
                    if (c.id !== nextConvId) return c;
                    const msgs = c.messages.map((m) => {
                      if (m.id !== assistantMsg.id) return m;
                      const activity = {
                        tool: String(delta.tool ?? ""),
                        label: String(delta.label),
                        status: "done" as const,
                      };
                      const activities = (m.activities ?? []).some(
                        (item) => item.tool === activity.tool && item.label === activity.label,
                      )
                        ? m.activities
                        : [...(m.activities ?? []), activity];
                      return { ...m, activities };
                    });
                    return { ...c, messages: msgs };
                  }),
                );
              }
              if (delta?.kind === "tool_confirm" && delta?.action_id) {
                setConversations((prev) =>
                  prev.map((c) => {
                    if (c.id !== nextConvId) return c;
                    const msgs = c.messages.map((m) => {
                      if (m.id !== assistantMsg.id) return m;
                      const confirmation = {
                        actionId: String(delta.action_id),
                        tool: String(delta.tool ?? ""),
                        summary: String(delta.summary ?? "Confirm action"),
                        argsPreview: (delta.args_preview ?? {}) as Record<string, unknown>,
                        status: "pending" as const,
                      };
                      const pendingConfirms = (m.pendingConfirms ?? []).some(
                        (item) => item.actionId === confirmation.actionId,
                      )
                        ? m.pendingConfirms
                        : [...(m.pendingConfirms ?? []), confirmation];
                      return { ...m, pendingConfirms };
                    });
                    return { ...c, messages: msgs };
                  }),
                );
              }
              if (delta?.content) {
                assembledReply += delta.content;
                updateAssistant(delta.content);
              }
            } catch {
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }
        if (assistantFrame !== null) cancelAnimationFrame(assistantFrame);
        flushAssistant();
        if (assembledReply) setStreamAnnouncement("KovaGPT response complete");

        // Always re-summarize so the chat name in the sidebar reflects the conversation
        if (assembledReply) {
          const fullMsgs = [
            ...priorMessages,
            userMsg,
            { ...assistantMsg, content: assembledReply },
          ];
          if (isCurrentRequest()) autoTitle(nextConvId, fullMsgs);
        }
      } catch (e: unknown) {
        if (!isCurrentRequest()) return;
        if ((e as Error).name === "AbortError") {
          if (!assembledReply.trim()) {
            setConversations((prev) =>
              prev.map((conversation) =>
                conversation.id === nextConvId
                  ? {
                      ...conversation,
                      messages: conversation.messages.filter(
                        (message) => message.id !== assistantMsg.id,
                      ),
                    }
                  : conversation,
              ),
            );
          }
        } else {
          const err = e as Error & { requestId?: string; category?: string; retryable?: boolean };
          const raw = err.message || "Something went wrong";
          const isNetwork =
            /load failed|networkerror|failed to fetch|network request failed/i.test(raw) ||
            e instanceof TypeError;
          const category = err.category || (isNetwork ? "network_failure" : undefined);
          const retryableCategory =
            category === "model_timeout" ||
            category === "streaming_interruption" ||
            category === "network_failure" ||
            category === "model_provider_failure";
          // Respect the server's retryability signal. Configuration and
          // authentication failures cannot heal through repeated requests and
          // previously made the composer look stuck while it silently retried.
          const canAutoRetry =
            err.retryable !== false && retryableCategory && _retryAttempt < MAX_AUTO_RETRIES;

          if (canAutoRetry) {
            // Exponential backoff: 600ms, 1800ms. Strip the failed turn so
            // the retry can recreate it without duplicate messages.
            const backoffMs = 600 * Math.pow(3, _retryAttempt);
            setConversations((prev) =>
              prev.map((c) =>
                c.id === nextConvId
                  ? {
                      ...c,
                      messages: c.messages.filter(
                        (m) => m.id !== assistantMsg.id && m.id !== userMsg.id,
                      ),
                    }
                  : c,
              ),
            );
            setIsStreaming(false);
            abortRef.current = null;
            inFlightRef.current = false;
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              if (!isCurrentRequest() || activeIdRef.current !== nextConvId) return;
              void send(text, atts, _retryAttempt + 1, nextConvId, priorMessages);
            }, backoffMs);
            return;
          }

          const requestId = err.requestId;
          const friendly =
            category === "rate_limit"
              ? "You're going a bit fast — try again in a moment."
              : category === "quota_exceeded"
                ? "You've hit your plan's limit. Try again later or upgrade."
                : category === "model_timeout"
                  ? "The model took too long to respond. Tap retry."
                  : category === "model_provider_failure"
                    ? err.retryable === false
                      ? raw
                      : "KovaGPT is temporarily unavailable. Tap retry."
                    : category === "streaming_interruption"
                      ? "The connection dropped mid-response. Tap retry."
                      : isNetwork
                        ? "Connection lost while generating a response. Check your internet and tap retry."
                        : raw;
          const detail = requestId ? `${friendly} (ref: ${requestId})` : friendly;
          toast.error(friendly, {
            description: requestId ? `Reference ID: ${requestId}` : undefined,
            action: {
              label: "Retry",
              onClick: () => {
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === nextConvId
                      ? {
                          ...c,
                          messages: c.messages.filter(
                            (m) => m.id !== assistantMsg.id && m.id !== userMsg.id,
                          ),
                        }
                      : c,
                  ),
                );
                retryTimerRef.current = window.setTimeout(() => {
                  retryTimerRef.current = null;
                  if (!isCurrentRequest() || activeIdRef.current !== nextConvId) return;
                  void send(text, atts, 0, nextConvId, priorMessages);
                }, 100);
              },
            },
          });
          updateAssistant(`\n\n_${detail}_`);
        }
      } finally {
        if (isCurrentRequest()) {
          setIsStreaming(false);
          setSelectedTool(null);
          if (abortRef.current === controller) abortRef.current = null;
          inFlightRef.current = false;
        }
      }
    },
    [
      activeId,
      conversations,
      mode,
      autoTitle,
      settings,
      selectedTool,
      tempChat,
      tempChatContext,
      editingMessage,
      principalReady,
      setConversations,
      storagePrincipal,
      isLoaded,
      isSignedIn,
      userKey,
    ],
  );

  const stop = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setIsStreaming(false);
  }, []);

  // Image generation removed; can be reintroduced when user explicitly asks.

  return (
    <div
      className="flex h-screen w-full overflow-hidden bg-[var(--surface-workspace)] text-foreground"
      style={{ height: "100dvh" }}
    >
      <p className="sr-only" aria-live="polite">
        {streamAnnouncement}
      </p>
      {/* Mobile edge-swipe zone: swipe right from the left edge to open the sidebar. */}
      {!sidebarOpen && (
        <div
          aria-hidden="true"
          className="lg:hidden fixed left-0 top-0 bottom-0 w-4 z-20"
          onTouchStart={(e) => {
            const startX = e.touches[0].clientX;
            const startY = e.touches[0].clientY;
            if (startX > 24) return;
            let opened = false;
            const onMove = (ev: TouchEvent) => {
              const dx = ev.touches[0].clientX - startX;
              const dy = Math.abs(ev.touches[0].clientY - startY);
              if (!opened && dx > 40 && dy < 40) {
                opened = true;
                setSidebarOpen(true);
                cleanup();
              }
            };
            const cleanup = () => {
              window.removeEventListener("touchmove", onMove);
              window.removeEventListener("touchend", cleanup);
              window.removeEventListener("touchcancel", cleanup);
            };
            window.addEventListener("touchmove", onMove, { passive: true });
            window.addEventListener("touchend", cleanup);
            window.addEventListener("touchcancel", cleanup);
          }}
        />
      )}

      <Sidebar
        conversations={historyConversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newChat}
        onDelete={deleteChat}
        onRename={(id, title) =>
          setConversations((previous) =>
            previous.map((conversation) =>
              conversation.id === id
                ? { ...conversation, title, updatedAt: Date.now() }
                : conversation,
            ),
          )
        }
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={openSettings}
        onOpenHelp={openHelp}
        onShare={(id) => {
          if (!isSignedIn) {
            toast.message("Sign in to share chats");
            openSignUp();
            return;
          }
          setShareChatId(id);
        }}
        onDuplicate={(id) => {
          setConversations((prev) => {
            const src = prev.find((c) => c.id === id);
            if (!src) return prev;
            const copy: Conversation = {
              ...src,
              id: newId(),
              title: `${src.title} (copy)`,
              messages: src.messages.map((m) => ({ ...m, id: newId() })),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            return [copy, ...prev];
          });
          toast.success("Chat duplicated");
        }}
        onArchive={(id) => {
          const archived = conversations.find((conversation) => conversation.id === id);
          setConversations((prev) => {
            if (archived) archiveConversation(userKey, archived);
            return prev.filter((c) => c.id !== id);
          });
          if (activeId === id) setActiveId(null);
          toast.success("Chat archived", {
            action: archived
              ? {
                  label: "Undo",
                  onClick: () => {
                    removeArchivedConversation(userKey, archived!.id);
                    setConversations((current) => [
                      archived!,
                      ...current.filter((conversation) => conversation.id !== archived!.id),
                    ]);
                    setActiveId(archived!.id);
                  },
                }
              : undefined,
          });
        }}
        onTogglePin={(id) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === id
                ? { ...c, pinned: !c.pinned, pinnedAt: !c.pinned ? Date.now() : undefined }
                : c,
            ),
          );
        }}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="kova-chat-main flex min-w-0 flex-1 flex-col bg-background"
        data-sidebar={sidebarOpen ? "open" : "closed"}
      >
        <MobileTopBar
          onOpenSidebar={() => setSidebarOpen(true)}
          onNewChat={newChat}
          title={active?.title}
          mode={mode}
          onModeChange={setMode}
          userTier={tier}
          temporaryChat={tempChat}
          onTemporaryChatChange={setTemporaryChatEnabled}
          onOpenChatSettings={active ? () => setWorkspaceOpen(true) : undefined}
          chatRulesActive={chatRulesActive}
        />
        <header className="kova-topbar kova-desktop-topbar relative hidden h-[56px] items-center gap-1 px-4 lg:flex">
          <div
            hidden={sidebarOpen || Boolean(isSignedIn)}
            className="flex items-center gap-1 mr-2 shrink-0"
          >
            <button
              onClick={() => {
                setSidebarOpen(true);
                window.requestAnimationFrame(() => {
                  document
                    .querySelector<HTMLElement>('[aria-label="Collapse sidebar"]')
                    ?.focus({ preventScroll: true });
                });
              }}
              className="kova-topbar-button shrink-0 rounded-xl p-2 hover:bg-accent transition"
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
            <button
              onClick={openCommandPalette}
              className="kova-topbar-button shrink-0 rounded-xl p-2 hover:bg-accent transition"
              aria-label="Search chats"
              title="Search chats"
            >
              <Search className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center min-w-0 flex-1 relative">
            <ResponsiveModelSelector
              mode={mode}
              onChange={setMode}
              userTier={tier}
              placement="topbar"
            />
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {active && (
              <>
                {isSignedIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      const transcript = active.messages
                        .map((m) => `${m.role === "user" ? "You" : "KovaGPT"}: ${m.content}`)
                        .join("\n\n");
                      const blob = new Blob([transcript], { type: "text/markdown;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${active.title || "chat"}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="hidden xl:inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground hover:bg-accent"
                    aria-label="Export chat"
                    title="Export chat"
                  >
                    <Download className="h-4 w-4" />
                    <span>Export</span>
                  </button>
                ) : null}
                {isSignedIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSignedIn) {
                        toast.message("Sign in to share chats");
                        openSignUp();
                        return;
                      }
                      setShareChatId(active.id);
                    }}
                    className="hidden lg:inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-accent"
                    aria-label="Share chat"
                    title="Share chat"
                  >
                    <Share2 className="h-4 w-4" />
                    <span>Share</span>
                  </button>
                ) : null}
              </>
            )}
            {active && (
              <button
                type="button"
                onClick={() => setWorkspaceOpen(true)}
                className="hidden lg:inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground hover:bg-accent"
                aria-label="Chat settings: rules and pinned files"
                title="Chat settings"
              >
                <Sliders className="h-4 w-4" />
                <span>{chatRulesActive ? "Rules on" : "Chat settings"}</span>
              </button>
            )}
            {isLoaded && isSignedIn && (
              <button
                onClick={() => setTemporaryChatEnabled(!tempChat)}
                aria-label={tempChat ? "Turn off temporary chat" : "Start temporary chat"}
                aria-pressed={tempChat}
                title={tempChat ? "Temporary chat on" : "Start temporary chat"}
                className={`relative shrink-0 p-2 rounded-lg transition ${
                  tempChat ? "bg-primary/15 text-primary" : "hover:bg-accent text-foreground"
                }`}
              >
                <MessageSquareDashed className="w-5 h-5" />
                {tempChatConfirmed && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Check className="w-4 h-4 text-primary drop-shadow" />
                  </span>
                )}
              </button>
            )}
            {!isLoaded ? null : isSignedIn ? (
              <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="kova-auth-primary h-10 rounded-full bg-foreground px-4 text-sm font-semibold text-background hover:opacity-90 active:scale-[0.98] transition">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="kova-auth-secondary h-10 whitespace-nowrap rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-accent active:scale-[0.98] transition">
                    Sign up for free
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>

        {tempChat && (
          <div className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
            <div className="flex min-w-0 items-center gap-2">
              <MessageSquareDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                {tempChatContext === "personalized"
                  ? "Temporary chat is on with existing context. It is not saved to history and will not create new saved memories."
                  : "Temporary chat is on. It is not saved to history and does not use or update saved memory, profile details, custom instructions, personality settings, or connected apps."}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {active?.temporary && active.messages.length > 0 ? (
                <button
                  type="button"
                  onClick={saveTemporaryChat}
                  disabled={isStreaming}
                  className="rounded-md px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save to history
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setTemporaryChatEnabled(false)}
                className="rounded-md px-2.5 py-1 text-xs font-medium hover:bg-accent"
              >
                Turn off
              </button>
            </div>
          </div>
        )}

        {!active || active.messages.length === 0 ? (
          <section
            className="kova-empty-chat flex flex-1 flex-col overflow-y-auto px-3 lg:px-6"
            aria-labelledby="chat-greeting"
          >
            <div className="kova-empty-chat-content flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10">
              <div className="kova-greeting mb-5 flex animate-fade-in flex-col items-center gap-3 lg:mb-6">
                <div className="kova-greeting-mark" aria-hidden="true">
                  <NovaLogo decorative mark className="h-5 w-5" />
                </div>
                <h1
                  id="chat-greeting"
                  className="text-balance px-4 text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.035em] text-foreground lg:text-[36px]"
                >
                  {greeting}
                </h1>
                <p className="max-w-md px-4 text-center text-sm leading-6 text-muted-foreground sm:text-[15px]">
                  Think through a question, shape an idea, or get a polished first draft.
                </p>
              </div>

              <div className="mx-auto w-full max-w-[48rem] px-1 sm:px-2">
                <ChatInput
                  value={principalReady ? input : ""}
                  onChange={setInput}
                  onSubmit={() => send(input, attachments)}
                  onStop={stop}
                  isStreaming={isStreaming}
                  disabled={!principalReady}
                  attachments={principalReady ? attachments : []}
                  onAttachmentsChange={setAttachments}
                  mode={mode}
                  onModeChange={setMode}
                  userTier={tier}
                  canChangeAgent={false}
                  onUploadLimit={() => setLimitDialog({ open: true, kind: "upload" })}
                  placeholder="Ask anything"
                  onPromptShortcut={(prompt) => setInput((v) => (v.trim() ? v : prompt))}
                  selectedTool={selectedTool}
                  onToolSelect={setSelectedTool}
                  recentLibraryFiles={recentLibraryFiles}
                  recentLibraryLoading={recentLibraryLoading}
                  recentLibraryError={recentLibraryError}
                  onRecentLibraryRetry={loadRecentLibraryFiles}
                  surface="empty"
                />
              </div>
              <div className="kova-starter-grid mx-auto grid w-full max-w-[48rem] grid-cols-2 gap-2 px-1 pt-2 sm:px-2">
                {EMPTY_STATE_STARTERS.map((starter) => {
                  const Icon = starter.icon;
                  return (
                    <button
                      key={starter.label}
                      type="button"
                      className="kova-starter-prompt group flex min-h-14 items-center gap-2.5 rounded-xl border border-border px-3 text-left"
                      aria-label={`Start with ${starter.label}`}
                      onClick={() => {
                        setInput((current) => (current.trim() ? current : starter.prompt));
                        window.requestAnimationFrame(() => {
                          document
                            .querySelector<HTMLTextAreaElement>(
                              'textarea[aria-label="Message KovaGPT"]',
                            )
                            ?.focus({ preventScroll: true });
                        });
                      }}
                    >
                      <span className="kova-starter-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {starter.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {!isLoaded || isSignedIn ? null : (
              <p className="kova-disclaimer mx-auto w-full max-w-[48rem] px-4 pb-3 text-center text-[11px] leading-4 text-muted-foreground/80">
                KovaGPT is AI. By using it, you agree to our{" "}
                <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
                  Terms
                </Link>{" "}
                &amp;{" "}
                <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
                  Privacy Policy
                </Link>
                . Chats may be reviewed and used to improve our AI models.{" "}
                <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
                  Learn more.
                </Link>
              </p>
            )}
          </section>
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={updateNearBottom}
              className="kova-conversation-scroll flex-1 overflow-y-auto overscroll-contain scroll-smooth pb-14 pt-5 lg:pb-20 lg:pt-8"
              aria-label="Conversation"
            >
              {active.branchOrigin && (
                <div className="mx-auto mb-5 flex w-[calc(100%-2rem)] max-w-[48rem] items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/45 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">Branched conversation</span>
                    <span className="ml-1 text-muted-foreground">
                      from {active.branchOrigin.title}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg px-2.5 py-1.5 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      const origin = active.branchOrigin;
                      if (!origin) return;
                      const sourceExists = conversations.some(
                        (conversation) => conversation.id === origin.conversationId,
                      );
                      if (sourceExists) setActiveId(origin.conversationId);
                      else toast.error("The source conversation is no longer available");
                    }}
                  >
                    View source
                  </button>
                </div>
              )}
              <ChatBranchBar
                branches={branchState.branches}
                activeBranch={branchState.activeBranch}
                loading={branchState.loading}
                error={branchState.error}
                onActivate={activateBranch}
                onRetry={branchState.refresh}
                durableHint={
                  isSignedIn
                    ? "Branching keeps the original path; sharing snapshots the active branch only."
                    : "Branches are stored on this device until you sign in."
                }
              />
              {chatRulesActive && (
                <div className="mx-auto flex w-full max-w-[48rem] px-3 pt-2 lg:px-0">
                  <button
                    type="button"
                    onClick={() => setWorkspaceOpen(true)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Sliders className="h-3.5 w-3.5" /> Chat rules are active
                  </button>
                </div>
              )}
              {active.messages.map((m, i) => {
                const isLastAssistant = m.role === "assistant" && i === active.messages.length - 1;
                // Find the user message that prompted this assistant reply (immediately before).
                const priorUser =
                  m.role === "assistant" && i > 0 && active.messages[i - 1]?.role === "user"
                    ? active.messages[i - 1]
                    : null;
                return (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    chatId={active.id}
                    temporary={Boolean(active.temporary)}
                    onReplaceContent={
                      m.role === "assistant" && !isStreaming
                        ? (messageId, next) => replaceMessageContent(active.id, messageId, next)
                        : undefined
                    }
                    userKey={userKey}
                    principalResolved={isLoaded}
                    streaming={isStreaming && isLastAssistant}
                    onUpdatePendingConfirm={(messageId, next) => {
                      setConversations((prev) =>
                        prev.map((c) => {
                          if (c.id !== active.id) return c;
                          return {
                            ...c,
                            messages: c.messages.map((msg) =>
                              msg.id !== messageId
                                ? msg
                                : {
                                    ...msg,
                                    pendingConfirms: (msg.pendingConfirms ?? []).map((pc) =>
                                      pc.actionId === next.actionId ? next : pc,
                                    ),
                                  },
                            ),
                          };
                        }),
                      );
                    }}
                    onFollowUp={
                      isLastAssistant && !isStreaming ? (prompt) => send(prompt, []) : undefined
                    }
                    onEdit={
                      m.role === "user" && !isStreaming
                        ? () => {
                            setInput(m.content);
                            setAttachments(
                              (m.attachments ?? []).map((attachment) =>
                                attachment.kind === "image"
                                  ? {
                                      kind: "image" as const,
                                      dataUrl: attachment.dataUrl,
                                      name: "Attached image",
                                      status: "complete" as const,
                                    }
                                  : attachment.kind === "text_file"
                                    ? {
                                        kind: "text_file" as const,
                                        dataUrl: "",
                                        name: attachment.name,
                                        size: attachment.size ?? undefined,
                                        fileType: attachment.fileType,
                                        textContent: attachment.content,
                                        status: "complete" as const,
                                      }
                                    : {
                                        kind: "library_file" as const,
                                        dataUrl: "",
                                        name: attachment.name,
                                        size: attachment.size ?? undefined,
                                        libraryItemId: attachment.libraryItemId,
                                        fileType: attachment.fileType,
                                        sourceProject: attachment.sourceProject,
                                        status: "complete" as const,
                                      },
                              ),
                            );
                            setEditingMessage({
                              conversationId: active.id,
                              messageId: m.id,
                            });
                            window.setTimeout(
                              () =>
                                document
                                  .querySelector<HTMLTextAreaElement>(
                                    'textarea[aria-label="Message KovaGPT"]',
                                  )
                                  ?.focus(),
                              0,
                            );
                          }
                        : undefined
                    }
                    onRetry={
                      isLastAssistant && !isStreaming && priorUser
                        ? () => {
                            const retryHistory = active.messages.slice(0, -2);
                            void send(
                              priorUser.content,
                              (priorUser.attachments ?? []).map((attachment) =>
                                attachment.kind === "image"
                                  ? {
                                      kind: "image" as const,
                                      dataUrl: attachment.dataUrl,
                                      name: "Attached image",
                                      status: "complete" as const,
                                    }
                                  : attachment.kind === "text_file"
                                    ? {
                                        kind: "text_file" as const,
                                        dataUrl: "",
                                        name: attachment.name,
                                        size: attachment.size ?? undefined,
                                        fileType: attachment.fileType,
                                        textContent: attachment.content,
                                        status: "complete" as const,
                                      }
                                    : {
                                        kind: "library_file" as const,
                                        dataUrl: "",
                                        name: attachment.name,
                                        size: attachment.size ?? undefined,
                                        libraryItemId: attachment.libraryItemId,
                                        fileType: attachment.fileType,
                                        sourceProject: attachment.sourceProject,
                                        status: "complete" as const,
                                      },
                              ),
                              0,
                              active.id,
                              retryHistory,
                            );
                          }
                        : undefined
                    }
                    onBranch={() => {
                      if (isStreaming) {
                        toast.message("Wait for this response to finish before branching");
                        return;
                      }
                      try {
                        const branched = branchConversation(active, m.id);
                        setConversations((prev) => [branched, ...prev]);
                        setActiveId(branched.id);
                        toast.success("Branched into a new chat");
                        // The original path is untouched; record the branch point
                        // so it survives a reload for signed-in users.
                        void branchState
                          .createBranch({
                            conversationId: branched.id,
                            branchFromMessageId: m.id,
                            branchFromMessageIndex: i,
                            messageIds: active.messages.slice(0, i + 1).map((msg) => msg.id),
                            label: branched.title?.slice(0, 120) ?? null,
                            parentBranchId: branchState.activeBranch?.id ?? null,
                          })
                          .catch((error) => {
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "The branch point could not be saved.",
                            );
                          });
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Could not branch chat",
                        );
                      }
                    }}
                  />
                );
              })}
            </div>
            {showJumpToLatest && (
              <button
                type="button"
                onClick={() => {
                  const el = scrollRef.current;
                  if (!el) return;
                  nearBottomRef.current = true;
                  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                  setShowJumpToLatest(false);
                }}
                className="fixed bottom-28 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium shadow-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Jump to latest message"
              >
                Jump to latest
              </button>
            )}
            <div className="lg:pb-2 lg:pt-2">
              {editingMessage?.conversationId === active.id && (
                <div
                  className="mx-auto mb-2 flex w-full max-w-[48rem] items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm"
                  role="status"
                >
                  <span className="min-w-0 truncate">Editing a previous prompt</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setEditingMessage(null);
                      setInput("");
                      setAttachments([]);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              <ChatInput
                value={principalReady ? input : ""}
                onChange={setInput}
                onSubmit={() => send(input, attachments)}
                onStop={stop}
                isStreaming={isStreaming}
                disabled={!principalReady}
                attachments={principalReady ? attachments : []}
                onAttachmentsChange={setAttachments}
                mode={mode}
                onModeChange={setMode}
                userTier={tier}
                canChangeAgent={false}
                onUploadLimit={() => setLimitDialog({ open: true, kind: "upload" })}
                placeholder="Ask anything"
                onPromptShortcut={(prompt) => setInput((v) => (v.trim() ? v : prompt))}
                selectedTool={selectedTool}
                onToolSelect={setSelectedTool}
                recentLibraryFiles={recentLibraryFiles}
                recentLibraryLoading={recentLibraryLoading}
                recentLibraryError={recentLibraryError}
                onRecentLibraryRetry={loadRecentLibraryFiles}
              />
            </div>
          </>
        )}
      </main>

      <Suspense fallback={null}>
        {settingsOpen && (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onChange={setSettings}
            onClearAll={() => {
              storageGenerationRef.current += 1;
              abortRef.current?.abort();
              abortRef.current = null;
              inFlightRef.current = false;
              if (retryTimerRef.current !== null) {
                window.clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
              }
              // A same-principal local reset should remain usable with a clean,
              // empty workspace. The incremented generation rejects every
              // closure created before cleanup.
              setConversationState({ principal: storagePrincipal, items: [] });
              setSettings(DEFAULT_SETTINGS);
              setSettingsPrincipal(storagePrincipal);
              setActiveId(null);
              setInput("");
              setAttachments([]);
              setSelectedTool(null);
              setCommandOpen(false);
              setCommandQuery("");
              setEditingMessage(null);
              setIsStreaming(false);
            }}
            onOpenHelp={openHelp}
            initialTab={settingsTab}
            returnFocusTarget={settingsReturnFocusRef.current}
          />
        )}

        <OnboardingDialog />

        {tempChatStartOpen && (
          <TemporaryChatStartDialog
            open={tempChatStartOpen}
            onOpenChange={setTempChatStartOpen}
            onStart={startTemporaryChat}
          />
        )}

        {workspaceOpen && (
          <ChatWorkspaceDialog
            open={workspaceOpen}
            onOpenChange={setWorkspaceOpen}
            chatId={active?.id ?? null}
            temporary={Boolean(active?.temporary)}
            onRulesActiveChange={setChatRulesActive}
          />
        )}

        {shareChatId !== null && (
          <ShareChatDialog
            open={shareChatId !== null}
            onOpenChange={(v) => !v && setShareChatId(null)}
            conversation={conversations.find((c) => c.id === shareChatId) ?? null}
          />
        )}

        {limitDialog.open && (
          <LimitReachedDialog
            open={limitDialog.open}
            onOpenChange={(v) => setLimitDialog((d) => ({ ...d, open: v }))}
            kind={limitDialog.kind}
            message={limitDialog.message}
            resetsAt={getUsage().resetsAt}
          />
        )}
      </Suspense>

      <SignUpPrompt open={signupPromptOpen} onOpenChange={setSignupPromptOpen} />

      <CommandPalette
        open={commandOpen}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        conversations={historyConversations}
        archivedConversations={archivedConversations}
        workspaceItems={workspaceItems}
        workspaceStatus={workspaceStatus}
        retryWorkspaceSearch={retryWorkspaceSearch}
        onClose={() => setCommandOpen(false)}
        onNewChat={newChat}
        onSelectChat={setActiveId}
        onSelectArchived={(conversation) => {
          removeArchivedConversation(userKey, conversation.id);
          setConversations((current) => [
            conversation,
            ...current.filter((item) => item.id !== conversation.id),
          ]);
          setActiveId(conversation.id);
        }}
        onOpenSettings={() => openSettings("general")}
        returnFocusTarget={commandReturnFocusRef.current}
      />
    </div>
  );
}
