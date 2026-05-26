import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, ChevronDown } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { NovaLogo } from "@/components/NovaLogo";
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
      { title: "Nova GPT — Your intelligent AI assistant" },
      {
        name: "description",
        content:
          "Nova GPT is an advanced multimodal AI assistant for chat, coding, research, writing, and analysis.",
      },
    ],
  }),
});

const SUGGESTIONS = [
  { title: "Explain a concept", subtitle: "like I'm five" },
  { title: "Write code", subtitle: "for a Python web scraper" },
  { title: "Draft an email", subtitle: "to reschedule a meeting" },
  { title: "Brainstorm ideas", subtitle: "for a weekend project" },
];

function NovaGPT() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConversations(loadConversations());
  }, []);

  useEffect(() => {
    if (conversations.length) saveConversations(conversations);
  }, [conversations]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, isStreaming]);

  const newChat = useCallback(() => {
    setActiveId(null);
    setInput("");
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        saveConversations(next);
        return next;
      });
      if (activeId === id) setActiveId(null);
    },
    [activeId],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: Message = { id: newId(), role: "user", content: trimmed };
      const assistantMsg: Message = { id: newId(), role: "assistant", content: "" };

      let convId = activeId;
      let convoMessages: Message[] = [];

      setConversations((prev) => {
        if (!convId) {
          const c: Conversation = {
            id: newId(),
            title: deriveTitle(trimmed),
            messages: [userMsg, assistantMsg],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          convId = c.id;
          convoMessages = [userMsg];
          return [c, ...prev];
        }
        return prev.map((c) => {
          if (c.id !== convId) return c;
          const messages = [...c.messages, userMsg, assistantMsg];
          convoMessages = c.messages.concat(userMsg);
          return { ...c, messages, updatedAt: Date.now() };
        });
      });
      setActiveId(convId);
      setInput("");
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const updateAssistant = (chunk: string) => {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const messages = c.messages.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m,
            );
            return { ...c, messages, updatedAt: Date.now() };
          }),
        );
      };

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...convoMessages, userMsg].map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
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
              if (delta) updateAssistant(delta);
            } catch {
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name === "AbortError") {
          // user stopped
        } else {
          const msg = e instanceof Error ? e.message : "Something went wrong";
          toast.error(msg);
          updateAssistant(`\n\n_Error: ${msg}_`);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [activeId, isStreaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

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
          <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-accent transition font-semibold">
            Nova GPT
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>
        </header>

        {!active || active.messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <NovaLogo className="w-14 h-14 mb-6" />
            <h1 className="text-3xl font-semibold mb-8">What can I help with?</h1>
            <div className="w-full max-w-3xl grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
                  onClick={() => send(`${s.title} ${s.subtitle}`)}
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
                onSubmit={() => send(input)}
                onStop={stop}
                isStreaming={isStreaming}
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
                  streaming={isStreaming && i === active.messages.length - 1 && m.role === "assistant"}
                />
              ))}
            </div>
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={() => send(input)}
              onStop={stop}
              isStreaming={isStreaming}
            />
          </>
        )}
      </main>
    </div>
  );
}
