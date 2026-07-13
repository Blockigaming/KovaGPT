import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignUpPrompt } from "@/components/SignUpPrompt";
import { PanelLeft, Search, MessageSquareDashed, Check } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput, type PendingAttachment } from "@/components/ChatInput";
import { AIStatus } from "@/components/AIStatus";

import { type Settings, DEFAULT_SETTINGS } from "@/components/SettingsDialog";

const SettingsDialog = lazy(() => import("@/components/SettingsDialog").then(m => ({ default: m.SettingsDialog })));
const OnboardingDialog = lazy(() => import("@/components/OnboardingDialog").then(m => ({ default: m.OnboardingDialog })));
const LimitReachedDialog = lazy(() => import("@/components/LimitReachedDialog").then(m => ({ default: m.LimitReachedDialog })));
const ShareChatDialog = lazy(() => import("@/components/ShareChatDialog").then(m => ({ default: m.ShareChatDialog })));
const AddMembersDialog = lazy(() => import("@/components/AddMembersDialog").then(m => ({ default: m.AddMembersDialog })));
import { applyThemeMode } from "@/lib/theme";

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
  loadConversations,
  newId,
  saveConversations,
} from "@/lib/chat-store";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { loadPersonality, personalityToInstruction } from "@/components/PersonalitySliders";

export const Route = createFileRoute("/")({
  component: KovaGPT,
  head: () => ({
    meta: [
      { title: "KovaGPT" },
      {
        name: "description",
        content: "KovaGPT — a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { property: "og:title", content: "KovaGPT" },
      {
        property: "og:description",
        content: "KovaGPT — a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { property: "og:url", content: "https://kovagpt.com/" },
      { property: "og:image", content: "https://kovagpt.com/og/home.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KovaGPT" },
      {
        name: "twitter:description",
        content: "KovaGPT — a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { name: "twitter:image", content: "https://kovagpt.com/og/home.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/" }],
  }),
});


const SETTINGS_KEY_BASE = "nova-gpt-settings-v1";
function settingsKey(userKey: string | null) {
  return userKey ? `${SETTINGS_KEY_BASE}:${userKey}` : `${SETTINGS_KEY_BASE}:guest`;
}

function loadSettings(userKey: string | null): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(settingsKey(userKey));
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    // Migration: pick up legacy single-key settings the first time.
    const legacy = localStorage.getItem(SETTINGS_KEY_BASE);
    if (legacy) return { ...DEFAULT_SETTINGS, ...JSON.parse(legacy) };
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function KovaGPT() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { openSignUp } = useClerkSafe();
  const userKey = user?.id ?? null;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mode, setMode] = useState<ModeId>("medium");
  const [isStreaming, setIsStreaming] = useState(false);
  const [tempChat, setTempChat] = useState(false);
  const [tempChatConfirmed, setTempChatConfirmed] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });
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
  const openHelp = useCallback(() => { navigate({ to: "/help" as never }); }, [navigate]);
  const [shareChatId, setShareChatId] = useState<string | null>(null);
  const [membersChatId, setMembersChatId] = useState<string | null>(null);
  
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [signupPromptOpen, setSignupPromptOpen] = useState(false);
  const [signupPromptShown, setSignupPromptShown] = useState(false);
  const [limitDialog, setLimitDialog] = useState<{
    open: boolean;
    kind: "image" | "chat" | "upload";
    message?: string;
  }>({ open: false, kind: "image" });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);



  // Load (or reload) settings whenever the signed-in user changes so each
  // account gets its own personalization, behavior, appearance, etc.
  useEffect(() => {
    if (!isLoaded) return;
    const loaded = loadSettings(userKey);
    setSettings(loaded);
    applyThemeMode(loaded.mode ?? "system");
    if (clerkEnabled && !isSignedIn) {
      try {
        localStorage.removeItem("nova-gpt-conversations-v2");
      } catch {
        /* ignore */
      }
      setConversations([]);
    } else {
      const loadedConvs = loadConversations();
      setConversations(loadedConvs);
      try {
        const pending = localStorage.getItem("nova-gpt-pending-active");
        if (pending && loadedConvs.some((c) => c.id === pending)) {
          setActiveId(pending);
        }
        localStorage.removeItem("nova-gpt-pending-active");
      } catch { /* ignore */ }
    }
  }, [isLoaded, userKey, isSignedIn]);

  // Re-apply theme mode whenever it changes
  useEffect(() => {
    applyThemeMode(settings.mode ?? "system");
  }, [settings.mode]);

  // Debounced persistence - avoid JSON.stringify on every keystroke / stream token,
  // which was the main source of typing/streaming lag.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      localStorage.setItem(settingsKey(userKey), JSON.stringify(settings));
    }, 400);
    return () => clearTimeout(t);
  }, [settings, userKey]);

  useEffect(() => {
    const t = setTimeout(() => saveConversations(conversations), 400);
    return () => clearTimeout(t);
  }, [conversations]);

  // If the user signs out mid-session, clear stored chats immediately.
  useEffect(() => {
    if (!isLoaded) return;
    if (clerkEnabled && !isSignedIn) {
      try {
        localStorage.removeItem("nova-gpt-conversations-v2");
      } catch {
        /* ignore */
      }
    }
  }, [isLoaded, isSignedIn]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // Personalized greeting for the landing screen.
  const firstName = useMemo(() => {
    const candidate =
      settings.displayName?.trim() ||
      (user as any)?.firstName ||
      (user as any)?.username ||
      (user as any)?.fullName?.split(" ")[0] ||
      "";
    return typeof candidate === "string" ? candidate.split(" ")[0] : "";
  }, [settings.displayName, user]);

  const greeting = useMemo(() => {
    if (!isLoaded) return "KovaGPT";
    if (clerkEnabled && !isSignedIn) return "KovaGPT";
    const name = firstName;
    const prompts = name
      ? [
          `Let's jump in, ${name}.`,
          `Ready when you are, ${name}.`,
          `What's next, ${name}?`,
          `Pick up where you left off, ${name}.`,
          `Where should we begin, ${name}?`,
          `Let's make something, ${name}.`,
          `Ready to create, ${name}?`,
          `Start anywhere, ${name}.`,
        ]
      : [
          "Ready when you are.",
          "Let's get started.",
          "What are we working on?",
          "Let's make something.",
          "Where should we begin?",
          "Start anywhere.",
        ];
    // Pick once per mount so it doesn't flicker on every render.
    return prompts[Math.floor(Math.random() * prompts.length)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, isLoaded, isSignedIn]);


  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messages.length, isStreaming]);

  // Cross-chat memory: when an active conversation has been updated and
  // we're not mid-stream, debounce a summary save server-side. The
  // endpoint silently no-ops for free users.
  useEffect(() => {
    if (!isSignedIn || isStreaming) return;
    if (!active || active.messages.length < 4) return;
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
      }).catch(() => { /* best-effort */ });
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
    async (text: string, atts: PendingAttachment[]) => {
      const trimmed = text.trim();
      if ((!trimmed && atts.length === 0) || isStreaming) return;

      const nextConvId = activeId ?? newId();
      const isNewConversation = !activeId;

      const userMsg: Message = {
        id: newId(),
        role: "user",
        content: trimmed,
        attachments: atts.map((a) => ({ kind: "image", dataUrl: a.dataUrl })),
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
            mode,
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
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          const errJson = await resp.json().catch(() => ({ error: "Request failed" }));
          const errMsg = errJson.error || `HTTP ${resp.status}`;
          if (resp.status === 429 && /limit/i.test(errMsg)) {
            const kind: "image" | "chat" = /image/i.test(errMsg) ? "image" : "chat";
            setLimitDialog({ open: true, kind, message: errMsg });
          }
          throw new Error(errMsg);
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
                      const activities = [...(m.activities ?? []), { tool: String(delta.tool ?? ""), label: String(delta.label), status: "done" as const }];
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
          const fullMsgs = [...priorMessages, userMsg, { ...assistantMsg, content: assembledReply }];
          autoTitle(nextConvId, fullMsgs);
        }

      } catch (e: unknown) {
        if ((e as Error).name !== "AbortError") {
          const msg = e instanceof Error ? e.message : "Something went wrong";
          toast.error(msg);
          updateAssistant(`\n\n_Error: ${msg}_`);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [activeId, isStreaming, mode, autoTitle, settings],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  // Image generation removed; can be reintroduced when user explicitly asks.

  return (
    <div className="flex h-screen w-full bg-background text-foreground" style={{ height: "100dvh" }}>
      <Toaster />
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
          // Lightweight archive: remove from sidebar list, persist in localStorage.
          setConversations((prev) => {
            const target = prev.find((c) => c.id === id);
            if (target) {
              try {
                const raw = localStorage.getItem("kovagpt:archived") || "[]";
                const arr = JSON.parse(raw);
                arr.unshift(target);
                localStorage.setItem("kovagpt:archived", JSON.stringify(arr.slice(0, 200)));
              } catch { /* ignore */ }
            }
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
      />

      <main className="flex-1 flex flex-col min-w-0" data-sidebar={sidebarOpen ? "open" : "closed"}>
        <header className="h-14 flex items-center px-3 relative gap-1">
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
                onClick={() => setSidebarOpen(true)}
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
            <AIStatus
              streaming={isStreaming}
              message={active?.messages[active.messages.length - 1]}
            />
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
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
                className={`md:hidden relative shrink-0 p-2 rounded-lg transition ${
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
                  <button className="text-sm font-medium px-4 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm font-medium px-3 sm:px-4 py-1.5 rounded-full bg-neutral-300 text-neutral-900 hover:bg-neutral-400 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700 transition whitespace-nowrap">
                    Sign up for free
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>



        {!active || active.messages.length === 0 ? (
          <div className="flex-1 flex flex-col overflow-y-auto px-4">
            <div className="flex-1 flex flex-col items-center justify-center w-full py-10">
              <div className="flex flex-col items-center gap-4 mb-6">
                <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-center">
                  {greeting}
                </h1>
              </div>

              <div className="w-full max-w-3xl mx-auto">
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
                  onUploadLimit={() =>
                    setLimitDialog({ open: true, kind: "upload" })
                  }
                  placeholder="Ask anything"
                />

                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {[
                    "Track the World Cup",
                    "Search Current Trends",
                    "Flash Sales Near Me",
                  ].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setInput((v) => (v ? v : p))}
                      className="text-sm px-3.5 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent hover:border-foreground/20 transition-all hover:scale-[1.02] active:scale-95"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {active.messages.map((m, i) => {
                const isLastAssistant =
                  m.role === "assistant" && i === active.messages.length - 1;
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
                      isLastAssistant && !isStreaming
                        ? (prompt) => send(prompt, [])
                        : undefined
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
                      // Branch: create a new conversation with messages up to and including this one.
                      const sliceEnd = i + 1;
                      const branched: Conversation = {
                        id: newId(),
                        title: `${active.title} (branch)`,
                        messages: active.messages.slice(0, sliceEnd).map((mm) => ({
                          ...mm,
                          id: newId(),
                        })),
                        mode: active.mode,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                      };
                      setConversations((prev) => [branched, ...prev]);
                      setActiveId(branched.id);
                      toast.success("Branched into a new chat");
                    }}
                  />
                );
              })}
            </div>
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
              onUploadLimit={() =>
                setLimitDialog({ open: true, kind: "upload" })
              }
              placeholder="Ask anything"
            />
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
      </Suspense>

      <SignUpPrompt open={signupPromptOpen} onOpenChange={setSignupPromptOpen} />


      
    </div>
  );
}
