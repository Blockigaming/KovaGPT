import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignUpPrompt } from "@/components/SignUpPrompt";
import { PanelLeft, Search, MessageSquareDashed, Check, Share2, Download } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";

import { ChatMessage } from "@/components/ChatMessage";
import {
  ChatInput,
  type ComposerToolId,
  type PendingAttachment,
  type RecentLibraryFile,
} from "@/components/ChatInput";
import { AIStatus } from "@/components/AIStatus";
import { MobileTopBar } from "@/components/MobileTopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { ResponsiveModelSelector } from "@/components/ResponsiveModelSelector";

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
import { applyThemeMode } from "@/lib/theme";
import { loadSettings, settingsKey } from "@/lib/use-nova-settings";

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
  deriveTitle,
  branchConversation,
  loadConversations,
  newId,
  saveConversations,
  archiveConversation,
  removeArchivedConversation,
} from "@/lib/chat-store";
import { toast } from "sonner";
import { loadPersonality, personalityToInstruction } from "@/components/PersonalitySliders";
import { useTier } from "@/hooks/useTier";

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

function KovaGPT() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { tier } = useTier();
  const { openSignUp } = useClerkSafe();
  const userKey = user?.id ?? null;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mode, setMode] = useState<ModeId>("instant");
  const [isStreaming, setIsStreaming] = useState(false);
  const [tempChat, setTempChat] = useState(false);
  const [tempChatConfirmed, setTempChatConfirmed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
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
    setRecentLibraryLoading(true);
    setRecentLibraryError(null);
    try {
      const { listMyLibrary } = await import("@/lib/library.functions");
      const rows = isSignedIn ? await listMyLibrary() : [];
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
      console.warn("[recentLibraryFiles]", error);
      setRecentLibraryError("Recent Library files are unavailable.");
    } finally {
      setRecentLibraryLoading(false);
    }
  }, [isLoaded, isSignedIn]);

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
    if (lastLoadedDraftRef.current === activeId) return;
    lastLoadedDraftRef.current = activeId;
    try {
      const saved = localStorage.getItem(`kova-draft:${activeId ?? "__new__"}`);
      setInput(saved ?? "");
    } catch {
      setInput("");
    }
  }, [activeId, tempChat]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tempChat) return;
    if (lastLoadedDraftRef.current !== activeId) return;
    const key = `kova-draft:${activeId ?? "__new__"}`;
    try {
      if (input) localStorage.setItem(key, input);
      else localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [input, activeId, tempChat]);
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

  const [settings, setSettings] = useState<Settings>(() => loadSettings(null));
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
    if (!isLoaded) return;
    const loaded = loadSettings(userKey);
    setSettings(loaded);
    applyThemeMode(loaded.mode ?? "system");
    // Never wipe conversations on sign-out — memory persists across sessions
    // and logins. Only a fully signed-out user refreshing a fresh tab starts
    // clean (handled implicitly by empty localStorage on a fresh device).
    const loadedConvs = loadConversations();
    setConversations(loadedConvs);
    try {
      const pending = localStorage.getItem("nova-gpt-pending-active");
      if (pending && loadedConvs.some((c) => c.id === pending)) {
        setActiveId(pending);
      }
      localStorage.removeItem("nova-gpt-pending-active");
    } catch {
      /* ignore */
    }
  }, [isLoaded, userKey, isSignedIn]);

  // Re-apply theme mode whenever it changes
  useEffect(() => {
    applyThemeMode(settings.mode ?? "system");
  }, [settings.mode]);

  // Debounced persistence - avoid JSON.stringify on every keystroke / stream token,
  // which was the main source of typing/streaming lag.
  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;
    const t = setTimeout(() => {
      localStorage.setItem(settingsKey(userKey), JSON.stringify(settings));
    }, 400);
    return () => clearTimeout(t);
  }, [isLoaded, settings, userKey]);

  useEffect(() => {
    const t = setTimeout(() => saveConversations(conversations.filter((c) => !c.temporary)), 400);
    return () => clearTimeout(t);
  }, [conversations]);

  useEffect(() => {
    try {
      const rawPack =
        sessionStorage.getItem("kova-active-context-pack") ??
        localStorage.getItem("kova-active-context-pack");
      const rawWork = localStorage.getItem("kova-work-context");
      const rawApp =
        sessionStorage.getItem("kova-app-chat-context") ??
        localStorage.getItem("kova-app-chat-context");
      const rawPrompt =
        sessionStorage.getItem("kova-prompt-launch") ?? localStorage.getItem("kova-prompt-launch");
      const rawResearch = localStorage.getItem("kova-research-launch");
      if (rawPack) {
        const pack = JSON.parse(rawPack) as {
          name: string;
          items: { title: string; content: string }[];
        };
        const context = pack.items.map((item) => `## ${item.title}\n${item.content}`).join("\n\n");
        setInput(
          `Use this saved context pack, “${pack.name}”, to help with my request:\n\n${context}\n\nMy request: `,
        );
        sessionStorage.removeItem("kova-active-context-pack");
        localStorage.removeItem("kova-active-context-pack");
      } else if (rawWork) {
        const task = JSON.parse(rawWork) as {
          objective: string;
          context: string;
          steps: { text: string; done: boolean }[];
        };
        setInput(
          `Continue this work task without claiming background execution.\n\nObjective: ${task.objective}\nContext: ${task.context || "None provided"}\nPlan:\n${task.steps.map((step) => `- [${step.done ? "x" : " "}] ${step.text}`).join("\n")}\n\nNext, help me with: `,
        );
        localStorage.removeItem("kova-work-context");
      } else if (rawApp) {
        setInput(rawApp);
        sessionStorage.removeItem("kova-app-chat-context");
        localStorage.removeItem("kova-app-chat-context");
      } else if (rawPrompt) {
        const launch = JSON.parse(rawPrompt) as {
          prompt: string;
          pack?: { name: string; items: { title: string; content: string }[] } | null;
        };
        const context = launch.pack
          ? `\n\nContext pack “${launch.pack.name}”:\n${launch.pack.items.map((item) => `## ${item.title}\n${item.content}`).join("\n\n")}`
          : "";
        setInput(`${launch.prompt}${context}`);
        sessionStorage.removeItem("kova-prompt-launch");
        localStorage.removeItem("kova-prompt-launch");
      } else if (rawResearch) {
        setInput(rawResearch);
        setSelectedTool("deep_research");
        localStorage.removeItem("kova-research-launch");
      }
    } catch {
      sessionStorage.removeItem("kova-active-context-pack");
      localStorage.removeItem("kova-active-context-pack");
      localStorage.removeItem("kova-work-context");
      sessionStorage.removeItem("kova-app-chat-context");
      localStorage.removeItem("kova-app-chat-context");
      sessionStorage.removeItem("kova-prompt-launch");
      localStorage.removeItem("kova-prompt-launch");
      localStorage.removeItem("kova-research-launch");
      toast.error("Saved workspace context could not be attached");
    }
  }, []);

  // Memory is retained across sign-in/sign-out transitions per user request.

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
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

  // Cross-chat memory: when an active conversation has been updated and
  // we're not mid-stream, debounce a summary save server-side. The
  // endpoint silently no-ops for free users.
  useEffect(() => {
    if (!isSignedIn || isStreaming) return;
    if (!active || active.temporary || active.messages.length < 4) return;
    const handle = setTimeout(() => {
      const payload = {
        chatId: active.id,
        title: active.title,
        messages: active.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      authFetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        /* best-effort */
      });
    }, 4000);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.messages.length, isStreaming, isSignedIn]);

  // After 4 user messages in this session while signed out, prompt to sign up.
  useEffect(() => {
    if (!isLoaded) return;
    if (signupPromptShown) return;
    if (clerkEnabled && isSignedIn) return;
    const userMsgCount = conversations.reduce(
      (sum, c) => sum + c.messages.filter((m) => m.role === "user").length,
      0,
    );
    if (userMsgCount >= 4 && !isStreaming) {
      setSignupPromptOpen(true);
      setSignupPromptShown(true);
    }
  }, [conversations, isLoaded, isSignedIn, isStreaming, signupPromptShown]);

  const newChat = useCallback(() => {
    setActiveId(null);
    setInput("");
    setAttachments([]);
    setEditingMessage(null);
  }, []);

  useEffect(() => {
    const reloadImportedChats = () => {
      setConversations(loadConversations());
      setActiveId(null);
      setEditingMessage(null);
    };
    window.addEventListener("kova:conversations-imported", reloadImportedChats);
    return () => window.removeEventListener("kova:conversations-imported", reloadImportedChats);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "o") {
        event.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newChat]);

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
    [activeId, conversations],
  );

  const autoTitle = useCallback(async (convId: string, msgs: Message[]) => {
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
  }, []);

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
      if ((!trimmed && atts.length === 0) || inFlightRef.current) return;

      if (_retryAttempt === 0 && retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

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
          };
          return [c, ...prev.filter((conversation) => conversation.id !== nextConvId)];
        }

        return prev.map((c) =>
          c.id === nextConvId
            ? {
                ...c,
                messages: [...priorMessages, userMsg, assistantMsg],
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

      const updateAssistant = (chunk: string) => {
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

      const markPendingImage = () => {
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
        const payloadMessages = [...priorMessages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments,
        }));

        const resp = await authFetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: payloadMessages,
            mode: activeTool === "deep_research" ? "thinking" : mode,
            clientTool: activeTool,
            chatId: nextConvId,
            temporary: tempChat,
            user: {
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
            locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
            personality: personalityToInstruction(loadPersonality()) || undefined,
            kovaVersion:
              (typeof window !== "undefined" && (localStorage.getItem("kova-version") ?? "3.5")) ||
              "3.5",
          }),
          signal: controller.signal,
        });

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
                      const activities = [
                        ...(m.activities ?? []),
                        {
                          tool: String(delta.tool ?? ""),
                          label: String(delta.label),
                          status: "done" as const,
                        },
                      ];
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
                      const pendingConfirms = [
                        ...(m.pendingConfirms ?? []),
                        {
                          actionId: String(delta.action_id),
                          tool: String(delta.tool ?? ""),
                          summary: String(delta.summary ?? "Confirm action"),
                          argsPreview: (delta.args_preview ?? {}) as Record<string, unknown>,
                          status: "pending" as const,
                        },
                      ];
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

        // Always re-summarize so the chat name in the sidebar reflects the conversation
        if (assembledReply) {
          const fullMsgs = [
            ...priorMessages,
            userMsg,
            { ...assistantMsg, content: assembledReply },
          ];
          autoTitle(nextConvId, fullMsgs);
        }
      } catch (e: unknown) {
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
              if (activeIdRef.current !== nextConvId) return;
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
                  if (activeIdRef.current !== nextConvId) return;
                  void send(text, atts, 0, nextConvId, priorMessages);
                }, 100);
              },
            },
          });
          updateAssistant(`\n\n_${detail}_`);
        }
      } finally {
        setIsStreaming(false);
        setSelectedTool(null);
        abortRef.current = null;
        inFlightRef.current = false;
      }
    },
    [activeId, conversations, mode, autoTitle, settings, selectedTool, tempChat, editingMessage],
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
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newChat}
        onDelete={deleteChat}
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
            if (archived) archiveConversation(archived);
            return prev.filter((c) => c.id !== id);
          });
          if (activeId === id) setActiveId(null);
          toast.success("Chat archived", {
            action: archived
              ? {
                  label: "Undo",
                  onClick: () => {
                    removeArchivedConversation(archived!.id);
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
        className="flex min-w-0 flex-1 flex-col bg-background"
        data-sidebar={sidebarOpen ? "open" : "closed"}
      >
        <MobileTopBar
          onOpenSidebar={() => setSidebarOpen(true)}
          onNewChat={newChat}
          title={active?.title}
          mode={mode}
          onModeChange={setMode}
          userTier={tier}
        />
        <header className="kova-topbar relative hidden h-[52px] items-center gap-1 px-3 lg:flex">
          {!sidebarOpen && (
            <div className="flex items-center gap-1 mr-2 shrink-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="shrink-0 p-2 rounded-lg hover:bg-accent transition"
                aria-label="Open sidebar"
                title="Open sidebar"
              >
                <PanelLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setCommandOpen(true)}
                className="shrink-0 p-2 rounded-lg hover:bg-accent transition"
                aria-label="Search chats"
                title="Search chats"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
          )}

          <div className="flex items-center min-w-0 flex-1 relative">
            <ResponsiveModelSelector
              mode={mode}
              onChange={setMode}
              userTier={tier}
              placement="topbar"
            />
            <AIStatus
              streaming={isStreaming}
              message={active?.messages[active.messages.length - 1]}
              lastUserPrompt={(() => {
                const msgs = active?.messages ?? [];
                for (let i = msgs.length - 1; i >= 0; i--) {
                  if (msgs[i].role === "user") return msgs[i].content;
                }
                return undefined;
              })()}
            />
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {active && (
              <>
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
              </>
            )}
            {isLoaded && isSignedIn && (
              <button
                onClick={() => {
                  const next = !tempChat;
                  setTempChat(next);
                  if (next) {
                    try {
                      localStorage.removeItem(`kova-draft:${activeId ?? "__new__"}`);
                    } catch {
                      /* Storage may be unavailable; temporary input still stays in memory only. */
                    }
                    setTempChatConfirmed(true);
                    setTimeout(() => setTempChatConfirmed(false), 1400);
                    toast.success("Temporary chat enabled", {
                      description:
                        "Memory is off for this chat. It's private and won't be saved to your history.",
                    });
                  } else {
                    toast.message("Temporary chat disabled", {
                      description: "New chats will be saved and use memory again.",
                    });
                  }
                }}
                aria-label="Toggle temporary chat"
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
                  <button className="text-sm font-medium px-4 h-9 rounded-full text-foreground hover:bg-accent transition">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm font-semibold px-4 h-9 rounded-full bg-foreground text-background hover:opacity-90 active:scale-[0.98] transition whitespace-nowrap">
                    Sign up
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
              <span className="truncate">
                Temporary chat is on. This chat will not use or update memory.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTempChat(false)}
              className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              Turn off
            </button>
          </div>
        )}

        {!active || active.messages.length === 0 ? (
          <section
            className="kova-empty-chat flex flex-1 flex-col overflow-y-auto px-3 lg:px-6"
            aria-labelledby="chat-greeting"
          >
            <div className="flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10">
              <div className="kova-greeting mb-5 flex animate-fade-in flex-col items-center gap-2.5 lg:mb-6">
                <h1
                  id="chat-greeting"
                  className="text-balance px-4 text-center font-display text-[26px] font-semibold leading-[1.15] tracking-[-.025em] text-foreground lg:text-[32px]"
                >
                  {greeting}
                </h1>
              </div>

              <div className="mx-auto w-full max-w-[48rem]">
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSubmit={() => send(input, attachments)}
                  onStop={stop}
                  isStreaming={isStreaming}
                  attachments={attachments}
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
            </div>
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
                value={input}
                onChange={setInput}
                onSubmit={() => send(input, attachments)}
                onStop={stop}
                isStreaming={isStreaming}
                attachments={attachments}
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
              <p className="kova-disclaimer mt-2 select-none text-center text-[11px] leading-4 text-muted-foreground/80">
                KovaGPT can make mistakes. Check important info.
              </p>
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
            onClearAll={() => setConversations([])}
            onOpenHelp={openHelp}
            initialTab={settingsTab}
            returnFocusTarget={settingsReturnFocusRef.current}
          />
        )}

        <OnboardingDialog />

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
        conversations={conversations}
        onClose={() => setCommandOpen(false)}
        onNewChat={newChat}
        onSelectChat={setActiveId}
        onOpenSettings={() => openSettings("general")}
      />
    </div>
  );
}
