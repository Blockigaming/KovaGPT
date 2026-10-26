import type { createTranscriptReadingAnchorController } from "@/lib/chat-reading-anchor";
import {
  snapshotNextPrompt,
  sameNextPromptScope,
  sameNextPromptContext,
  advanceNextPromptScope,
  holdNextPrompt,
  settleNextPrompt,
  matchesNextPromptDraft,
  type NextPrompt,
  type NextPromptScope,
} from "@/lib/chat-send-next";
import { sameReviewedMemoryConversation } from "@/lib/reviewed-memory-conversation.mjs";
import { appendFollowupToDraft } from "@/lib/response-followups.mjs";
import type { ResultDescriptor } from "@/components/ArtifactEditor";
import { splitGenerativeContent } from "@/lib/generative-ui.mjs";
import type { ComposerVoiceTurn } from "@/lib/composer-voice-turn";
import { loadChatHistoryDevice } from "@/lib/chat-history-idb.mjs";

import type { WorkspaceResultDescriptor } from "@/components/WorkspaceResultContent";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import {
  beginChatEdit,
  restoreChatEditDraft,
  hasPendingChatAttachments,
  type ChatEditDraft,
} from "@/lib/chat-edit-draft";
import {
  canWriteChatHistory,
  canSendChatHistory,
  markChatHistoryDirty,
  chatHistoryView,
  chatHistorySnapshot,
  CHAT_HISTORY_CHANGED_EVENT,
} from "@/lib/chat-history-bridge";
import { chatRequestMessages, chatRequestLocale as safeLocale } from "@/lib/chat-store";
import { MAPS_RELEASE_APPROVED } from "@/lib/maps-release-gate";
import { createMemorySourceUpdater } from "@/lib/memory-sources.mjs";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { chatResponseError, consumeChatSse } from "@/lib/chat-sse-client.mjs";
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
import { PanelLeft } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { focusReopenedSidebar } from "@/lib/sidebar-keyboard-focus";

import type { TranscriptMessageRenderer } from "@/components/ActiveChatTranscript";
import {
  ChatInput,
  type ComposerToolId,
  type PendingAttachment,
  type RecentLibraryFile,
} from "@/components/ChatInput";
import { MobileTopBar } from "@/components/MobileTopBar";

import { type Settings, DEFAULT_SETTINGS, settingsSectionForTab } from "@/lib/settings-types";

const ConversationHeaderActions = lazy(() =>
  import("@/components/ConversationHeaderActions").then((module) => ({
    default: module.ConversationHeaderActions,
  })),
);
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);
const ActiveChatTranscript = lazy(() =>
  import("@/components/ActiveChatTranscript").then((module) => ({
    default: module.ActiveChatTranscript,
  })),
);

const QuotaRejectedDraftPreview = lazy(() =>
  import("@/components/QuotaRejectedDraftPreview").then((module) => ({
    default: module.QuotaRejectedDraftPreview,
  })),
);
const WorkspaceResultDivider = lazy(() =>
  import("@/components/WorkspaceResultContent").then((module) => ({
    default: module.WorkspaceResultDivider,
  })),
);
const WorkspaceResultContent = lazy(() =>
  import("@/components/WorkspaceResultContent").then((module) => ({
    default: module.WorkspaceResultContent,
  })),
);
const SignUpPrompt = lazy(() =>
  import("@/components/SignUpPrompt").then((module) => ({ default: module.SignUpPrompt })),
);
const ReviewedMemoryDialog = lazy(() =>
  import("@/components/ReviewedMemoryDialog").then((module) => ({
    default: module.ReviewedMemoryDialog,
  })),
);
const HomeChatStarters = lazy(() =>
  import("@/components/HomeChatStarters").then((module) => ({ default: module.HomeChatStarters })),
);
const ChatWorkspaceControls = lazy(() =>
  import("@/components/ChatWorkspaceControls").then((module) => ({
    default: module.ChatWorkspaceControls,
  })),
);
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
const loadTemporaryChatControls = () => import("@/components/TemporaryChatStartDialog");
const TemporaryChatStartDialog = lazy(() =>
  loadTemporaryChatControls().then((m) => ({
    default: m.TemporaryChatStartDialog,
  })),
);
const TemporaryChatToggle = lazy(() =>
  loadTemporaryChatControls().then((m) => ({
    default: m.TemporaryChatToggle,
  })),
);
const TemporaryChatBanner = lazy(() =>
  loadTemporaryChatControls().then((m) => ({
    default: m.TemporaryChatBanner,
  })),
);
const COMPLETE = "complete" as const;

function clearRetryTimer(timer: { current: number | null }) {
  if (timer.current === null) return;
  window.clearTimeout(timer.current);
  timer.current = null;
}

import { applyThemeMode, loadThemeMode } from "@/lib/theme";
import { loadSettings, settingsKey } from "@/lib/use-nova-settings";
import { applyReadingPreferences } from "@/lib/appearance-preferences.mjs";
import { consumeOnboardingHandoff } from "@/lib/onboarding-handoff";
import {
  blockMemoryWrites,
  configureMemoryWrites,
  isMemoryWriteBlocked,
  memoryWriteBlockStorageKey,
} from "@/lib/memory-write-coordinator.mjs";

import { getUsage } from "@/lib/limits";

import {
  useUser,
  useClerkSafe,
  SignInButton,
  SignUpButton,
  clerkEnabled,
} from "@/components/auth/ClerkSafe";
import { type ModeId } from "@/lib/modes";
import {
  type Conversation,
  type Activity,
  type Message,
  type TemporaryChatContext,
  type ConversationWorkflowSkill,
  deriveTitle,
  chatStoragePrincipal,
  clearDraft,
  clearPendingActive,
  draftStorageKey,
  loadDraft,
  loadConversations,
  subscribeToConversationChanges,
  loadArchivedConversations,
  loadPendingActive,
  savePendingActive,
  markAssistantStopped,
  newId,
  normalizeResponseSources,
  isConversationWorkflowSkill,
  saveConversations,
  persistTemporaryConversation,
  saveDraft,
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

const USER_STOP_REASON = "kova_user_stopped_generation";
type ChatRequestNotice = {
  scope: NextPromptScope;
  kind: "session-expired";
  signedIn: boolean;
};
type AppChatContextHandoff = string | { prompt: string; tool: "web_search" };

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

function pendingMessageAttachments(items: Message["attachments"]): PendingAttachment[] {
  return (items ?? []).map((attachment) =>
    attachment.kind === "image"
      ? {
          kind: "image" as const,
          dataUrl: attachment.dataUrl,
          name: "Attached image",
          status: COMPLETE,
        }
      : attachment.kind === "text_file"
        ? {
            kind: "text_file" as const,
            dataUrl: "",
            name: attachment.name,
            size: attachment.size ?? undefined,
            fileType: attachment.fileType,
            textContent: attachment.content,
            status: COMPLETE,
          }
        : {
            kind: "library_file" as const,
            dataUrl: "",
            name: attachment.name,
            size: attachment.size ?? undefined,
            libraryItemId: attachment.libraryItemId,
            fileType: attachment.fileType,
            sourceProject: attachment.sourceProject,
            status: COMPLETE,
          },
  );
}

function KovaGPT() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { tier } = useTier();
  const navigate = useNavigate();
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
  const historyReady = canSendChatHistory(userKey);
  const conversations = principalReady ? conversationState.items : EMPTY_CONVERSATIONS;
  const setConversations = useCallback(
    (next: SetStateAction<Conversation[]>) => {
      if (
        !isLoaded ||
        storagePrincipalRef.current !== storagePrincipal ||
        !canWriteChatHistory(userKey)
      )
        return;
      markChatHistoryDirty(userKey);
      setConversationState((previous) => {
        // Async work started by a prior account must never write into the
        // currently active account's browser namespace.
        if (!isLoaded || storagePrincipalRef.current !== storagePrincipal) return previous;
        const current = previous.principal === storagePrincipal ? previous.items : [];
        const items = typeof next === "function" ? next(current) : next;
        return { principal: storagePrincipal, items };
      });
    },
    [isLoaded, storagePrincipal, userKey],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composerVoiceMode, setComposerVoiceMode] = useState<"dictate" | "voice" | null>(null);
  const composerVoiceSessionRef = useRef<{
    mode: "dictate" | "voice";
    ownerId: string | null;
    scope: NextPromptScope;
    generation: number;
  } | null>(null);
  const voiceConversationsRef = useRef(conversations);
  voiceConversationsRef.current = conversations;
  const stopComposerVoiceRequestRef = useRef<() => void>(() => undefined);
  const composerDraftRef = useRef({
    text: "",
    attachments: [] as PendingAttachment[],
    tool: null as ComposerToolId | null,
  });
  const composerRevisionRef = useRef(0);
  const [input, setInputState] = useState("");
  const setInput = useCallback((next: SetStateAction<string>) => {
    const text = typeof next === "function" ? next(composerDraftRef.current.text) : next;
    if (text !== composerDraftRef.current.text) composerRevisionRef.current += 1;
    composerDraftRef.current = { ...composerDraftRef.current, text };
    setInputState(text);
  }, []);
  const [result, setResult] = useState<WorkspaceResultDescriptor | null>(null);
  const resultRef = useRef(result);
  resultRef.current = result;
  const resultReturnRef = useRef<{
    target: HTMLElement | null;
    url: string;
    scope: NextPromptScope;
    generation: number;
  } | null>(null);
  const resultFocusCleanupRef = useRef<(() => void) | null>(null);
  const resultDraftsRef = useRef(new Map<string, WorkspaceResultDescriptor>());
  const resultPrincipalRef = useRef(storagePrincipal);
  const resultScopeRef = useRef<string | null>(null);
  const [attachments, setAttachmentsState] = useState<PendingAttachment[]>([]);
  const setAttachments = useCallback((next: SetStateAction<PendingAttachment[]>) => {
    const current = composerDraftRef.current.attachments;
    const attachments = typeof next === "function" ? next(current) : next;
    if (attachments !== current && (attachments.length || current.length))
      composerRevisionRef.current += 1;
    composerDraftRef.current = { ...composerDraftRef.current, attachments };
    setAttachmentsState(attachments);
  }, []);
  const [mode, setMode] = useState<ModeId>("instant");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamAnnouncement, setStreamAnnouncement] = useState("");
  const [tempChat, setTempChat] = useState(false);
  const [tempChatContext, setTempChatContext] = useState<TemporaryChatContext>("clean");
  const [tempChatStartOpen, setTempChatStartOpen] = useState(false);
  const temporaryTriggerRef = useRef<HTMLElement | null>(null);
  const temporaryReturnUrlRef = useRef<string | undefined>(undefined);
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
  const [selectedTool, setSelectedToolState] = useState<ComposerToolId | null>(null);
  const setSelectedTool = useCallback((next: SetStateAction<ComposerToolId | null>) => {
    const tool = typeof next === "function" ? next(composerDraftRef.current.tool) : next;
    if (tool !== composerDraftRef.current.tool) composerRevisionRef.current += 1;
    composerDraftRef.current = { ...composerDraftRef.current, tool };
    setSelectedToolState(tool);
  }, []);
  const [pendingWorkflowSkill, setPendingWorkflowSkill] =
    useState<ConversationWorkflowSkill | null>(null);
  const [recentLibraryFiles, setRecentLibraryFiles] = useState<RecentLibraryFile[]>([]);
  const [recentLibraryLoading, setRecentLibraryLoading] = useState(false);
  const [recentLibraryError, setRecentLibraryError] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatEditDraft | null>(null);
  useEffect(() => {
    if (
      editingMessage &&
      (editingMessage.principal !== storagePrincipal || editingMessage.conversationId !== activeId)
    ) {
      setEditingMessage(null);
    }
  }, [activeId, storagePrincipal, editingMessage]);

  // Start closed to avoid a flash-of-open sidebar on narrow viewports during
  // SSR/hydration. On desktop we honor the persisted user preference so the
  // sidebar remembers its collapsed state across reloads.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarKeyboardTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const trigger = sidebarKeyboardTriggerRef.current;
    sidebarKeyboardTriggerRef.current = null;
    if (!sidebarOpen || !trigger) return;
    return focusReopenedSidebar(trigger);
  }, [sidebarOpen]);
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
      const files = isSignedIn
        ? await (
            await import("@/lib/recent-library-files.mjs")
          ).loadRecentLibraryFileOptions("Saved from chat")
        : [];
      if (!isCurrent()) return;
      setRecentLibraryFiles(files);
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
  const pendingDraftLoadRef = useRef<{
    key: string;
    text: string;
    attachments: PendingAttachment[];
  } | null>(null);
  // Attachments stay in this mounted workspace only; never persist them as drafts.
  const attachmentDraftsRef = useRef(new Map<string, PendingAttachment[]>());
  const attachmentDraftPrincipalRef = useRef(storagePrincipal);
  const temporaryDraftTransitionRef = useRef<{
    principal: string;
    text: string;
    attachments: PendingAttachment[];
  } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!principalReady || attachmentDraftPrincipalRef.current !== storagePrincipal) {
      attachmentDraftsRef.current.clear();
      attachmentDraftPrincipalRef.current = storagePrincipal;
      pendingDraftLoadRef.current = null;
    }
    const temporaryDraft = temporaryDraftTransitionRef.current;
    if (temporaryDraft && principalReady && temporaryDraft.principal === storagePrincipal) {
      temporaryDraftTransitionRef.current = null;
      lastLoadedDraftRef.current = tempChat ? null : draftStorageKey(userKey, activeId);
      pendingDraftLoadRef.current = null;
      setInput(temporaryDraft.text);
      setAttachments(temporaryDraft.attachments);
      return;
    }
    if (temporaryDraft && temporaryDraft.principal !== storagePrincipal)
      temporaryDraftTransitionRef.current = null;
    if (tempChat) {
      lastLoadedDraftRef.current = null;
      pendingDraftLoadRef.current = null;
      setInput("");
      setAttachments([]);
      return;
    }
    if (!principalReady) return;
    const key = draftStorageKey(userKey, activeId);
    if (lastLoadedDraftRef.current === key) return;
    lastLoadedDraftRef.current = key;
    let text = "";
    try {
      text = loadDraft(userKey, activeId);
    } catch {
      /* Keep the empty draft. */
    }
    const files = attachmentDraftsRef.current.get(key) ?? [];
    pendingDraftLoadRef.current = { key, text, attachments: files };
    setInput(text);
    setAttachments(files);
  }, [activeId, principalReady, tempChat, userKey, storagePrincipal, setInput, setAttachments]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tempChat || !principalReady) return;
    const key = draftStorageKey(userKey, activeId);
    if (lastLoadedDraftRef.current !== key) return;
    // Do not save the outgoing render into the destination before its load commits.
    if (pendingDraftLoadRef.current) {
      const pending = pendingDraftLoadRef.current;
      if (pending.key !== key || pending.text !== input || pending.attachments !== attachments)
        return;
      pendingDraftLoadRef.current = null;
    }
    try {
      const preserved = restoreChatEditDraft(editingMessage, storagePrincipal, activeId ?? "");
      if (editingMessage && !preserved) return;
      saveDraft(userKey, activeId, preserved?.text ?? input);
      const files = preserved?.attachments ?? attachments;
      if (files.length)
        attachmentDraftsRef.current.set(
          key,
          files.map((file) => ({ ...file })),
        );
      else attachmentDraftsRef.current.delete(key);
    } catch {
      /* ignore */
    }
  }, [
    input,
    attachments,
    activeId,
    principalReady,
    tempChat,
    userKey,
    editingMessage,
    storagePrincipal,
  ]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const openSettings = useCallback(
    (tab?: string) => {
      // Attachment drafts and temporary chats intentionally exist only in this mounted workspace.
      // Keep settings in place for those cases rather than losing private or unsaved work.
      if (attachments.length || tempChat || isStreaming || result) {
        settingsReturnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setSettingsTab(tab);
        setSettingsOpen(true);
        return;
      }
      if (principalReady) {
        saveDraft(userKey, activeId, input);
        if (activeId) savePendingActive(userKey, activeId);
      }
      void navigate({ to: "/settings/$section", params: { section: settingsSectionForTab(tab) } });
    },
    [
      activeId,
      attachments.length,
      input,
      isStreaming,
      navigate,
      principalReady,
      result,
      tempChat,
      userKey,
    ],
  );
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
  const openHelp = useCallback(() => {
    navigate({ to: "/help" as never });
  }, [navigate]);
  const [shareChatId, setShareChatId] = useState<string | null>(null);
  const shareReturnFocusRef = useRef<HTMLElement | null>(null);
  const shareReturnUrlRef = useRef<string | undefined>(undefined);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const workspaceReturnFocusRef = useRef<HTMLElement | null>(null);
  const workspaceReturnUrlRef = useRef<string | undefined>(undefined);
  const openChatWorkspace = (target?: HTMLElement | null) => {
    workspaceReturnFocusRef.current =
      target ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    workspaceReturnUrlRef.current = window.location.href;
    setWorkspaceOpen(true);
  };
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
  const inFlightTargetRef = useRef<{
    controller: AbortController;
    conversationId: string;
    assistantMessageId: string;
    startedAt: number;
    flushPendingContent: () => void;
  } | null>(null);
  const inFlightRef = useRef(false);
  const [nextPrompt, setNextPrompt] = useState<NextPrompt | null>(null);
  const nextPromptRef = useRef<NextPrompt | null>(null);
  const nextPromptMountedRef = useRef(false);
  const nextPromptFocusCleanupRef = useRef<(() => void) | null>(null);
  const renderedNextPromptScope: NextPromptScope = {
    principal: principalReady ? storagePrincipal : `unresolved:${storagePrincipal}`,
    conversationId: activeId,
    temporary: tempChat,
    temporaryContext: tempChatContext,
  };
  const nextPromptScopeRef = useRef<NextPromptScope>({ ...renderedNextPromptScope, lifetime: 0 });
  // Advance during render so A → B → A cannot re-arm a queue before passive effects run.
  nextPromptScopeRef.current = advanceNextPromptScope(
    nextPromptScopeRef.current,
    renderedNextPromptScope,
  );
  const nextPromptScope = nextPromptScopeRef.current;
  composerDraftRef.current = { text: input, attachments, tool: selectedTool };
  const [quotaRejectedDrafts, setQuotaRejectedDrafts] = useState<NextPrompt[]>([]);
  const quotaRejectedDraftsRef = useRef<NextPrompt[]>([]);
  const updateQuotaRejectedDrafts = useCallback((drafts: NextPrompt[]) => {
    quotaRejectedDraftsRef.current = drafts;
    if (nextPromptMountedRef.current) setQuotaRejectedDrafts(drafts);
  }, []);
  useEffect(() => {
    const current = quotaRejectedDraftsRef.current;
    const retained = current.filter((draft) => sameNextPromptScope(draft.scope, nextPromptScope));
    if (retained.length !== current.length) updateQuotaRejectedDrafts(retained);
  }, [nextPromptScope, updateQuotaRejectedDrafts]);
  const updateNextPrompt = useCallback((next: NextPrompt | null) => {
    nextPromptRef.current = next;
    if (nextPromptMountedRef.current) setNextPrompt(next);
  }, []);
  useEffect(() => {
    nextPromptMountedRef.current = true;
    return () => {
      nextPromptMountedRef.current = false;
      nextPromptRef.current = null;
      quotaRejectedDraftsRef.current = [];
      nextPromptFocusCleanupRef.current?.();
    };
  }, []);
  useEffect(() => {
    const next = nextPromptRef.current;
    if (!next) return;
    if (
      !principalReady ||
      next.scope.principal !== storagePrincipal ||
      !conversations.some((chat) => chat.id === next.scope.conversationId)
    ) {
      updateNextPrompt(null);
    } else if (!sameNextPromptScope(next.scope, nextPromptScopeRef.current) || editingMessage) {
      updateNextPrompt(
        holdNextPrompt(
          next,
          "This chat or its context changed. Open the original chat and edit this message to send it deliberately.",
        ),
      );
    }
  }, [
    activeId,
    storagePrincipal,
    principalReady,
    tempChat,
    tempChatContext,
    editingMessage,
    conversations,
    nextPromptScope,
    updateNextPrompt,
  ]);
  const retryGenerationRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const retryActionEpochRef = useRef(new Map<string, number>());
  // Retry permission is known only for failures observed in this mounted account.
  const retryableFailedResponsesRef = useRef(new Set<string>());
  const [requestNotice, setRequestNotice] = useState<ChatRequestNotice | null>(null);
  const requestNoticeRef = useRef<ChatRequestNotice | null>(null);
  const updateRequestNotice = useCallback((next: ChatRequestNotice | null) => {
    requestNoticeRef.current = next;
    if (nextPromptMountedRef.current) setRequestNotice(next);
  }, []);
  const visibleRequestNotice =
    principalReady && requestNotice && sameNextPromptScope(requestNotice.scope, nextPromptScope)
      ? requestNotice
      : null;
  useEffect(() => {
    if (
      requestNotice &&
      requestNotice === requestNoticeRef.current &&
      !sameNextPromptScope(requestNotice.scope, nextPromptScopeRef.current)
    ) {
      clearRetryTimer(retryTimerRef);
      updateRequestNotice(null);
    }
  }, [nextPromptScope, requestNotice, updateRequestNotice]);
  const activeIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [resultTab, setResultTab] = useState<"conversation" | "result">("conversation");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const responseDraftUrl = typeof window === "undefined" ? undefined : window.location.href;
  const responseDraftGeneration = storageGenerationRef.current;
  // Draft actions never dispatch. The caller focuses only after its popup closes.
  const prepareResponseDraft = (prompt: string): (() => void) | undefined => {
    const isCurrent = () =>
      principalReady &&
      nextPromptMountedRef.current &&
      !inFlightRef.current &&
      storagePrincipalRef.current === storagePrincipal &&
      responseDraftGeneration === storageGenerationRef.current &&
      sameNextPromptScope(nextPromptScope, nextPromptScopeRef.current) &&
      window.location.href === responseDraftUrl;
    if (!isCurrent()) return;
    const target = workspaceRef.current?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message KovaGPT"]',
    );
    const previousFocus = document.activeElement;
    setInput((draft) => appendFollowupToDraft(draft, prompt));
    const revision = composerRevisionRef.current;
    let consumed = false;
    return () => {
      if (consumed) return;
      consumed = true;
      if (
        !isCurrent() ||
        composerRevisionRef.current !== revision ||
        (document.activeElement !== previousFocus && document.activeElement !== document.body)
      )
        return;
      restoreDialogFocus(target, responseDraftUrl);
    };
  };
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [paneRatio, setPaneRatio] = useState(0.45);
  const wideResult = workspaceWidth >= 1000;
  const setLayoutRatio = (next: number) => {
    const usableWidth = Math.max(workspaceWidth - 12, 840);
    const minimum = 420 / usableWidth;
    setPaneRatio(Math.max(minimum, Math.min(1 - minimum, next)));
  };
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWorkspaceWidth(element.clientWidth));
    observer.observe(element);
    setWorkspaceWidth(element.clientWidth);
    const saved = Number(safeBrowserStorage("localStorage")?.getItem("kova-result-pane-ratio"));
    if (Number.isFinite(saved) && saved >= 0.2 && saved <= 0.8) setPaneRatio(saved);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    safeBrowserStorage("localStorage")?.setItem("kova-result-pane-ratio", String(paneRatio));
  }, [paneRatio]);
  useEffect(() => {
    // Session-only result drafts never enter browser storage or another account.
    resultFocusCleanupRef.current?.();
    resultReturnRef.current = null;
    if (resultPrincipalRef.current !== storagePrincipal) {
      resultDraftsRef.current.clear();
      resultPrincipalRef.current = storagePrincipal;
    }
    const scope = `${storagePrincipal}:${activeId ?? "new"}`;
    resultScopeRef.current = scope;
    resultRef.current = resultDraftsRef.current.get(scope) ?? null;
    setResult(resultRef.current);
    setResultTab("conversation");
  }, [activeId, storagePrincipal]);
  useEffect(() => () => resultFocusCleanupRef.current?.(), []);
  const resultReturnOrigin = resultReturnRef.current;
  const scheduleResultFocus = (
    origin: NonNullable<typeof resultReturnOrigin>,
    destination: "result" | "conversation",
    expectedResult: ResultDescriptor | null,
  ) => {
    resultFocusCleanupRef.current?.();
    const previousFocus = document.activeElement;
    let interrupted = false;
    const onInteraction = () => {
      interrupted = true;
    };
    for (const type of ["pointerdown", "keydown", "focusin"])
      document.addEventListener(type, onInteraction, true);
    window.addEventListener("blur", onInteraction);
    const cleanup = () => {
      window.cancelAnimationFrame(frame);
      for (const type of ["pointerdown", "keydown", "focusin"])
        document.removeEventListener(type, onInteraction, true);
      window.removeEventListener("blur", onInteraction);
      if (resultFocusCleanupRef.current === cleanup) resultFocusCleanupRef.current = null;
    };
    const frame = window.requestAnimationFrame(() => {
      const ownsFocus = resultFocusCleanupRef.current === cleanup;
      cleanup();
      if (
        !ownsFocus ||
        interrupted ||
        !nextPromptMountedRef.current ||
        resultReturnRef.current !== origin ||
        resultRef.current !== expectedResult ||
        origin.generation !== storageGenerationRef.current ||
        !sameNextPromptScope(origin.scope, nextPromptScopeRef.current) ||
        (document.activeElement !== previousFocus && document.activeElement !== document.body)
      )
        return;
      const conversation = document.getElementById("conversation-pane");
      const available = (target: HTMLElement | null) =>
        target?.isConnected &&
        target.getClientRects().length &&
        !target.closest('[inert], [aria-hidden="true"]') &&
        !target.matches(':disabled, [aria-disabled="true"]');
      const target =
        destination === "result"
          ? (document.getElementById("result-tab") ?? document.getElementById("result-pane"))
          : available(origin.target) && conversation?.contains(origin.target)
            ? origin.target
            : conversation;
      if (available(target)) restoreDialogFocus(target, origin.url);
    });
    resultFocusCleanupRef.current = cleanup;
  };
  const openResult = (next: WorkspaceResultDescriptor, trigger?: HTMLElement) => {
    if (
      !nextPromptMountedRef.current ||
      !sameNextPromptScope(nextPromptScope, nextPromptScopeRef.current)
    )
      return;
    const scope = `${storagePrincipal}:${activeId ?? "new"}`;
    const previous = resultDraftsRef.current.get(scope);
    const descriptor =
      previous?.messageId === next.messageId &&
      previous?.title === next.title &&
      previous?.canvasSourceKey === next.canvasSourceKey &&
      Boolean(previous?.widget) === Boolean(next.widget)
        ? previous
        : next;
    resultScopeRef.current = scope;
    resultDraftsRef.current.set(scope, descriptor);
    const origin = {
      target:
        trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
      url: window.location.href,
      scope: nextPromptScopeRef.current,
      generation: storageGenerationRef.current,
    };
    resultReturnRef.current = origin;
    resultRef.current = descriptor;
    setResult(descriptor);
    setResultTab("result");
    scheduleResultFocus(origin, "result", descriptor);
  };
  const openResultRef = useRef(openResult);
  openResultRef.current = openResult;
  const closeResult = () => {
    if (
      !result ||
      !nextPromptMountedRef.current ||
      resultRef.current !== result ||
      resultReturnRef.current !== resultReturnOrigin ||
      !sameNextPromptScope(nextPromptScope, nextPromptScopeRef.current)
    )
      return;
    const origin = resultReturnOrigin ?? {
      target: null,
      url: window.location.href,
      scope: nextPromptScopeRef.current,
      generation: storageGenerationRef.current,
    };
    if (
      origin.generation !== storageGenerationRef.current ||
      window.location.href !== origin.url ||
      !sameNextPromptScope(origin.scope, nextPromptScopeRef.current)
    )
      return;
    if (resultScopeRef.current) resultDraftsRef.current.delete(resultScopeRef.current);
    resultReturnRef.current = origin;
    resultRef.current = null;
    setResult(null);
    setResultTab("conversation");
    // The Conversation pane is hidden in the tabbed layout until the close commits.
    scheduleResultFocus(origin, "conversation", null);
  };

  // Load (or reload) settings whenever the signed-in user changes so each
  // account gets its own personalization, behavior, appearance, etc.
  useEffect(() => {
    if (!isLoaded) {
      storageGenerationRef.current += 1;
      updateNextPrompt(null);
      setConversationState({ principal: null, items: [] });
      setSettingsPrincipal(null);
      setTempChat(false);
      setTempChatContext("clean");
      setTempChatStartOpen(false);
      setTempChatConfirmed(false);
      return;
    }
    storageGenerationRef.current += 1;
    updateNextPrompt(null);
    retryGenerationRef.current += 1;
    retryActionEpochRef.current.clear();
    retryableFailedResponsesRef.current.clear();
    updateRequestNotice(null);
    toast.dismiss();
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightTargetRef.current = null;
    inFlightRef.current = false;
    clearRetryTimer(retryTimerRef);
    setIsStreaming(false);
    setTempChat(false);
    setTempChatContext("clean");
    setTempChatStartOpen(false);
    setTempChatConfirmed(false);
    setActiveId(null);
    setInput("");
    setAttachments([]);
    setSelectedTool(null);
    setPendingWorkflowSkill(null);
    setCommandOpen(false);
    setCommandQuery("");
    setEditingMessage(null);
    setShareChatId(null);
    setSettingsOpen(false);
    setRecentLibraryFiles([]);
    setRecentLibraryLoading(false);
    setRecentLibraryError(null);
    lastLoadedDraftRef.current = null;
    pendingDraftLoadRef.current = null;
    attachmentDraftsRef.current.clear();

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
  }, [
    isLoaded,
    userKey,
    isSignedIn,
    storagePrincipal,
    updateNextPrompt,
    updateRequestNotice,
    setInput,
    setAttachments,
    setSelectedTool,
  ]);

  useEffect(() => {
    if (!isLoaded) return;
    return subscribeToConversationChanges(userKey, (items) => {
      if (
        storagePrincipalRef.current !== storagePrincipal ||
        chatHistoryView(userKey)?.dirty ||
        inFlightRef.current
      )
        return;
      setConversationState((previous) => ({
        principal: storagePrincipal,
        items: [
          ...items,
          ...(previous.principal === storagePrincipal
            ? previous.items.filter((chat) => chat.temporary)
            : []),
        ],
      }));
    });
  }, [isLoaded, storagePrincipal, userKey]);

  // Re-apply theme only after this principal's settings are ready.
  // Guest mode is canonical in kova-theme-mode and must not be
  // overwritten by the default settings state during hydration.
  useEffect(() => {
    if (!settingsReady) return;
    applyThemeMode(userKey === null ? loadThemeMode() : (settings.mode ?? "system"));
  }, [settings.mode, settingsReady, userKey]);

  // Result and temporary work keep Settings mounted in this route instead of
  // using the settings page's hook. Apply their reading preferences live too.
  useEffect(() => {
    if (!settingsReady) return;
    applyReadingPreferences(document.documentElement, settings);
  }, [settings, settingsReady]);

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
    const snapshot = chatHistorySnapshot(userKey);
    const t = setTimeout(() => {
      if (generation !== storageGenerationRef.current) return;
      saveConversations(
        userKey,
        conversations.filter((c) => !c.temporary),
        { snapshot },
      );
    }, 400);
    return () => clearTimeout(t);
  }, [conversations, principalReady, userKey]);

  useEffect(() => {
    if (!isLoaded) return;
    const handlePrincipalReset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      storageGenerationRef.current += 1;
      updateNextPrompt(null);
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightTargetRef.current = null;
      inFlightRef.current = false;
      clearRetryTimer(retryTimerRef);
      lastLoadedDraftRef.current = null;
      pendingDraftLoadRef.current = null;
      attachmentDraftsRef.current.clear();
      setConversationState({ principal: null, items: [] });
      setSettings(DEFAULT_SETTINGS);
      setSettingsPrincipal(null);
      setActiveId(null);
      setInput("");
      setAttachments([]);
      setSelectedTool(null);
      setPendingWorkflowSkill(null);
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
  }, [isLoaded, userKey, updateNextPrompt, setInput, setAttachments, setSelectedTool]);

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

    consume<AppChatContextHandoff>("kova-app-chat-context", (appContext) => {
      if (typeof appContext === "string") return () => setInput(appContext);
      if (typeof appContext?.prompt !== "string" || appContext.tool !== "web_search")
        throw new Error("invalid_app_handoff");
      return () => {
        setInput(appContext.prompt);
        setSelectedTool("web_search");
      };
    });

    consume<ConversationWorkflowSkill>("kova-workflow-skill-chat", (skill) => {
      if (!isConversationWorkflowSkill(skill)) throw new Error("invalid_workflow_skill_handoff");
      return () => {
        setActiveId(null);
        setPendingWorkflowSkill(skill);
        setInput(`Use the “${skill.name}” workflow skill for this request: `);
      };
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

    const newest = candidates.sort((left, right) => right.createdAt - left.createdAt)[0];
    if (newest) newest.apply();
    if (rejectedHandoff) toast.error("Saved workspace context could not be attached");
  }, [principalReady, userKey, setInput, setSelectedTool]);

  // Memory is retained across sign-in/sign-out transitions per user request.

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  // Only a newly completed request can shift layout. Historical replies and
  // in-progress local drafts keep their current workspace and focus.
  const pendingCanvasRef = useRef<{ scope: string; messageId: string } | null>(null);
  useEffect(() => {
    const scope = `${storagePrincipal}:${activeId ?? "new"}`;
    const latest = active?.messages.at(-1);
    if (isStreaming) {
      pendingCanvasRef.current =
        latest?.role === "assistant" ? { scope, messageId: latest.id } : null;
      return;
    }
    const pending = pendingCanvasRef.current;
    pendingCanvasRef.current = null;
    if (
      !principalReady ||
      !pending ||
      pending.scope !== scope ||
      latest?.id !== pending.messageId ||
      latest.role !== "assistant" ||
      latest.generationStatus ||
      resultRef.current ||
      resultDraftsRef.current.has(scope)
    )
      return;
    const parts = splitGenerativeContent(latest.content);
    const index = parts.findIndex((part) => part.kind === "widget");
    const part = parts[index];
    if (part?.kind !== "widget") return;
    openResultRef.current({
      title: part.widget.title,
      initialContent: JSON.stringify(part.widget, null, 2),
      kind: "writing",
      initialMode: "edit",
      widget: part.widget,
      canvasSourceKey: `${latest.id}:${index}:${part.source}`,
      chatId: null,
      messageId: null,
      projectId: null,
    });
  }, [active, activeId, isStreaming, principalReady, storagePrincipal]);
  const [reviewedMemoryTarget, setReviewedMemoryTarget] = useState<{
    ownerId: string;
    generation: number;
    conversation: Conversation;
    trigger: HTMLElement | null;
    url: string;
  } | null>(null);
  const canReviewMemory = Boolean(
    principalReady &&
    settingsReady &&
    isLoaded &&
    isSignedIn &&
    userKey &&
    settings.rememberAcross &&
    tier !== "free" &&
    !isStreaming &&
    active &&
    !active.temporary,
  );
  // Drop private drafts on owner, conversation, eligibility, or history changes.
  const currentMemoryTarget =
    reviewedMemoryTarget &&
    canReviewMemory &&
    reviewedMemoryTarget.ownerId === userKey &&
    reviewedMemoryTarget.generation === storageGenerationRef.current &&
    sameReviewedMemoryConversation(
      reviewedMemoryTarget.conversation,
      active,
      reviewedMemoryTarget.ownerId,
    )
      ? reviewedMemoryTarget
      : null;
  const memoryReviewTargetRef = useRef(currentMemoryTarget);
  memoryReviewTargetRef.current = currentMemoryTarget;
  useEffect(() => {
    if (reviewedMemoryTarget && !currentMemoryTarget) setReviewedMemoryTarget(null);
  }, [reviewedMemoryTarget, currentMemoryTarget]);
  const chatStarted = Boolean(active?.messages.length);
  const activeTemporary = active ? Boolean(active.temporary) : null;
  const activeTemporaryContext = active?.temporary ? (active.temporaryContext ?? "clean") : null;
  const historyConversations = useMemo(
    () => conversations.filter((conversation) => !conversation.temporary),
    [conversations],
  );
  const archivedConversations =
    typeof window === "undefined" ? [] : loadArchivedConversations(userKey);
  const selectedWorkflowSkill = active?.skill ?? pendingWorkflowSkill;

  const clearWorkflowSkill = useCallback(() => {
    clearRetryTimer(retryTimerRef);
    // A queued automatic retry and an already-rendered Retry toast both capture
    // the old skill selection. Make each closure inert before clearing it.
    retryGenerationRef.current += 1;
    if (active?.id) {
      retryActionEpochRef.current.set(
        active.id,
        (retryActionEpochRef.current.get(active.id) ?? 0) + 1,
      );
    }
    setPendingWorkflowSkill(null);
    if (!active?.skill) return;
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === active.id
          ? { ...conversation, skill: undefined, updatedAt: Date.now() }
          : conversation,
      ),
    );
  }, [active?.id, active?.skill, setConversations]);

  useEffect(() => {
    if (activeTemporary !== null) setTempChat(activeTemporary);
    if (activeTemporaryContext !== null) setTempChatContext(activeTemporaryContext);
  }, [activeTemporary, activeTemporaryContext]);

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
      clearRetryTimer(retryTimerRef);
    },
    [],
  );

  const greeting = "What are you working on?";

  const transcriptScope = JSON.stringify([storagePrincipal, activeId, principalReady]);
  const transcriptScopeRef = useRef(transcriptScope);
  transcriptScopeRef.current = transcriptScope;
  const readingAnchorControllerRef = useRef<ReturnType<
    typeof createTranscriptReadingAnchorController
  > | null>(null);

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
    const controller = new AbortController();
    void import("@/lib/chat-summary-snapshot.mjs")
      .then(({ scheduleMemoryWrites }) => scheduleMemoryWrites(active, userKey, controller.signal))
      .catch(() => undefined);
    return () => controller.abort();
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

  // Hoist the dialog mode across the empty/conversation composer switch. A
  // voice chat gets its stable conversation before explicit microphone Start.
  const composerVoiceEligible = Boolean(
    principalReady &&
    isSignedIn &&
    userKey &&
    !tempChat &&
    !editingMessage &&
    !active?.temporary &&
    !hasPendingChatAttachments(attachments) &&
    canWriteChatHistory(userKey),
  );
  const changeComposerVoiceMode = (next: "dictate" | "voice" | null) => {
    if (next === null) {
      composerVoiceSessionRef.current = null;
      setComposerVoiceMode(null);
      return;
    }
    if (!principalReady) return;
    if (next === "dictate") {
      composerVoiceSessionRef.current = null;
      setComposerVoiceMode(next);
      return;
    }
    if (!isSignedIn || !userKey) return;
    if (
      next === "voice" &&
      (!composerVoiceEligible || inFlightRef.current || nextPromptRef.current)
    ) {
      toast.error("Finish the current message before starting voice chat.");
      return;
    }
    let scope = nextPromptScopeRef.current;
    if (next === "voice" && !active) {
      const id = newId();
      const timestamp = Date.now();
      const conversation: Conversation = {
        id,
        title: "New chat",
        messages: [],
        mode,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(pendingWorkflowSkill ? { skill: pendingWorkflowSkill } : {}),
      };
      // This deliberate transition retains the exact existing typed draft and
      // attachments. The voice transcript is submitted independently below.
      const key = draftStorageKey(userKey, id);
      lastLoadedDraftRef.current = key;
      pendingDraftLoadRef.current = null;
      attachmentDraftsRef.current.set(key, composerDraftRef.current.attachments);
      scope = advanceNextPromptScope(scope, { ...scope, conversationId: id });
      nextPromptScopeRef.current = scope;
      setConversations((previous) => [conversation, ...previous]);
      setActiveId(id);
    }
    composerVoiceSessionRef.current = {
      mode: next,
      ownerId: userKey,
      scope,
      generation: storageGenerationRef.current,
    };
    setComposerVoiceMode(next);
  };
  useEffect(() => {
    const session = composerVoiceSessionRef.current;
    if (
      session &&
      (!sameNextPromptScope(session.scope, nextPromptScopeRef.current) ||
        session.generation !== storageGenerationRef.current)
    ) {
      composerVoiceSessionRef.current = null;
      setComposerVoiceMode(null);
    }
  }, [nextPromptScope]);

  const newChat = useCallback(() => {
    setConversations((previous) => previous.filter((conversation) => !conversation.temporary));
    setActiveId(null);
    setInput("");
    setAttachments([]);
    setEditingMessage(null);
    setPendingWorkflowSkill(null);
  }, [setConversations, setInput, setAttachments]);

  useEffect(() => {
    if (!settingsReady || !userKey) return;
    const handoff = consumeOnboardingHandoff(userKey);
    if (!handoff) return;
    newChat();
    setSettings((previous) => ({ ...previous, responseLength: handoff.responseLength }));
    if (handoff.starter) setInput(handoff.starter);
  }, [newChat, settingsReady, userKey, setInput]);

  const startTemporaryChat = useCallback(
    (context: TemporaryChatContext) => {
      if (chatStarted) return;
      temporaryDraftTransitionRef.current = {
        principal: storagePrincipal,
        text: input,
        attachments,
      };
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
      toast.success("Temporary chat on", {
        description:
          context === "personalized"
            ? "No history or new memory. Your enabled context and connected apps may be used."
            : "No history or memory. Profile, instructions, personality and connected apps stay off.",
      });
    },
    [activeId, attachments, chatStarted, input, newChat, storagePrincipal, userKey],
  );

  const setTemporaryChatEnabled = useCallback(
    (enabled: boolean) => {
      if (chatStarted || enabled === tempChat) return;
      if (enabled) {
        setTempChatStartOpen(true);
        return;
      }

      // Privacy can change only before the first message, without discarding its draft.
      temporaryDraftTransitionRef.current = {
        principal: storagePrincipal,
        text: input,
        attachments,
      };
      newChat();
      setTempChat(enabled);
      setTempChatContext("clean");
      toast.message("Temporary chat off", {
        description: settings.rememberAcross
          ? "New chats save on this device and may use saved memory."
          : "New chats save on this device. Saved memory stays off.",
      });
    },
    [attachments, chatStarted, input, newChat, settings.rememberAcross, storagePrincipal, tempChat],
  );

  const saveTemporaryChat = useCallback(async () => {
    if (!active?.temporary || isStreaming || retryTimerRef.current !== null) return;
    // A scheduled retry still carries the immutable temporary-context closure.
    // Cancel it before conversion so no old temporary turn can land past the
    // new memory boundary and later be persisted as regular-chat memory.
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const generation = storageGenerationRef.current;
    const nextConversations = await persistTemporaryConversation(userKey, active, conversations);
    if (generation !== storageGenerationRef.current) return;
    if (!nextConversations) {
      toast.error("This chat could not be saved", {
        description: "Storage is unavailable or full. Free space and retry.",
      });
      return;
    }
    // Invalidate both queued retries and already-rendered Retry toast actions.
    // A callback created in temporary mode must never edit the converted chat.
    retryGenerationRef.current += 1;
    // A terminal-error toast can outlive the temporary request that created it.
    // Invalidate only this conversation's old callback before it becomes regular
    // so clicking that toast cannot replay the temporary-context closure.
    retryActionEpochRef.current.set(
      active.id,
      (retryActionEpochRef.current.get(active.id) ?? 0) + 1,
    );
    setConversations(nextConversations);
    setTempChat(false);
    setTempChatContext("clean");
    toast.success("Chat saved to history", {
      description: "Regular chat continues. Earlier temporary turns stay out of memory.",
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
    // Own pending-palette Escape before Sidebar's document listener. Mounted
    // menus/dialogs and IME composition retain their existing key handling.
    const onPendingPaletteEscape = (event: KeyboardEvent) => {
      if (
        !commandOpen ||
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        (event.target instanceof Element &&
          event.target.closest('[role="menu"], [role="dialog"], [role="alertdialog"], dialog'))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setCommandOpen(false);
    };
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
    window.addEventListener("keydown", onPendingPaletteEscape, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onPendingPaletteEscape, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commandOpen, newChat, openCommandPalette]);

  const historyAction = useCallback(
    async (kind: "delete" | "archive" | "restore" | "title", item: string | Conversation) => {
      const generation = storageGenerationRef.current;
      const current = () => generation === storageGenerationRef.current;
      const context = {
        ownerId: userKey,
        items: conversations,
        current,
        setItems: setConversations,
        activeId,
        setActive: setActiveId,
      };
      const actions = await import("@/lib/home-chat-history-actions");
      if (!current()) return;
      if (kind === "title") await actions.titleHomeChat(context, item as Conversation);
      else if (kind === "restore") await actions.restoreHomeChat(context, item as Conversation);
      else await actions.removeHomeChat(context, item as string, kind === "archive");
    },
    [activeId, conversations, setConversations, userKey],
  );
  const deleteChat = useCallback((id: string) => historyAction("delete", id), [historyAction]);
  const renameChat = useCallback(
    (id: string, title: string) => {
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === id ? { ...conversation, title, updatedAt: Date.now() } : conversation,
        ),
      );
    },
    [setConversations],
  );
  const toggleChatPin = useCallback(
    (id: string) => {
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                pinned: !conversation.pinned,
                pinnedAt: !conversation.pinned ? Date.now() : undefined,
              }
            : conversation,
        ),
      );
    },
    [setConversations],
  );

  const autoTitle = useCallback(
    (id: string, messages: Message[]) => historyAction("title", { id, messages } as Conversation),
    [historyAction],
  );

  const send = useCallback(
    async (
      text: string,
      atts: PendingAttachment[],
      retryTool?: ComposerToolId | null,
      _retryAttempt = 0,
      retryConversationId?: string,
      retryHistory?: Message[],
      requestId?: string,
      queuedSend?: NextPrompt,
      voiceRequest?: { signal: AbortSignal },
    ) => {
      if (voiceRequest?.signal.aborted) return;
      const trimmed = text.trim();
      if (!principalReady || (!trimmed && atts.length === 0) || inFlightRef.current) return;
      if (!canSendChatHistory(userKey)) {
        toast.error("Chat history is not ready for editing. Check the sync status.");
        return;
      }
      if (
        queuedSend &&
        (!nextPromptMountedRef.current ||
          nextPromptRef.current !== queuedSend ||
          queuedSend.status !== "ready" ||
          !sameNextPromptScope(queuedSend.scope, nextPromptScopeRef.current) ||
          editingMessage)
      )
        return;
      const keptQuotaDrafts = quotaRejectedDraftsRef.current.filter((draft) =>
        sameNextPromptScope(draft.scope, nextPromptScopeRef.current),
      );
      if (keptQuotaDrafts.length >= 3) {
        const reason =
          "Three messages are kept after usage limits. Restore or discard a kept version before sending another message.";
        if (queuedSend) updateNextPrompt(holdNextPrompt(queuedSend, reason));
        toast.error(reason);
        return;
      }
      const clearComposer =
        !voiceRequest &&
        !_retryAttempt &&
        !requestId &&
        (!queuedSend || matchesNextPromptDraft(queuedSend, composerDraftRef.current));
      const requestMode = queuedSend?.mode ?? mode;
      if (queuedSend) updateNextPrompt(null);
      else if (nextPromptRef.current)
        updateNextPrompt(
          holdNextPrompt(
            nextPromptRef.current,
            "Another message or regeneration started. This next message has been kept for you to edit.",
          ),
        );
      updateRequestNotice(null);
      if (_retryAttempt === 0) {
        clearRetryTimer(retryTimerRef);
        // A newer deliberate send makes every older retry callback inert.
        retryGenerationRef.current += 1;
      }
      const requestGeneration = storageGenerationRef.current;
      const requestRetryGeneration = retryGenerationRef.current;
      const requestPrincipal = storagePrincipal;
      const isCurrentRequest = () =>
        requestRetryGeneration === retryGenerationRef.current &&
        requestGeneration === storageGenerationRef.current &&
        requestPrincipal === storagePrincipalRef.current;

      if (_retryAttempt === 0 && !isSignedIn) guestPromptTurnsRef.current += 1;

      const nextConvId = retryConversationId ?? activeId ?? newId();
      // Creating a chat is this request's own transition, not a stale-scope change.
      const requestScope = advanceNextPromptScope(nextPromptScopeRef.current, {
        ...nextPromptScopeRef.current,
        conversationId: nextConvId,
      });
      nextPromptScopeRef.current = requestScope;
      const isCurrentRetryScope = () =>
        nextPromptMountedRef.current &&
        isCurrentRequest() &&
        sameNextPromptScope(requestScope, nextPromptScopeRef.current);
      const existingConversation = nextConvId
        ? conversations.find((conversation) => conversation.id === nextConvId)
        : undefined;
      const isNewConversation = !retryConversationId && !existingConversation;
      const selectedWorkflowSkill = existingConversation?.skill ?? pendingWorkflowSkill;

      const userMsg: Message = {
        id: requestId ?? newId(),
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
      const assistantMsg: Message = {
        id: newId(),
        role: "assistant",
        content: "",
        ...(retryTool ? { requestedTool: retryTool } : {}),
      };

      // Keep the exact submitted draft in this request's mounted scope. Attachment
      // objects/payloads are retained by reference; they are never re-uploaded here.
      const rejectedDraft: NextPrompt = {
        id: userMsg.id,
        scope: requestScope,
        waitingFor: assistantMsg.id,
        text,
        attachments: atts,
        tool: retryTool ?? null,
        mode: requestMode,
        status: "held",
      };
      let clearedComposerRevision: number | null = null;
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
            mode: requestMode,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            temporary: tempChat,
            temporaryContext: tempChat ? tempChatContext : undefined,
            ...(selectedWorkflowSkill ? { skill: selectedWorkflowSkill } : {}),
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
                ...(selectedWorkflowSkill ? { skill: selectedWorkflowSkill } : {}),
                updatedAt: Date.now(),
              }
            : c,
        );
      });
      setActiveId(nextConvId);
      setPendingWorkflowSkill(null);
      if (clearComposer) {
        setInput("");
        setAttachments([]);
        setEditingMessage(null);
        clearedComposerRevision = composerRevisionRef.current;
      }
      const requestComposerRevision = composerRevisionRef.current;
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
      inFlightTargetRef.current = {
        controller,
        conversationId: nextConvId,
        assistantMessageId: assistantMsg.id,
        startedAt: Date.now(),
        flushPendingContent: () => {
          if (assistantFrame !== null) cancelAnimationFrame(assistantFrame);
          flushAssistant();
        },
      };

      const updateAssistantMessage = (update: (message: Message) => Message) => {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === nextConvId
              ? {
                  ...conversation,
                  messages: conversation.messages.map((message) =>
                    message.id === assistantMsg.id ? update(message) : message,
                  ),
                  updatedAt: Date.now(),
                }
              : conversation,
          ),
        );
      };
      const markPendingImage = () =>
        updateAssistantMessage((message) => ({ ...message, pendingImage: true }));

      const cancelVoiceRequest = () => {
        // A close/Stop callback can abort only the generation this session owns.
        const target = inFlightTargetRef.current;
        if (target?.controller !== controller) return;
        if (isCurrentRetryScope()) {
          stopComposerVoiceRequestRef.current();
          return;
        }
        // A chat/owner transition must not clear the destination's tool, queue
        // or request notice. Dispose only this captured generation instead.
        target.flushPendingContent();
        retryGenerationRef.current += 1;
        controller.abort(new DOMException(USER_STOP_REASON, "AbortError"));
        if (abortRef.current === controller) abortRef.current = null;
        inFlightTargetRef.current = null;
        inFlightRef.current = false;
        setIsStreaming(false);
        setConversations((previous) =>
          previous.map((conversation) =>
            conversation.id === nextConvId
              ? {
                  ...conversation,
                  messages: markAssistantStopped(conversation.messages, assistantMsg.id),
                }
              : conversation,
          ),
        );
      };
      voiceRequest?.signal.addEventListener("abort", cancelVoiceRequest, { once: true });
      if (voiceRequest?.signal.aborted) cancelVoiceRequest();

      let assembledReply = "";
      let requestSucceeded = false;
      let waitingForConfirmation = false;

      try {
        const activeTool = retryTool;
        controller.signal.throwIfAborted();
        const {
          createChatHistoryPayload,
          fetchForPrincipal,
          chatRequestProfile,
          withResponsePresentation,
        } = await import("@/lib/chat-summary-snapshot.mjs");
        const authFetch = (input: RequestInfo | URL, init: RequestInit) =>
          fetchForPrincipal(userKey, input, init);
        const historyPayload = await createChatHistoryPayload(
          chatRequestMessages(priorMessages, userMsg),
          Math.min(existingConversation?.memoryStartIndex ?? 0, priorMessages.length),
          {
            principal: userKey,
            chatId: nextConvId,
            temporary: tempChat,
            memoryEnabled: settings.rememberAcross,
            signal: controller.signal,
          },
        );

        const resp = await authFetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": userMsg.id,
          },
          body: JSON.stringify({
            ...historyPayload,
            kova: existingConversation?.kova,
            skill: selectedWorkflowSkill
              ? {
                  installationId: selectedWorkflowSkill.installationId,
                  versionId: selectedWorkflowSkill.versionId,
                }
              : undefined,
            mode: requestMode,
            clientTool: activeTool,
            chatId: nextConvId,
            temporary: tempChat,
            temporaryContext: tempChat ? tempChatContext : undefined,
            user:
              tempChat && tempChatContext === "clean"
                ? undefined
                : withResponsePresentation(chatRequestProfile(settings), settings),
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
          throw await chatResponseError(resp, "Request failed");
        }

        const receiveMemorySources = createMemorySourceUpdater(
          userKey,
          tempChat,
          nextConvId,
          assistantMsg.id,
          isCurrentRequest,
          setConversations,
        );
        await consumeChatSse(resp.body, {
          signal: controller.signal,
          onEvent: (parsed) => {
            if (!isCurrentRequest()) {
              throw new DOMException("A newer chat request replaced this one.", "AbortError");
            }
            const delta = (
              parsed as {
                choices?: Array<{ delta?: Record<string, unknown> }>;
              }
            ).choices?.[0]?.delta;
            receiveMemorySources(delta);
            if (delta?.kind === "web_sources") {
              const sources = normalizeResponseSources(delta.sources);
              updateAssistantMessage((message) => ({
                ...message,
                ...(sources ? { sources } : {}),
              }));
            }
            if (delta?.kind === "image_pending") {
              markPendingImage();
            }

            if (delta?.kind === "activity" && delta?.label) {
              updateAssistantMessage((message) => {
                const activity: Activity = {
                  tool: String(delta.tool ?? ""),
                  label: String(delta.label),
                  status:
                    delta.status === "failed" || delta.status === "canceled"
                      ? delta.status
                      : delta.status === "running" || delta.status === "pending"
                        ? ("running" as const)
                        : ("done" as const),
                };
                const currentActivities = message.activities ?? [];
                const matchingToolIndex = activity.tool
                  ? currentActivities.findIndex((item) => item.tool === activity.tool)
                  : -1;
                const activities =
                  matchingToolIndex >= 0
                    ? currentActivities.map((item, index) =>
                        index === matchingToolIndex ? activity : item,
                      )
                    : currentActivities.some(
                          (item) => item.tool === activity.tool && item.label === activity.label,
                        )
                      ? currentActivities
                      : [...currentActivities, activity];
                return { ...message, activities };
              });
            }
            if (delta?.kind === "tool_confirm" && delta?.action_id) {
              waitingForConfirmation = true;
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
            if (typeof delta?.content === "string" && delta.content) {
              assembledReply += delta.content;
              updateAssistant(delta.content);
            }
          },
        });
        if (assistantFrame !== null) cancelAnimationFrame(assistantFrame);
        flushAssistant();
        requestSucceeded = !controller.signal.aborted && !waitingForConfirmation;
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
        updateNextPrompt(settleNextPrompt(nextPromptRef.current, assistantMsg.id, false));
        if ((e as Error).name === "AbortError") {
          const stoppedByUser = controller.signal.reason?.message === USER_STOP_REASON;
          if (!assembledReply.trim() && !stoppedByUser) {
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
          const err = e as Error & {
            requestId?: string;
            category?: string;
            retryable?: boolean;
            status?: number;
            code?: string;
            retryAfter?: number;
          };
          const raw = err.message || "Something went wrong";
          const quotaRejected =
            err.status === 429 && (/limit/i.test(raw) || err.category === "quota_exceeded");
          if (quotaRejected && isCurrentRetryScope()) {
            if (
              clearedComposerRevision !== null &&
              clearedComposerRevision === composerRevisionRef.current
            ) {
              setInput(rejectedDraft.text);
              setAttachments(rejectedDraft.attachments);
              setSelectedTool(rejectedDraft.tool);
            } else {
              // Later typing (including typing then clearing) always wins. Keep
              // the rejected version separate for deliberate, non-sending recovery.
              if (!quotaRejectedDraftsRef.current.some((draft) => draft.id === rejectedDraft.id))
                updateQuotaRejectedDrafts([
                  ...quotaRejectedDraftsRef.current.filter((draft) =>
                    sameNextPromptScope(draft.scope, requestScope),
                  ),
                  rejectedDraft,
                ]);
            }
            const kind: "image" | "chat" | "upload" = /image/i.test(raw)
              ? "image"
              : /upload|file/i.test(raw)
                ? "upload"
                : "chat";
            setLimitDialog({ open: true, kind, message: raw });
          }
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
          const sessionExpired = err.status === 401 || err.code === "authentication_required";
          const canManualRetry =
            !quotaRejected &&
            !sessionExpired &&
            err.status !== 403 &&
            err.retryable !== false &&
            (err.retryable === true || retryableCategory);
          const failedResponseKey = JSON.stringify([requestPrincipal, nextConvId, assistantMsg.id]);
          if (canManualRetry) retryableFailedResponsesRef.current.add(failedResponseKey);
          else retryableFailedResponsesRef.current.delete(failedResponseKey);
          updateAssistantMessage((message) => ({ ...message, generationStatus: "failed" }));

          // A failed transport/stream may already have generated billable output.
          // Keep the partial response and require an explicit Retry action;
          // silently replaying with a new message ID can duplicate generation.
          const requestId = err.requestId;
          const friendly = sessionExpired
            ? isSignedIn
              ? "Your session could not be verified. Sign in again to continue."
              : "Sign in is required for this request."
            : !canManualRetry
              ? raw
              : category === "rate_limit"
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

          const retryActionEpoch = retryActionEpochRef.current.get(nextConvId) ?? 0;
          if (sessionExpired && isCurrentRetryScope())
            updateRequestNotice({
              scope: requestScope,
              kind: "session-expired",
              signedIn: isSignedIn,
            });
          if (isCurrentRetryScope())
            toast.error(friendly, {
              description: requestId ? `Reference ID: ${requestId}` : undefined,
              action: canManualRetry
                ? {
                    label: "Retry",
                    onClick: () => {
                      if (
                        !isCurrentRetryScope() ||
                        activeIdRef.current !== nextConvId ||
                        inFlightRef.current ||
                        retryTimerRef.current !== null
                      )
                        return;
                      if ((retryActionEpochRef.current.get(nextConvId) ?? 0) !== retryActionEpoch) {
                        return;
                      }
                      // A retry toast is single-use. This also makes older toasts for
                      // the same conversation inert once a newer retry is scheduled.
                      retryActionEpochRef.current.set(nextConvId, retryActionEpoch + 1);
                      retryTimerRef.current = window.setTimeout(() => {
                        if (!isCurrentRetryScope() || activeIdRef.current !== nextConvId) return;
                        retryTimerRef.current = null;
                        send(text, atts, retryTool, 0, nextConvId, priorMessages, userMsg.id);
                      }, 100);
                    },
                  }
                : undefined,
            });
          updateAssistant(`\n\n_${detail}_`);
        }
      } finally {
        voiceRequest?.signal.removeEventListener("abort", cancelVoiceRequest);
        if (isCurrentRequest()) {
          setIsStreaming(false);
          if (
            isCurrentRetryScope() &&
            composerRevisionRef.current === requestComposerRevision &&
            !composerDraftRef.current.text &&
            !composerDraftRef.current.attachments.length &&
            composerDraftRef.current.tool === (retryTool ?? null)
          )
            setSelectedTool(null);
          if (abortRef.current === controller) abortRef.current = null;
          if (inFlightTargetRef.current?.controller === controller)
            inFlightTargetRef.current = null;
          inFlightRef.current = false;
          updateNextPrompt(
            settleNextPrompt(nextPromptRef.current, assistantMsg.id, requestSucceeded),
          );
        }
      }
      if (
        voiceRequest &&
        requestSucceeded &&
        assembledReply.trim() &&
        userKey &&
        !voiceRequest.signal.aborted &&
        isCurrentRetryScope()
      ) {
        // Exact IDs from this request, never a generic latest-assistant lookup.
        return {
          ownerId: userKey,
          chatId: nextConvId,
          messageId: assistantMsg.id,
          content: assembledReply,
        };
      }
    },
    [
      activeId,
      conversations,
      mode,
      autoTitle,
      settings,
      tempChat,
      tempChatContext,
      editingMessage,
      principalReady,
      setConversations,
      storagePrincipal,
      isLoaded,
      isSignedIn,
      userKey,
      pendingWorkflowSkill,
      updateNextPrompt,
      updateRequestNotice,
      updateQuotaRejectedDrafts,
      setInput,
      setAttachments,
      setSelectedTool,
    ],
  );

  const scheduleNextPromptFocus = useCallback(
    (
      trigger: HTMLButtonElement | null | undefined,
      destination: "queued" | "composer",
      expectedNext: NextPrompt | null,
    ) => {
      nextPromptFocusCleanupRef.current?.();
      if (!trigger || typeof document === "undefined") return;
      const composer = trigger.closest<HTMLElement>(".spec400-chat-input");
      if (!composer) return;
      const scope = nextPromptScopeRef.current;
      const openedUrl = window.location.href;
      const previousFocus = document.activeElement;
      let interrupted = false;
      const onInteraction = () => {
        interrupted = true;
      };
      for (const type of ["pointerdown", "keydown", "focusin"])
        document.addEventListener(type, onInteraction, true);
      window.addEventListener("blur", onInteraction);
      const cleanup = () => {
        window.cancelAnimationFrame(frame);
        for (const type of ["pointerdown", "keydown", "focusin"])
          document.removeEventListener(type, onInteraction, true);
        window.removeEventListener("blur", onInteraction);
        if (nextPromptFocusCleanupRef.current === cleanup) nextPromptFocusCleanupRef.current = null;
      };
      const frame = window.requestAnimationFrame(() => {
        const ownsFocus = nextPromptFocusCleanupRef.current === cleanup;
        cleanup();
        if (
          !ownsFocus ||
          interrupted ||
          !nextPromptMountedRef.current ||
          !composer.isConnected ||
          nextPromptRef.current !== expectedNext ||
          !sameNextPromptScope(scope, nextPromptScopeRef.current) ||
          (document.activeElement !== previousFocus &&
            document.activeElement !== trigger &&
            document.activeElement !== document.body)
        )
          return;
        const target = composer.querySelector<HTMLElement>(
          destination === "queued"
            ? "[data-next-prompt-cancel]"
            : 'textarea[aria-label="Message KovaGPT"]',
        );
        restoreDialogFocus(target, openedUrl);
      });
      nextPromptFocusCleanupRef.current = cleanup;
    },
    [],
  );

  const queueNextPrompt = (
    tool?: ComposerToolId | null,
    trigger?: HTMLButtonElement | null,
  ): boolean => {
    const target = inFlightTargetRef.current;
    if (
      !principalReady ||
      !sameNextPromptScope(nextPromptScope, nextPromptScopeRef.current) ||
      !nextPromptMountedRef.current ||
      !target ||
      !inFlightRef.current ||
      target.conversationId !== activeId ||
      target.controller.signal.aborted ||
      editingMessage ||
      nextPromptRef.current ||
      (!input.trim() && !attachments.length) ||
      hasPendingChatAttachments(attachments) ||
      attachments.some((file) => file.status === "failed") ||
      (!isSignedIn && (attachments.length > 0 || tool === "image"))
    )
      return false;
    const next = snapshotNextPrompt({
      id: newId(),
      scope: nextPromptScopeRef.current,
      waitingFor: target.assistantMessageId,
      text: input,
      attachments,
      tool: tool ?? null,
      mode,
    });
    updateNextPrompt(next);
    scheduleNextPromptFocus(trigger, "queued", next);
    return true;
  };
  useEffect(() => {
    const next = nextPromptRef.current;
    if (!next || next.status !== "ready" || isStreaming || inFlightRef.current) return;
    if (
      !nextPromptMountedRef.current ||
      !principalReady ||
      !sameNextPromptScope(next.scope, nextPromptScopeRef.current) ||
      editingMessage
    ) {
      updateNextPrompt(
        holdNextPrompt(next, "The conversation changed. Edit this message before sending it."),
      );
      return;
    }
    if (retryTimerRef.current !== null || !canWriteChatHistory(userKey)) {
      updateNextPrompt(
        holdNextPrompt(
          next,
          "Chat is not ready to send. This message has been kept for you to edit.",
        ),
      );
      return;
    }
    void send(
      next.text,
      next.attachments,
      next.tool,
      0,
      next.scope.conversationId ?? undefined,
      undefined,
      undefined,
      next,
    );
  }, [nextPrompt, isStreaming, principalReady, editingMessage, send, userKey, updateNextPrompt]);

  const stop = useCallback(() => {
    updateRequestNotice(null);
    updateNextPrompt(
      holdNextPrompt(
        nextPromptRef.current,
        "Generation stopped. This next message has not been sent.",
      ),
    );
    clearRetryTimer(retryTimerRef);
    const target = inFlightTargetRef.current;
    target?.flushPendingContent();
    // Preflight work may not observe AbortSignal immediately. Invalidate the old
    // closure before exposing Retry so its catch/finally cannot clear a replacement.
    retryGenerationRef.current += 1;
    target?.controller.abort(new DOMException(USER_STOP_REASON, "AbortError"));
    abortRef.current = null;
    inFlightTargetRef.current = null;
    inFlightRef.current = false;
    setIsStreaming(false);
    if (!composerDraftRef.current.text && !composerDraftRef.current.attachments.length)
      setSelectedTool(null);
    if (!target) return;
    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== target.conversationId) return conversation;
        return {
          ...conversation,
          messages: markAssistantStopped(conversation.messages, target.assistantMessageId),
        };
      }),
    );
  }, [setConversations, updateNextPrompt, updateRequestNotice, setSelectedTool]);

  stopComposerVoiceRequestRef.current = stop;
  const submitComposerVoiceTurn = async (
    text: string,
    signal: AbortSignal,
  ): Promise<ComposerVoiceTurn> => {
    const session = composerVoiceSessionRef.current;
    let requestEpoch: number | null = null;
    const isCurrent = () =>
      Boolean(
        session &&
        session.mode === "voice" &&
        composerVoiceSessionRef.current === session &&
        session.ownerId === userKey &&
        session.scope.principal === storagePrincipalRef.current &&
        session.generation === storageGenerationRef.current &&
        (requestEpoch === null || requestEpoch === retryGenerationRef.current) &&
        nextPromptMountedRef.current &&
        sameNextPromptScope(session.scope, nextPromptScopeRef.current) &&
        !signal.aborted,
      );
    if (!composerVoiceEligible || !isCurrent() || inFlightRef.current || nextPromptRef.current)
      throw new Error("voice_turn_cancelled");
    const pending = send(text, [], null, 0, undefined, undefined, undefined, undefined, { signal });
    requestEpoch = retryGenerationRef.current;
    const turn = await pending;
    if (!isCurrent()) throw new DOMException("Voice turn cancelled", "AbortError");
    if (!turn) throw new Error("voice_chat_failed");
    const { awaitSavedComposerVoiceTurn } = await import("@/lib/composer-voice-turn");
    if (!isCurrent()) throw new DOMException("Voice turn cancelled", "AbortError");
    return awaitSavedComposerVoiceTurn({
      turn,
      signal,
      isCurrent,
      getConversations: () => voiceConversationsRef.current,
      saveConversations: (items) => saveConversations(turn.ownerId, items),
      loadHistoryState: () => loadChatHistoryDevice(turn.ownerId),
      subscribeHistory: (notify) => {
        const changed = (event: Event) => {
          if ((event as CustomEvent).detail?.ownerId === turn.ownerId) notify();
        };
        window.addEventListener(CHAT_HISTORY_CHANGED_EVENT, changed);
        return () => window.removeEventListener(CHAT_HISTORY_CHANGED_EVENT, changed);
      },
    });
  };

  const requestStatusPanel = (hasPendingMessage: boolean) =>
    visibleRequestNotice ? (
      <section
        className="mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
        role="status"
        data-testid="chat-request-status"
      >
        <>
          <p>
            {visibleRequestNotice.signedIn
              ? "Your session could not be verified. Sign in again to continue."
              : "Sign in is required for this request."}{" "}
            Signing in does not resend a message. It may change the current account.
          </p>
          {(hasPendingMessage || Boolean(nextPromptRef.current)) && (
            <p>
              Save or copy your current message and attachments, then clear them before signing in.
              Cancel or save any next message too. Drafts are not transferred between accounts.
            </p>
          )}
          <SignInButton mode="modal">
            <button
              type="button"
              disabled={hasPendingMessage || Boolean(nextPromptRef.current)}
              className="min-h-11 rounded-lg border px-3 font-medium disabled:opacity-50"
              onClick={(event) => {
                if (
                  !nextPromptMountedRef.current ||
                  requestNoticeRef.current !== visibleRequestNotice ||
                  hasPendingMessage ||
                  Boolean(
                    composerDraftRef.current.text.length ||
                    composerDraftRef.current.attachments.length,
                  ) ||
                  Boolean(nextPromptRef.current) ||
                  !sameNextPromptScope(visibleRequestNotice.scope, nextPromptScopeRef.current)
                )
                  event.preventDefault();
              }}
            >
              Sign in
            </button>
          </SignInButton>
        </>
      </section>
    ) : null;
  const visibleNextPrompt =
    principalReady && nextPrompt?.scope.principal === storagePrincipal ? nextPrompt : null;
  const nextPromptInCurrentChat = Boolean(
    visibleNextPrompt && sameNextPromptContext(visibleNextPrompt.scope, nextPromptScope),
  );
  const canEditNextPrompt = Boolean(
    visibleNextPrompt &&
    nextPromptInCurrentChat &&
    !editingMessage &&
    ((!input && !attachments.length) ||
      matchesNextPromptDraft(visibleNextPrompt, composerDraftRef.current)),
  );
  const nextPromptPanel = visibleNextPrompt ? (
    <section
      aria-label="Next message"
      className="mx-3 mb-3 space-y-2 rounded-lg border p-3 text-sm"
      data-testid="next-prompt-panel"
    >
      <p role="status" className="font-medium">
        {visibleNextPrompt.status === "held"
          ? "Next message kept, not queued"
          : "Next message queued"}
      </p>
      <p className="whitespace-pre-wrap break-words max-h-32 overflow-auto">
        {visibleNextPrompt.text || "Attached material"}
      </p>
      {visibleNextPrompt.attachments.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {visibleNextPrompt.attachments.map((file) => file.name).join(", ")}
        </p>
      )}
      {visibleNextPrompt.tool && (
        <p className="text-xs text-muted-foreground">Tool: {visibleNextPrompt.tool}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {visibleNextPrompt.reason ??
          "Only this version will be sent after the current response finishes. Later edits stay in your draft. Kept in this tab only."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-md border px-3"
          data-next-prompt-cancel
          onClick={(event) => {
            if (
              nextPromptRef.current === visibleNextPrompt &&
              storagePrincipalRef.current === visibleNextPrompt.scope.principal
            ) {
              updateNextPrompt(null);
              scheduleNextPromptFocus(event?.currentTarget, "composer", null);
            }
          }}
        >
          Cancel next message
        </button>
        {nextPromptInCurrentChat ? (
          <button
            type="button"
            className="min-h-11 rounded-md border px-3 disabled:opacity-50"
            disabled={!canEditNextPrompt}
            onClick={() => {
              if (
                !canEditNextPrompt ||
                nextPromptRef.current !== visibleNextPrompt ||
                !sameNextPromptContext(visibleNextPrompt.scope, nextPromptScopeRef.current)
              )
                return;
              setInput(visibleNextPrompt.text);
              setAttachments(visibleNextPrompt.attachments.map((file) => ({ ...file })));
              setSelectedTool(visibleNextPrompt.tool);
              updateNextPrompt(null);
            }}
          >
            Edit next message
          </button>
        ) : (
          <button
            type="button"
            className="min-h-11 rounded-md border px-3"
            onClick={() => {
              if (
                storagePrincipalRef.current === visibleNextPrompt.scope.principal &&
                visibleNextPrompt.scope.conversationId &&
                conversations.some((chat) => chat.id === visibleNextPrompt.scope.conversationId)
              )
                setActiveId(visibleNextPrompt.scope.conversationId);
            }}
          >
            Open original chat
          </button>
        )}
      </div>
      {nextPromptInCurrentChat && !canEditNextPrompt && (
        <p className="text-xs text-muted-foreground">
          Keep or clear your newer draft before editing this saved version.
        </p>
      )}
    </section>
  ) : undefined;

  const visibleQuotaRejectedDrafts = principalReady
    ? quotaRejectedDrafts.filter((draft) => sameNextPromptScope(draft.scope, nextPromptScope))
    : [];
  const quotaRejectedDraftPanel = visibleQuotaRejectedDrafts.map((draft) => (
    <section
      key={draft.id}
      aria-label="Message kept after usage limit"
      className="mx-3 mb-3 space-y-2 rounded-lg border p-3 text-sm"
      data-testid="quota-rejected-draft"
    >
      <Suspense fallback={null}>
        <QuotaRejectedDraftPreview draft={draft} />
      </Suspense>
      <button
        type="button"
        className="min-h-11 rounded-md border px-3 disabled:opacity-50"
        disabled={Boolean(
          input || attachments.length || selectedTool || isStreaming || editingMessage,
        )}
        onClick={(event) => {
          if (
            !nextPromptMountedRef.current ||
            !quotaRejectedDraftsRef.current.includes(draft) ||
            !sameNextPromptScope(draft.scope, nextPromptScopeRef.current) ||
            storagePrincipalRef.current !== draft.scope.principal ||
            inFlightRef.current ||
            retryTimerRef.current !== null ||
            editingMessage ||
            composerDraftRef.current.text ||
            composerDraftRef.current.attachments.length ||
            composerDraftRef.current.tool
          )
            return;
          setInput(draft.text);
          setAttachments(draft.attachments);
          setSelectedTool(draft.tool);
          updateQuotaRejectedDrafts(
            quotaRejectedDraftsRef.current.filter((item) => item !== draft),
          );
          scheduleNextPromptFocus(event.currentTarget, "composer", nextPromptRef.current);
        }}
      >
        Restore message
      </button>
      <button
        type="button"
        className="min-h-11 rounded-md border px-3"
        onClick={(event) => {
          if (
            !nextPromptMountedRef.current ||
            !quotaRejectedDraftsRef.current.includes(draft) ||
            !sameNextPromptScope(draft.scope, nextPromptScopeRef.current) ||
            storagePrincipalRef.current !== draft.scope.principal
          )
            return;
          updateQuotaRejectedDrafts(
            quotaRejectedDraftsRef.current.filter((item) => item !== draft),
          );
          scheduleNextPromptFocus(event.currentTarget, "composer", nextPromptRef.current);
        }}
      >
        Discard kept version
      </button>
    </section>
  ));

  const composerPromptPanel = quotaRejectedDraftPanel.length ? (
    <>
      {quotaRejectedDraftPanel}
      {nextPromptPanel}
    </>
  ) : (
    nextPromptPanel
  );

  // Image generation removed; can be reintroduced when user explicitly asks.

  const renderTranscriptMessage: TranscriptMessageRenderer = (m, i, ChatMessage, onBranch) => {
    if (!active) return null;
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
        onSaveMemory={
          canReviewMemory && m.role === "assistant"
            ? (trigger) => {
                if (!userKey || !active || !canReviewMemory) return;
                setReviewedMemoryTarget({
                  ownerId: userKey,
                  generation: storageGenerationRef.current,
                  conversation: active,
                  trigger,
                  url: window.location.href,
                });
              }
            : undefined
        }
        onOpenResult={openResult}
        onOpenCanvas={(widget, trigger, sourceKey) =>
          openResult(
            {
              title: widget.title,
              initialContent: JSON.stringify(widget, null, 2),
              kind: "writing",
              initialMode: "edit",
              widget,
              canvasSourceKey: sourceKey,
              chatId: null,
              messageId: null,
              projectId: null,
            },
            trigger,
          )
        }
        onSelectSuggestion={
          isLastAssistant && !isStreaming
            ? (suggestion) => prepareResponseDraft(suggestion)?.()
            : undefined
        }
        temporary={Boolean(active.temporary)}
        onReplaceContent={
          m.role === "assistant" && !isStreaming
            ? (messageId, next) => replaceMessageContent(active.id, messageId, next)
            : undefined
        }
        userKey={userKey}
        principalResolved={isLoaded}
        streaming={isStreaming && isLastAssistant}
        streamingStartedAt={
          isStreaming &&
          isLastAssistant &&
          inFlightTargetRef.current?.conversationId === active.id &&
          inFlightTargetRef.current.assistantMessageId === m.id
            ? inFlightTargetRef.current.startedAt
            : undefined
        }
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
        onDraftPrompt={isLastAssistant && !isStreaming ? prepareResponseDraft : undefined}
        onFollowUp={isLastAssistant && !isStreaming ? (prompt) => send(prompt, []) : undefined}
        onEdit={
          m.role === "user" && !isStreaming
            ? () => {
                if (hasPendingChatAttachments(attachments)) {
                  toast.message("Wait for attachments to finish before editing a previous prompt.");
                  return;
                }
                setInput(m.content);
                setAttachments(pendingMessageAttachments(m.attachments));
                setEditingMessage((previous) =>
                  beginChatEdit(previous, storagePrincipal, active.id, m.id, input, attachments),
                );
                window.setTimeout(
                  () =>
                    document
                      .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message KovaGPT"]')
                      ?.focus(),
                  0,
                );
              }
            : undefined
        }
        onRetry={
          isLastAssistant &&
          !isStreaming &&
          retryTimerRef.current === null &&
          priorUser &&
          (m.generationStatus !== "failed" ||
            retryableFailedResponsesRef.current.has(
              JSON.stringify([storagePrincipal, active.id, m.id]),
            ))
            ? () => {
                if (
                  !nextPromptMountedRef.current ||
                  !sameNextPromptScope(nextPromptScope, nextPromptScopeRef.current)
                )
                  return;
                const retryHistory = active.messages.slice(0, -2);
                send(
                  priorUser.content,
                  pendingMessageAttachments(priorUser.attachments),
                  m.requestedTool ?? null,
                  0,
                  active.id,
                  retryHistory,
                  m.generationStatus === "failed" ? priorUser.id : undefined,
                );
              }
            : undefined
        }
        onBranch={onBranch}
      />
    );
  };

  const conversationActions = (compact = false) =>
    active && chatStarted ? (
      <Suspense fallback={null}>
        <ConversationHeaderActions
          key={`${storagePrincipal}:${active.id}:${compact}`}
          conversation={active}
          signedIn={Boolean(isLoaded && isSignedIn)}
          userTier={tier}
          compact={compact}
          isStreaming={isStreaming}
          navigationBlocked={Boolean(input || attachments.length || isStreaming)}
          onShare={(trigger) => {
            shareReturnFocusRef.current = trigger;
            shareReturnUrlRef.current = window.location.href;
            setShareChatId(active.id);
          }}
          onRename={(title) => renameChat(active.id, title)}
          onTogglePin={() => toggleChatPin(active.id)}
          onArchive={() => historyAction("archive", active.id)}
          onDelete={() => deleteChat(active.id)}
          onOpenContext={(trigger) =>
            window.dispatchEvent(
              new CustomEvent("kova-open-message-context", { detail: { trigger } }),
            )
          }
          onManagePlugins={(trigger) => {
            openSettings("linked");
            settingsReturnFocusRef.current = trigger;
          }}
        />
      </Suspense>
    ) : null;

  return (
    <div
      className="kova-assistant flex h-screen w-full overflow-hidden bg-[var(--surface-workspace)] text-foreground"
      data-ui="modern"
      style={{ height: "100dvh" }}
    >
      <p className="sr-only" aria-live="polite">
        {streamAnnouncement}
      </p>
      <Sidebar
        conversations={historyConversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newChat}
        onDelete={deleteChat}
        onRename={renameChat}
        open={sidebarOpen}
        onToggle={() => {
          readingAnchorControllerRef.current?.capture();
          setSidebarOpen((v) => !v);
        }}
        onOpenSettings={openSettings}
        onOpenHelp={openHelp}
        onOpenWorkspaceSearch={openCommandPalette}
        mapsReleaseApproved={MAPS_RELEASE_APPROVED}
        onShare={(id) => {
          if (!isSignedIn) {
            toast.message("Sign in to share chats");
            openSignUp();
            return;
          }
          shareReturnFocusRef.current = null;
          shareReturnUrlRef.current = undefined;
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
        onArchive={(id) => historyAction("archive", id)}
        onTogglePin={toggleChatPin}
      />

      <main
        id="main-content"
        tabIndex={-1}
        data-sidebar={sidebarOpen ? "open" : "closed"}
        className="kova-chat-main flex min-w-0 flex-1 flex-col bg-background"
      >
        <MobileTopBar
          onOpenSidebar={() => {
            readingAnchorControllerRef.current?.capture();
            setSidebarOpen(true);
          }}
          onNewChat={newChat}
          title={active?.title}
          mode={mode}
          onModeChange={active?.kova ? undefined : setMode}
          userTier={tier}
          temporaryChat={tempChat}
          chatStarted={chatStarted}
          conversationActions={conversationActions(true)}
          onTemporaryChatChange={(enabled, trigger) => {
            temporaryTriggerRef.current = trigger;
            temporaryReturnUrlRef.current = window.location.href;
            setTemporaryChatEnabled(enabled);
          }}
          onOpenChatSettings={active ? openChatWorkspace : undefined}
          chatRulesActive={chatRulesActive}
          skill={
            selectedWorkflowSkill
              ? {
                  name: selectedWorkflowSkill.name,
                  clear: clearWorkflowSkill,
                  disabled: isStreaming,
                }
              : undefined
          }
        />
        <header className="kova-topbar kova-desktop-topbar relative hidden h-[56px] items-center gap-1 px-4 lg:flex">
          <div
            hidden={sidebarOpen || Boolean(isSignedIn)}
            className="flex items-center gap-1 mr-2 shrink-0"
          >
            <button
              onClick={(event) => {
                readingAnchorControllerRef.current?.capture();
                sidebarKeyboardTriggerRef.current = event.detail === 0 ? event.currentTarget : null;
                setSidebarOpen(true);
              }}
              className="kova-topbar-button kova-sidebar-toggle shrink-0 rounded-xl p-2 transition"
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center min-w-0 flex-1 relative">
            <div className="spec400-chat-title">
              {chatStarted ? active?.title || "Chat" : sidebarOpen ? "" : "Kova GPT"}
            </div>
            {selectedWorkflowSkill ? (
              <button
                type="button"
                onClick={clearWorkflowSkill}
                disabled={isStreaming}
                className="ml-2 max-w-56 truncate rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`Clear workflow skill ${selectedWorkflowSkill.name}`}
                title="Clear skill"
              >
                {selectedWorkflowSkill.name} ×
              </button>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {conversationActions()}
            {isLoaded && isSignedIn && !chatStarted && (
              <Suspense fallback={<span className="h-9 w-9" aria-hidden="true" />}>
                <TemporaryChatToggle
                  enabled={tempChat}
                  confirmed={tempChatConfirmed}
                  onToggle={(trigger) => {
                    temporaryTriggerRef.current = trigger;
                    temporaryReturnUrlRef.current = window.location.href;
                    setTemporaryChatEnabled(!tempChat);
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

        {tempChat && chatStarted ? (
          <p
            className="mx-auto my-2 max-w-3xl px-4 text-center text-xs text-muted-foreground"
            role="status"
          >
            Temporary chat. Start a new chat to change this setting.
          </p>
        ) : tempChat ? (
          <Suspense fallback={null}>
            <TemporaryChatBanner
              tempChatContext={tempChatContext}
              canSave={Boolean(
                active?.temporary && active.messages.length > 0 && retryTimerRef.current === null,
              )}
              isStreaming={isStreaming}
              onSave={saveTemporaryChat}
              onTurnOff={() => setTemporaryChatEnabled(false)}
            />
          </Suspense>
        ) : null}

        {Boolean(userKey || active?.messages.length) && (
          <Suspense fallback={null}>
            <ChatWorkspaceControls ownerId={userKey} active={active} temporary={tempChat} />
          </Suspense>
        )}
        <div
          ref={workspaceRef}
          className={`spec400-chat-workspace${result ? " has-result" : ""}`}
          data-split={Boolean(result && wideResult)}
          style={
            result && wideResult
              ? {
                  gridTemplateColumns: `minmax(420px, ${paneRatio}fr) 12px minmax(420px, ${1 - paneRatio}fr)`,
                }
              : undefined
          }
        >
          {result && !wideResult && (
            <div className="spec400-result-tabs" role="tablist" aria-label="Chat workspace">
              <button
                type="button"
                role="tab"
                id="conversation-tab"
                aria-controls="conversation-pane"
                aria-selected={resultTab === "conversation"}
                onClick={() => setResultTab("conversation")}
              >
                Conversation
              </button>
              <button
                type="button"
                role="tab"
                id="result-tab"
                aria-controls="result-pane"
                aria-selected={resultTab === "result"}
                onClick={() => setResultTab("result")}
              >
                Result
              </button>
            </div>
          )}
          <div
            id="conversation-pane"
            tabIndex={-1}
            aria-label="Conversation"
            className="spec400-conversation-pane"
            hidden={Boolean(result && !wideResult && resultTab !== "conversation")}
            role={result && !wideResult ? "tabpanel" : "region"}
            aria-labelledby={result && !wideResult ? "conversation-tab" : undefined}
          >
            {!active || (active.messages.length === 0 && composerVoiceMode !== "voice") ? (
              <section
                className="kova-empty-chat flex flex-1 flex-col overflow-y-auto px-3 lg:px-6"
                aria-labelledby="chat-greeting"
              >
                <div className="kova-empty-chat-content flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10">
                  <div className="kova-greeting mb-5 flex animate-fade-in flex-col items-center gap-3 lg:mb-6">
                    <p className="kova-home-eyebrow">Your space to think</p>
                    <h1
                      id="chat-greeting"
                      className="text-balance px-4 text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.035em] text-foreground lg:text-[36px]"
                    >
                      {greeting}
                    </h1>
                  </div>

                  <div className="kova-empty-composer">
                    <ChatInput
                      value={principalReady ? input : ""}
                      onChange={setInput}
                      onSubmit={(tool) => send(input, attachments, tool)}
                      onStop={stop}
                      onSendNext={queueNextPrompt}
                      sendNextDisabled={Boolean(visibleNextPrompt) || Boolean(editingMessage)}
                      nextPromptPanel={composerPromptPanel}
                      requestStatusPanel={requestStatusPanel}
                      isStreaming={isStreaming}
                      voiceMode={composerVoiceMode}
                      onVoiceModeChange={changeComposerVoiceMode}
                      onVoiceSubmit={composerVoiceEligible ? submitComposerVoiceTurn : undefined}
                      latestAssistantText={
                        active?.messages
                          .filter(
                            (message) =>
                              message.role === "assistant" &&
                              !message.generationStatus &&
                              !message.pendingImage,
                          )
                          .at(-1)?.content
                      }
                      disabled={!principalReady}
                      sendDisabled={!historyReady}
                      saveAttachmentsToLibrary={principalReady && !tempChat}
                      attachments={principalReady ? attachments : []}
                      onAttachmentsChange={setAttachments}
                      attachmentContext={JSON.stringify([
                        storagePrincipal,
                        activeId,
                        editingMessage?.messageId ?? null,
                      ])}
                      mode={mode}
                      onModeChange={active?.kova ? undefined : setMode}
                      userTier={tier}
                      canChangeAgent={!active?.kova}
                      showModelStatus
                      showChooseProject
                      savedConversations={userKey && principalReady ? conversations : []}
                      onOpenChatContext={active ? openChatWorkspace : undefined}
                      chatRulesActive={chatRulesActive}
                      onUploadLimit={() => setLimitDialog({ open: true, kind: "upload" })}
                      placeholder="Describe what you need…"
                      responseSettings={settings}
                      onResponseSettingsChange={(change) =>
                        setSettings((previous) => ({ ...previous, ...change }))
                      }
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
                  <Suspense fallback={<div aria-hidden="true" className="h-11 w-full" />}>
                    <HomeChatStarters setInput={setInput} />
                  </Suspense>
                  {isLoaded && isSignedIn && historyConversations.length > 0 ? (
                    <section
                      className="spec400-recent-work"
                      aria-labelledby="continue-working-heading"
                    >
                      <h2 id="continue-working-heading">Continue working</h2>
                      <ul>
                        {[...historyConversations]
                          .sort((a, b) => b.updatedAt - a.updatedAt)
                          .slice(0, 3)
                          .map((conversation) => (
                            <li key={conversation.id}>
                              <button type="button" onClick={() => setActiveId(conversation.id)}>
                                <strong>{conversation.title}</strong>
                                <time dateTime={new Date(conversation.updatedAt).toISOString()}>
                                  Updated{" "}
                                  {new Date(conversation.updatedAt).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </time>
                              </button>
                            </li>
                          ))}
                      </ul>
                    </section>
                  ) : isLoaded ? (
                    <p className="spec400-capability-note">
                      Write drafts, explore ideas, and compare options.{" "}
                      {isSignedIn
                        ? "Attach a file to work with its contents."
                        : "Sign in to attach files and keep your work together."}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : (
              <>
                <Suspense fallback={null}>
                  <ActiveChatTranscript
                    key={transcriptScope}
                    active={active}
                    conversations={conversations}
                    setActiveId={setActiveId}
                    setConversations={setConversations}
                    isSignedIn={Boolean(isSignedIn)}
                    isStreaming={isStreaming}
                    chatRulesActive={chatRulesActive}
                    openChatWorkspace={openChatWorkspace}
                    scrollRef={scrollRef}
                    nearBottomRef={nearBottomRef}
                    readingAnchorControllerRef={readingAnchorControllerRef}
                    transcriptScope={transcriptScope}
                    transcriptScopeRef={transcriptScopeRef}
                    setShowJumpToLatest={setShowJumpToLatest}
                    renderMessage={renderTranscriptMessage}
                  />
                </Suspense>
                <div className="spec400-composer-dock relative shrink-0 lg:pb-2 lg:pt-2">
                  {showJumpToLatest && (
                    <button
                      type="button"
                      onClick={() => {
                        const el = scrollRef.current;
                        if (!el) return;
                        nearBottomRef.current = true;
                        readingAnchorControllerRef.current?.followEnd();
                        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                        setShowJumpToLatest(false);
                      }}
                      className="absolute bottom-full left-1/2 z-20 mb-2 min-h-11 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Jump to latest message"
                    >
                      Jump to latest
                    </button>
                  )}
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
                          const restored = restoreChatEditDraft(
                            editingMessage,
                            storagePrincipal,
                            active.id,
                          );
                          setEditingMessage(null);
                          setInput(restored?.text ?? "");
                          setAttachments(restored?.attachments ?? []);
                          window.requestAnimationFrame(() =>
                            document
                              .querySelector<HTMLTextAreaElement>(
                                'textarea[aria-label="Message KovaGPT"]',
                              )
                              ?.focus(),
                          );
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <ChatInput
                    value={principalReady ? input : ""}
                    onChange={setInput}
                    onSubmit={(tool) => send(input, attachments, tool)}
                    onStop={stop}
                    onSendNext={queueNextPrompt}
                    sendNextDisabled={Boolean(visibleNextPrompt) || Boolean(editingMessage)}
                    nextPromptPanel={composerPromptPanel}
                    requestStatusPanel={requestStatusPanel}
                    isStreaming={isStreaming}
                    voiceMode={composerVoiceMode}
                    onVoiceModeChange={changeComposerVoiceMode}
                    onVoiceSubmit={composerVoiceEligible ? submitComposerVoiceTurn : undefined}
                    latestAssistantText={
                      active?.messages
                        .filter(
                          (message) =>
                            message.role === "assistant" &&
                            !message.generationStatus &&
                            !message.pendingImage,
                        )
                        .at(-1)?.content
                    }
                    disabled={!principalReady}
                    sendDisabled={!historyReady}
                    saveAttachmentsToLibrary={principalReady && !tempChat}
                    attachments={principalReady ? attachments : []}
                    onAttachmentsChange={setAttachments}
                    attachmentContext={JSON.stringify([
                      storagePrincipal,
                      activeId,
                      editingMessage?.messageId ?? null,
                    ])}
                    mode={mode}
                    onModeChange={active?.kova ? undefined : setMode}
                    userTier={tier}
                    canChangeAgent={!active?.kova}
                    showModelStatus
                    showChooseProject
                    savedConversations={userKey && principalReady ? conversations : []}
                    onOpenChatContext={active ? openChatWorkspace : undefined}
                    chatRulesActive={chatRulesActive}
                    onUploadLimit={() => setLimitDialog({ open: true, kind: "upload" })}
                    placeholder="Describe what you need…"
                    responseSettings={settings}
                    onResponseSettingsChange={(change) =>
                      setSettings((previous) => ({ ...previous, ...change }))
                    }
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
          </div>
          {result && wideResult && (
            <Suspense fallback={<div className="spec400-pane-divider" aria-hidden="true" />}>
              <WorkspaceResultDivider
                workspaceRef={workspaceRef}
                paneRatio={paneRatio}
                setLayoutRatio={setLayoutRatio}
                setPaneRatio={setPaneRatio}
              />
            </Suspense>
          )}
          {result && (
            <section
              id="result-pane"
              tabIndex={-1}
              className="spec400-result-pane"
              hidden={!wideResult && resultTab !== "result"}
              role={!wideResult ? "tabpanel" : undefined}
              aria-labelledby={!wideResult ? "result-tab" : undefined}
              aria-label={wideResult ? "Result" : undefined}
            >
              <Suspense fallback={<p role="status">Loading result editor…</p>}>
                <WorkspaceResultContent
                  result={result}
                  wideResult={wideResult}
                  paneRatio={paneRatio}
                  setLayoutRatio={setLayoutRatio}
                  setPaneRatio={setPaneRatio}
                  closeResult={closeResult}
                  storagePrincipal={storagePrincipal}
                  activeId={activeId}
                  resultScopeRef={resultScopeRef}
                  resultPrincipalRef={resultPrincipalRef}
                  resultDraftsRef={resultDraftsRef}
                  openResult={openResult}
                  setInput={setInput}
                  setResultTab={setResultTab}
                />
              </Suspense>
            </section>
          )}
        </div>
      </main>

      <Suspense fallback={null}>
        {settingsOpen && (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onChange={setSettings}
            onClearAll={() => {
              attachmentDraftsRef.current.clear();
              pendingDraftLoadRef.current = null;
              storageGenerationRef.current += 1;
              updateNextPrompt(null);
              abortRef.current?.abort();
              abortRef.current = null;
              inFlightTargetRef.current = null;
              inFlightRef.current = false;
              clearRetryTimer(retryTimerRef);
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

        <OnboardingDialog
          onStarterSelected={(starter) => {
            newChat();
            setInput(starter);
          }}
          onResponseLengthChange={(responseLength) =>
            setSettings((previous) => ({ ...previous, responseLength }))
          }
        />

        {currentMemoryTarget ? (
          <ReviewedMemoryDialog
            key={`${currentMemoryTarget.ownerId}:${currentMemoryTarget.conversation.id}`}
            ownerId={currentMemoryTarget.ownerId}
            conversation={currentMemoryTarget.conversation}
            isScopeCurrent={() =>
              memoryReviewTargetRef.current === currentMemoryTarget &&
              currentMemoryTarget.generation === storageGenerationRef.current &&
              nextPromptMountedRef.current &&
              window.location.href === currentMemoryTarget.url
            }
            returnFocusTarget={currentMemoryTarget.trigger}
            returnFocusUrl={currentMemoryTarget.url}
            onClose={() =>
              setReviewedMemoryTarget((value) => (value === currentMemoryTarget ? null : value))
            }
          />
        ) : null}

        {tempChatStartOpen && (
          <TemporaryChatStartDialog
            open={tempChatStartOpen}
            onOpenChange={setTempChatStartOpen}
            onStart={startTemporaryChat}
            returnFocusTarget={temporaryTriggerRef.current}
            returnFocusUrl={temporaryReturnUrlRef.current}
          />
        )}

        {workspaceOpen && (
          <ChatWorkspaceDialog
            open={workspaceOpen}
            onOpenChange={setWorkspaceOpen}
            chatId={active?.id ?? null}
            temporary={Boolean(active?.temporary)}
            onRulesActiveChange={setChatRulesActive}
            returnFocusTarget={workspaceReturnFocusRef.current}
            returnFocusUrl={workspaceReturnUrlRef.current}
          />
        )}

        {shareChatId !== null && (
          <ShareChatDialog
            open={shareChatId !== null}
            onOpenChange={(open) => {
              if (open) return;
              setShareChatId(null);
              window.requestAnimationFrame(() =>
                restoreDialogFocus(shareReturnFocusRef.current, shareReturnUrlRef.current),
              );
            }}
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

      {signupPromptOpen && (
        <Suspense fallback={null}>
          <SignUpPrompt open={signupPromptOpen} onOpenChange={setSignupPromptOpen} />
        </Suspense>
      )}

      {commandOpen && (
        <Suspense fallback={null}>
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
            onSelectArchived={(conversation) => historyAction("restore", conversation)}
            onOpenSettings={() => openSettings("general")}
            returnFocusTarget={commandReturnFocusRef.current}
          />
        </Suspense>
      )}
    </div>
  );
}
