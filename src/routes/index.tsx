import { createFileRoute, Link } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignUpPrompt } from "@/components/SignUpPrompt";
import { PanelLeft } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput, type PendingAttachment } from "@/components/ChatInput";

import { SettingsDialog, type Settings, DEFAULT_SETTINGS } from "@/components/SettingsDialog";
import { HelpDialog } from "@/components/HelpDialog";
import { LimitReachedDialog } from "@/components/LimitReachedDialog";
import { applyThemeMode } from "@/lib/theme";

import { getUsage } from "@/lib/limits";

import { VoiceMode } from "@/components/VoiceMode";
import {
  useUser,
  useClerkSafe,
  SignInButton,
  SignUpButton,
  UserButton,
  clerkEnabled,
} from "@/components/auth/ClerkSafe";
import { speak } from "@/lib/voice";
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

export const Route = createFileRoute("/")({
  component: KovaGPT,
  head: () => ({
    meta: [
      { title: "KovaGPT" },
      {
        name: "description",
        content: "See AI at its highest potential - chat, code, research, create images, and speak out loud.",
      },
      { property: "og:title", content: "KovaGPT" },
      {
        property: "og:description",
        content: "See AI at its highest potential - chat, code, research, create images, and speak out loud.",
      },
      { property: "og:url", content: "https://kovagpt.com/" },
      { name: "twitter:title", content: "KovaGPT" },
      {
        name: "twitter:description",
        content: "See AI at its highest potential - chat, code, research, create images, and speak out loud.",
      },
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
  const tryOpenVoice = useCallback(() => {
    if (!isSignedIn) {
      toast.message("Sign up free to use voice mode");
      openSignUp();
      return;
    }
    setVoiceModeOpen(true);
  }, [isSignedIn, openSignUp]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mode, setMode] = useState<ModeId>("default");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
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
      setConversations(loadConversations());
    }
  }, [userKey, isSignedIn]);

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
    if (clerkEnabled && !isSignedIn) {
      try {
        localStorage.removeItem("nova-gpt-conversations-v2");
      } catch {
        /* ignore */
      }
    }
  }, [isSignedIn]);

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
    if (clerkEnabled && !isSignedIn) return "KovaGPT";
    const name = firstName;
    const prompts = name
      ? [
          `What's on your mind today, ${name}?`,
          `Ready when you are, ${name}.`,
          `Where should we start, ${name}?`,
          `Good to see you, ${name}. What are we building?`,
          `Hey ${name}, what can I help you figure out?`,
          `What's the plan, ${name}?`,
          `Got an idea brewing, ${name}?`,
          `What are you curious about today, ${name}?`,
        ]
      : [
          "What's on your mind today?",
          "Ready when you are.",
          "Where should we start?",
          "What can I help you with?",
          "What are you working on?",
          "Got something to figure out?",
        ];
    // Pick once per mount so it doesn't flicker on every render.
    return prompts[Math.floor(Math.random() * prompts.length)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, isSignedIn]);


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
  }, [conversations, isSignedIn, isStreaming, signupPromptShown]);

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
            title: deriveTitle(trimmed || "Image chat"),
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
                    title: deriveTitle(trimmed || "Image chat"),
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

        // Auto title after first exchange
        if (priorMessages.length === 0) {
          autoTitle(nextConvId, [userMsg, { ...assistantMsg, content: assembledReply }]);
        }

        // Auto speak
        if (settings.autoSpeak && assembledReply) {
          speak(assembledReply, { rate: settings.voiceRate, voice: settings.voiceName });
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
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center px-3 border-b border-border relative">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className="p-2 rounded-lg hover:bg-accent transition"
                aria-label="Toggle sidebar"
                title="Toggle sidebar"
              >
                <PanelLeft className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-2 px-1">
              <span className="inline-flex rounded-full dark:bg-black dark:p-[2px] dark:ring-1 dark:ring-black">
                <NovaLogo className="w-6 h-6" />
              </span>
              <span className="font-display font-semibold tracking-tight hidden sm:inline">KovaGPT</span>
            </div>
          </div>


          <div className="ml-auto flex items-center gap-2">
            {isLoaded && isSignedIn ? (
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
              <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mb-4 text-center">
                {greeting}
              </h1>

              <div className="flex flex-wrap gap-2 justify-center mb-5">
                <SignUpButton mode="modal">
                  <button className="text-sm font-medium px-4 py-2 rounded-full bg-foreground text-background hover:opacity-90 transition">
                    Start Free
                  </button>
                </SignUpButton>
                <Link to="/pricing">
                  <button className="text-sm font-medium px-4 py-2 rounded-full border border-border hover:bg-accent transition">
                    View Pricing
                  </button>
                </Link>
                <Link to="/images">
                  <button className="text-sm font-medium px-4 py-2 rounded-full border border-border hover:bg-accent transition">
                    Generate Images
                  </button>
                </Link>
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
                  onOpenVoice={tryOpenVoice}
                  onUploadLimit={() =>
                    setLimitDialog({ open: true, kind: "upload" })
                  }
                  placeholder="Ask anything"
                />
              </div>
              <div className="w-full max-w-3xl mx-auto mt-4 flex flex-wrap gap-2 justify-center px-2">
                {[
                  "Explain this homework problem",
                  "Write a better email",
                  "Help me study",
                  "Fix my code",
                  "Generate an image prompt",
                  "Summarize a file",
                  "Research a topic",
                  "Brainstorm ideas",
                  "Make a study plan",
                  "Create a quiz",
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setInput(s)}
                    className="text-xs sm:text-sm px-3 py-1.5 rounded-full border border-border hover:bg-accent transition text-muted-foreground hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <nav className="w-full max-w-3xl mx-auto py-4 flex flex-wrap gap-x-4 gap-y-1 text-sm justify-center">
              <Link to="/pricing" className="text-muted-foreground hover:text-foreground underline underline-offset-2">Pricing</Link>
              <Link to="/images" className="text-muted-foreground hover:text-foreground underline underline-offset-2">Images</Link>
              <Link to="/modes" className="text-muted-foreground hover:text-foreground underline underline-offset-2">Modes</Link>
              <Link to="/contact-support" className="text-muted-foreground hover:text-foreground underline underline-offset-2">Contact Support</Link>
            </nav>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {active.messages.map((m, i) => {
                const isLastAssistant =
                  m.role === "assistant" && i === active.messages.length - 1;
                return (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    streaming={isStreaming && isLastAssistant}
                    voiceRate={settings.voiceRate}
                    onFollowUp={
                      isLastAssistant && !isStreaming
                        ? (prompt) => send(prompt, [])
                        : undefined
                    }
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
              onOpenVoice={tryOpenVoice}
              onUploadLimit={() =>
                setLimitDialog({ open: true, kind: "upload" })
              }
              placeholder="Ask anything"
            />
          </>
        )}
      </main>


      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={setSettings}
        onClearAll={() => setConversations([])}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      

      <SignUpPrompt open={signupPromptOpen} onOpenChange={setSignupPromptOpen} />

      <LimitReachedDialog
        open={limitDialog.open}
        onOpenChange={(v) => setLimitDialog((d) => ({ ...d, open: v }))}
        kind={limitDialog.kind}
        message={limitDialog.message}
        resetsAt={getUsage().resetsAt}
      />


      <VoiceMode
        open={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        initialMessages={active?.messages ?? []}
        voiceName={settings.voiceName}
        voiceRate={settings.voiceRate}
        onTurn={(userText, assistantText) => {
          // Append turn to active conversation (or create one)
          const userMsg: Message = { id: newId(), role: "user", content: userText };
          const aiMsg: Message = { id: newId(), role: "assistant", content: assistantText };
          setConversations((prev) => {
            if (activeId) {
              return prev.map((c) =>
                c.id === activeId
                  ? { ...c, messages: [...c.messages, userMsg, aiMsg], updatedAt: Date.now() }
                  : c,
              );
            }
            const id = newId();
            setActiveId(id);
            return [
              {
                id,
                title: deriveTitle(userText),
                messages: [userMsg, aiMsg],
                mode,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
              ...prev,
            ];
          });
        }}
      />
    </div>
  );
}
