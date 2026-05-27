import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, AudioLines } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput, type PendingAttachment } from "@/components/ChatInput";

import { SettingsDialog, type Settings } from "@/components/SettingsDialog";
import { VoiceMode } from "@/components/VoiceMode";
import { NovaLogo } from "@/components/NovaLogo";
import { useUser, SignInButton, clerkEnabled } from "@/components/auth/ClerkSafe";
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
  component: NovaGPT,
  head: () => ({
    meta: [
      { title: "NovaGPT — Your intelligent AI assistant" },
      {
        name: "description",
        content:
          "NovaGPT is an advanced multimodal AI assistant for chat, coding, research, voice, and image generation.",
      },
    ],
  }),
});

const SUGGESTIONS = [
  { title: "Generate an email", subtitle: "to reschedule a meeting" },
  { title: "Write a website", subtitle: "landing page in React" },
  { title: "Brainstorm ideas", subtitle: "for a weekend project" },
  { title: "Explain a concept", subtitle: "like I'm five" },
];

const SETTINGS_KEY = "nova-gpt-settings-v1";
const DEFAULT_SETTINGS: Settings = { autoSpeak: false, voiceRate: 1, voiceName: "" };

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function NovaGPT() {
  const { isSignedIn } = useUser();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mode, setMode] = useState<ModeId>("auto");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSettings(loadSettings());
    // When not signed in, wipe any previously stored chats on (re)load
    // so reloading the page clears history. Chats still persist in-session.
    if (clerkEnabled && !isSignedIn) {
      try { localStorage.removeItem("nova-gpt-conversations-v2"); } catch { /* ignore */ }
      setConversations([]);
    } else {
      setConversations(loadConversations());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  // Persist conversations across in-session navigation. When not signed in,
  // they're wiped on the next reload by the mount effect above.
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // If the user signs out mid-session, clear stored chats immediately.
  useEffect(() => {
    if (clerkEnabled && !isSignedIn) {
      try { localStorage.removeItem("nova-gpt-conversations-v2"); } catch { /* ignore */ }
    }
  }, [isSignedIn]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messages.length, isStreaming]);

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
      const resp = await fetch("/api/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: msgs.slice(0, 4).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const { title } = await resp.json();
      if (title) {
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, title } : c)),
        );
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
        return prev.map((c) => {
          if (c.id !== nextConvId) return c;
          found = true;
          priorMessages = c.messages.slice();
          return { ...c, messages: [...c.messages, userMsg, assistantMsg], updatedAt: Date.now() };
        }).concat(
          found
            ? []
            : [{
                id: nextConvId,
                title: deriveTitle(trimmed || "Image chat"),
                messages: [userMsg, assistantMsg],
                mode,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }],
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

        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: payloadMessages, mode }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          const errJson = await resp.json().catch(() => ({ error: "Request failed" }));
          throw new Error(errJson.error || `HTTP ${resp.status}`);
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
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                assembledReply += delta;
                updateAssistant(delta);
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
    [activeId, isStreaming, mode, autoTitle, settings.autoSpeak, settings.voiceRate, settings.voiceName],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  // Image generation removed; can be reintroduced when user explicitly asks.


  return (
    <div className="flex h-screen w-full bg-background text-foreground">
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
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center px-3 border-b border-border/50">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-accent transition mr-1"
              aria-label="Open sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 font-semibold">
            <span>NovaGPT</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setVoiceModeOpen(true)}
              className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition flex items-center gap-1.5"
              title="Voice mode"
            >
              <AudioLines className="w-4 h-4" />
              <span className="hidden sm:inline">Voice</span>
            </button>
            <SignInButton mode="modal">
              <button className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition md:hidden">
                Sign in
              </button>
            </SignInButton>
          </div>
        </header>

        {!active || active.messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <NovaLogo className="w-14 h-14 mb-6" />
            <h1 className="text-3xl font-semibold mb-8 text-center">What can I help with?</h1>
            <div className="w-full max-w-3xl grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
                  onClick={() => send(`${s.title} ${s.subtitle}`, [])}
                  className="text-left rounded-2xl border border-border bg-card/50 hover:bg-card p-4 transition"
                >
                  <div className="font-medium text-sm">{s.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.subtitle}</div>
                </button>
              ))}
            </div>
            <div className="w-full">
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
              />
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {active.messages.map((m, i) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  streaming={
                    isStreaming && i === active.messages.length - 1 && m.role === "assistant"
                  }
                  voiceRate={settings.voiceRate}
                />
              ))}
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
