import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignUpPrompt } from "@/components/SignUpPrompt";
import {
  PanelLeft,
  Search,
  MessageSquareDashed,
  Check,
  Sparkles,
  Globe2,
  Code2,
  GraduationCap,
  Image as ImageIcon,
  FileText,
  Share2,
  Download,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";

import { ChatMessage } from "@/components/ChatMessage";
import {
  ChatInput,
  type ComposerToolId,
  type PendingAttachment,
  type RecentLibraryFile,
} from "@/components/ChatInput";
import { AIStatus } from "@/components/AIStatus";
import { MobileFabs } from "@/components/MobileFabs";
import { MobileTopBar } from "@/components/MobileTopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { ConversationOutline } from "@/components/ConversationOutline";

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
const AddMembersDialog = lazy(() =>
  import("@/components/AddMembersDialog").then((m) => ({ default: m.AddMembersDialog })),
);
const ArchivedChatsDialog = lazy(() =>
  import("@/components/ArchivedChatsDialog").then((m) => ({ default: m.ArchivedChatsDialog })),
);
const WorkspaceIntelligence = lazy(() =>
  import("@/components/WorkspaceIntelligence").then((module) => ({
    default: module.WorkspaceIntelligence,
  })),
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
} from "@/lib/chat-store";
import { toast } from "sonner";
import { loadPersonality, personalityToInstruction } from "@/components/PersonalitySliders";

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
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ComposerToolId | null>(null);
  const [recentLibraryFiles, setRecentLibraryFiles] = useState<RecentLibraryFile[]>([]);
  const [recentLibraryLoading, setRecentLibraryLoading] = useState(false);
  const [recentLibraryError, setRecentLibraryError] = useState<string | null>(null);

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
    if (lastLoadedDraftRef.current === activeId) return;
    lastLoadedDraftRef.current = activeId;
    try {
      const saved = localStorage.getItem(`kova-draft:${activeId ?? "__new__"}`);
      setInput(saved ?? "");
    } catch {
      setInput("");
    }
  }, [activeId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (lastLoadedDraftRef.current !== activeId) return;
    const key = `kova-draft:${activeId ?? "__new__"}`;
    try {
      if (input) localStorage.setItem(key, input);
      else localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [input, activeId]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const openSettings = useCallback((tab?: string) => {
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
  const [membersChatId, setMembersChatId] = useState<string | null>(null);

  const [settings, setSettings] = useState<Settings>(() => loadSettings(null));
  const [signupPromptOpen, setSignupPromptOpen] = useState(false);
  const [signupPromptShown, setSignupPromptShown] = useState(false);
  const [limitDialog, setLimitDialog] = useState<{
    open: boolean;
    kind: "image" | "chat" | "upload";
    message?: string;
  }>({ open: false, kind: "image" });
  const abortRef = useRef<AbortController | null>(null);
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

  // Personalized greeting for the landing screen.
  const firstName = useMemo(() => {
    const candidate =
      settings.displayName?.trim() ||
      (user as { firstName?: string; username?: string; fullName?: string } | null | undefined)
        ?.firstName ||
      (user as { firstName?: string; username?: string; fullName?: string } | null | undefined)
        ?.username ||
      (
        user as { firstName?: string; username?: string; fullName?: string } | null | undefined
      )?.fullName?.split(" ")[0] ||
      "";
    return typeof candidate === "string" ? candidate.split(" ")[0] : "";
  }, [settings.displayName, user]);

  const greeting = useMemo(() => {
    if (!isLoaded) return "What can I help with?";
    if (clerkEnabled && !isSignedIn) return "What can I help with?";
    const name = firstName;
    const prompts = name
      ? [
          `Welcome back, ${name}.`,
          `Hey, ${name}.`,
          `Good to see you, ${name}.`,
          `Ready, ${name}?`,
          `Let's go, ${name}.`,
        ]
      : [
          "What can I help with?",
          "How can I help you today?",
          "Ready when you are.",
          "What are we working on?",
          "Ask anything.",
        ];
    return prompts[0];
  }, [firstName, isLoaded, isSignedIn]);

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

  // After 3 user messages in this session while signed out, prompt to sign up.
  useEffect(() => {
    if (!isLoaded) return;
    if (signupPromptShown) return;
    if (clerkEnabled && isSignedIn) return;
    const userMsgCount = conversations.reduce(
      (sum, c) => sum + c.messages.filter((m) => m.role === "user").length,
      0,
    );
    if (userMsgCount >= 3 && !isStreaming) {
      setSignupPromptOpen(true);
      setSignupPromptShown(true);
    }
  }, [conversations, isLoaded, isSignedIn, isStreaming, signupPromptShown]);

  const newChat = useCallback(() => {
    setActiveId(null);
    setInput("");
    setAttachments([]);
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
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [activeId],
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
    async (text: string, atts: PendingAttachment[], _retryAttempt = 0) => {
      const MAX_AUTO_RETRIES = 2;
      const trimmed = text.trim();
      if ((!trimmed && atts.length === 0) || isStreaming) return;

      const nextConvId = activeId ?? newId();
      const isNewConversation = !activeId;

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
            : { kind: "image" as const, dataUrl: a.dataUrl },
        ),
      };
      const assistantMsg: Message = { id: newId(), role: "assistant", content: "" };

      let priorMessages: Message[] = [];

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
          priorMessages = [];
          return [c, ...prev];
        }

        let found = false;
        return prev
          .map((c) => {
            if (c.id !== nextConvId) return c;
            found = true;
            priorMessages = c.messages.slice();
            return {
              ...c,
              messages: [...c.messages, userMsg, assistantMsg],
              updatedAt: Date.now(),
            };
          })
          .concat(
            found
              ? []
              : [
                  {
                    id: nextConvId,
                    title: "New chat",
                    messages: [userMsg, assistantMsg],
                    mode,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    temporary: tempChat,
                  },
                ],
          );
      });
      setActiveId(nextConvId);
      setInput("");
      setAttachments([]);
      setIsStreaming(true);

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
            mode: activeTool === "deep_research" ? "high" : mode,
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
        if ((e as Error).name !== "AbortError") {
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
          const canAutoRetry = retryableCategory && _retryAttempt < MAX_AUTO_RETRIES;

          if (canAutoRetry) {
            // Silent exponential backoff: 600ms, 1800ms. Strip the empty
            // assistant + user bubble so the retry recreates them cleanly.
            const backoffMs = 600 * Math.pow(3, _retryAttempt);
            const attemptLabel = _retryAttempt + 1;
            updateAssistant(
              `\n\n_Reconnecting… (attempt ${attemptLabel + 1}/${MAX_AUTO_RETRIES + 1})_`,
            );
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
            setTimeout(() => {
              void send(text, atts, _retryAttempt + 1);
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
                    ? "The AI provider had a hiccup. Tap retry."
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
                      ? { ...c, messages: c.messages.filter((m) => m.id !== assistantMsg.id) }
                      : c,
                  ),
                );
                setTimeout(() => send(text, atts, 0), 100);
              },
            },
          });
          updateAssistant(`\n\n_${detail}_`);
        }
      } finally {
        setIsStreaming(false);
        setSelectedTool(null);
        abortRef.current = null;
      }
    },
    [activeId, isStreaming, mode, autoTitle, settings, selectedTool, tempChat],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const assistantCapabilities = [
    { label: "Create image", icon: ImageIcon, prompt: "Create a detailed image prompt for: " },
    {
      label: "Summarize text",
      icon: FileText,
      prompt: "Summarize this into clear bullet points: ",
    },
    {
      label: "Analyze data",
      icon: Sparkles,
      prompt: "Analyze this data and explain the key insights: ",
    },
    { label: "Write code", icon: Code2, prompt: "Help me write code for: " },
    { label: "Learn", icon: GraduationCap, prompt: "Teach me this topic like a patient tutor: " },
    { label: "Web research", icon: Globe2, prompt: "Research this online and cite sources: " },
  ];

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
          setConversations((prev) => {
            const target = prev.find((c) => c.id === id);
            if (target) archiveConversation(target);
            return prev.filter((c) => c.id !== id);
          });
          if (activeId === id) setActiveId(null);
          toast.success("Chat archived");
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
        onAddMembers={(id) => {
          if (!isSignedIn) {
            toast.message("Sign in to add members");
            openSignUp();
            return;
          }
          setMembersChatId(id);
        }}
        onOpenArchived={() => setArchivedOpen(true)}
      />

      <main
        className="flex min-w-0 flex-1 flex-col bg-background"
        data-sidebar={sidebarOpen ? "open" : "closed"}
      >
        <MobileTopBar
          onOpenSidebar={() => setSidebarOpen(true)}
          onNewChat={newChat}
          title={active?.title}
        />
        <header
          className="kova-topbar relative hidden h-[52px] items-center gap-1 px-3 lg:flex"
          role="banner"
        >
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

          {/* AI status: live indicator to the right of the KovaGPT mark while streaming */}
          <div className="flex items-center min-w-0 flex-1 relative">
            <div className="mr-3 flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-foreground transition hover:bg-accent">
              <span>KovaGPT</span>
              <span className="text-muted-foreground">⌄</span>
            </div>
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
                  className="hidden xl:inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-foreground hover:bg-accent"
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
                  className="hidden lg:inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-sm font-medium text-foreground hover:bg-accent"
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
                  <button className="text-sm font-semibold px-4 h-9 rounded-full bg-foreground text-background hover:opacity-90 active:scale-[0.98] transition whitespace-nowrap shadow-sm">
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
              <span className="truncate">
                Temporary chat is on. This chat will not use or update memory.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTempChat(false)}
              className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              Turn off
            </button>
          </div>
        )}

        {!active || active.messages.length === 0 ? (
          <section
            className="flex flex-1 flex-col overflow-y-auto px-3 lg:px-6"
            aria-labelledby="chat-greeting"
          >
            <div className="flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10">
              <div className="mb-5 flex animate-fade-in flex-col items-center gap-2.5 lg:mb-6">
                <h1
                  id="chat-greeting"
                  className="text-balance px-4 text-center font-display text-[26px] font-semibold leading-[1.15] tracking-[-.025em] text-foreground lg:text-[32px]"
                >
                  {greeting}
                </h1>
                <p className="max-w-lg text-center text-sm leading-relaxed text-muted-foreground">
                  Ask, search, analyze, create, or keep working from a previous chat.
                </p>
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
                  onUploadLimit={() => setLimitDialog({ open: true, kind: "upload" })}
                  placeholder="Message KovaGPT"
                  onPromptShortcut={(prompt) => setInput((v) => (v.trim() ? v : prompt))}
                  onToolSelect={setSelectedTool}
                  recentLibraryFiles={recentLibraryFiles}
                  recentLibraryLoading={recentLibraryLoading}
                  recentLibraryError={recentLibraryError}
                  onRecentLibraryRetry={loadRecentLibraryFiles}
                />

                <div className="mx-auto mt-4 hidden max-w-[46rem] grid-cols-2 gap-2 lg:grid">
                  {assistantCapabilities.map((p) => {
                    const Icon = p.icon;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setInput((v) => (v.trim() ? v : p.prompt))}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-card/55 px-3.5 text-left text-[13.5px] font-medium text-foreground shadow-sm transition hover:border-foreground/20 hover:bg-accent"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span>{p.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 lg:hidden flex gap-2 overflow-x-auto -mx-4 px-4 snap-x snap-mandatory no-scrollbar">
                  {[
                    {
                      label: "Summarize a file",
                      hint: "PDF or doc to key points",
                      prompt:
                        "Summarize the attached file into the key points, decisions, and action items.",
                    },
                    {
                      label: "Research a topic",
                      hint: "Briefing with sources",
                      prompt: "Research this topic and give me a concise briefing with sources: ",
                    },
                    {
                      label: "Improve my writing",
                      hint: "Clearer and tighter",
                      prompt:
                        "Improve the clarity and tone of this text without changing its meaning:\n\n",
                    },
                    {
                      label: "Debug my code",
                      hint: "Find and fix the bug",
                      prompt:
                        "Here's my code and the error I'm seeing. Explain what's wrong and give a corrected version.\n\n",
                    },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setInput((v) => (v ? v : p.prompt))}
                      className="shrink-0 snap-start w-[68%] text-left px-4 py-3 rounded-2xl border border-border bg-card/70 backdrop-blur-sm active:scale-[0.985] active:bg-accent/60 transition-all"
                    >
                      <div className="text-[15px] font-medium text-foreground">{p.label}</div>
                      <div className="text-[12.5px] text-muted-foreground mt-0.5">{p.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <Suspense
              fallback={
                <div className="mx-auto mb-6 h-32 w-full max-w-[56rem] animate-pulse rounded-2xl bg-muted" />
              }
            >
              <WorkspaceIntelligence />
            </Suspense>
          </section>
        ) : (
          <>
            <ConversationOutline messages={active.messages} />
            <div
              ref={scrollRef}
              onScroll={updateNearBottom}
              className="flex-1 overflow-y-auto overscroll-contain scroll-smooth pb-14 pt-5 lg:pb-20 lg:pt-8"
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
                    onRetry={
                      isLastAssistant && !isStreaming && priorUser
                        ? () => {
                            // Drop the last assistant message, then resend the prior user prompt.
                            setConversations((prev) =>
                              prev.map((c) =>
                                c.id === active.id
                                  ? { ...c, messages: c.messages.slice(0, -2) }
                                  : c,
                              ),
                            );
                            send(priorUser.content, []);
                          }
                        : undefined
                    }
                    onEdit={
                      priorUser
                        ? () => {
                            setInput(priorUser.content);
                            toast.message("Edit your prompt below, then press Enter");
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
                className="fixed bottom-28 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium shadow-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Jump to latest message"
              >
                Jump to latest
              </button>
            )}
            <div className="lg:pb-2 lg:pt-2">
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
                onUploadLimit={() => setLimitDialog({ open: true, kind: "upload" })}
                placeholder="Message KovaGPT"
                onPromptShortcut={(prompt) => setInput((v) => (v.trim() ? v : prompt))}
                onToolSelect={setSelectedTool}
                recentLibraryFiles={recentLibraryFiles}
                recentLibraryLoading={recentLibraryLoading}
                recentLibraryError={recentLibraryError}
                onRecentLibraryRetry={loadRecentLibraryFiles}
              />
              <div className="hidden lg:flex flex-col items-center gap-2 text-[11px] text-muted-foreground/70 mt-2 select-none">
                <div className="flex justify-center gap-3">
                  <span>
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-mono text-[10px]">
                      Enter
                    </kbd>{" "}
                    to send
                  </span>
                  <span>
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-mono text-[10px]">
                      Shift+Enter
                    </kbd>{" "}
                    newline
                  </span>
                  <span>
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-mono text-[10px]">
                      ⌘K
                    </kbd>{" "}
                    search
                  </span>
                </div>
                <p>KovaGPT can make mistakes. Check important info.</p>
              </div>
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

        {membersChatId !== null && (
          <AddMembersDialog
            open={membersChatId !== null}
            chatId={membersChatId}
            onOpenChange={(v) => !v && setMembersChatId(null)}
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
        <ArchivedChatsDialog
          open={archivedOpen}
          onClose={() => setArchivedOpen(false)}
          onRestore={(conversation) => {
            setConversations((all) => [
              conversation,
              ...all.filter((item) => item.id !== conversation.id),
            ]);
            toast.success("Chat restored");
          }}
        />
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

      <MobileFabs
        onNewChat={() => {
          try {
            localStorage.removeItem("nova-gpt-pending-active");
          } catch {
            /* ignore */
          }
          window.location.assign("/");
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </div>
  );
}
