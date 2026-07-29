import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, RefreshCw, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import {
  getProjectChat,
  saveProjectChat,
  deleteProjectChat,
  getProject,
  type ProjectChatMessage,
  type ProjectDetail,
} from "@/lib/projects.functions";

export const Route = createFileRoute("/projects/$projectId/chat/$chatId")({
  component: ProjectChatPage,
  head: () => ({
    meta: [{ title: "Project chat | KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});

function ProjectChatPage() {
  const { projectId, chatId } = Route.useParams();
  const { isSignedIn, isLoaded } = useUser();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fnGetChat = useServerFn(getProjectChat);
  const fnGetProject = useServerFn(getProject);
  const fnSave = useServerFn(saveProjectChat);
  const fnDelete = useServerFn(deleteProjectChat);

  const loadChat = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [c, p] = await Promise.all([
        fnGetChat({ data: { id: chatId } }),
        fnGetProject({ data: { id: projectId } }),
      ]);
      if (!c) {
        setLoadError("This project chat was deleted or you no longer have access to it.");
        return;
      }
      setProject(p);
      setTitle(c.title);
      setMessages(c.snapshot.messages ?? []);
    } catch (error) {
      console.error(error);
      setLoadError("Project chat could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [chatId, fnGetChat, fnGetProject, isSignedIn, projectId]);

  useEffect(() => {
    void loadChat();
  }, [loadChat]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  if (!isLoaded)
    return (
      <AppShell>
        <div className="p-8 text-muted-foreground">Loading…</div>
      </AppShell>
    );
  if (!isSignedIn) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto p-8 text-center">
          <h1 className="text-2xl font-semibold mb-2">Sign in required</h1>
          <SignInButton mode="modal">
            <Button>Sign in</Button>
          </SignInButton>
        </div>
      </AppShell>
    );
  }
  if (loading) {
    return (
      <AppShell>
        <div className="p-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading chat…
        </div>
      </AppShell>
    );
  }
  if (loadError) {
    return (
      <AppShell>
        <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center p-6 text-center">
          <h1 className="text-lg font-semibold">Project chat unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void loadChat()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
            <Button variant="outline" asChild>
              <Link to="/projects/$projectId" params={{ projectId }}>
                Back to project
              </Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const canEdit = project?.role === "owner" || project?.role === "editor";

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !canEdit) return;
    setInput("");
    setSendError(null);
    const userMsg: ProjectChatMessage = { role: "user", content: text };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let assistant = "";
    try {
      const resp = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          mode: "instant",
          user: {},
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
          projectId,
        }),
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || "Chat failed");
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Add empty assistant message we'll fill.
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line || line.startsWith(":") || !line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              assistant += delta;
              setMessages((prev) => {
                const copy = prev.slice();
                copy[copy.length - 1] = { role: "assistant", content: assistant };
                return copy;
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
      const finalMsgs: ProjectChatMessage[] = [
        ...nextHistory,
        { role: "assistant", content: assistant },
      ];
      await fnSave({ data: { id: chatId, messages: finalMsgs } });
    } catch (error) {
      if (controller.signal.aborted) {
        const stopped: ProjectChatMessage[] = [
          ...nextHistory,
          ...(assistant ? [{ role: "assistant" as const, content: assistant }] : []),
        ];
        setMessages(stopped);
        try {
          await fnSave({ data: { id: chatId, messages: stopped } });
          toast.message("Generation stopped. The partial conversation was saved.");
        } catch {
          setSendError("Generation stopped, but the partial conversation could not be saved.");
        }
      } else {
        setMessages(messages);
        setInput(text);
        setSendError(error instanceof Error ? error.message : "Message could not be sent.");
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this chat for everyone?")) return;
    await fnDelete({ data: { id: chatId } });
    navigate({ to: "/projects/$projectId", params: { projectId } });
  }

  async function handleRename() {
    const next = prompt("Rename chat", title);
    if (!next || next === title) return;
    setTitle(next);
    await fnSave({ data: { id: chatId, title: next, messages } });
  }

  return (
    <AppShell>
      <div className="flex flex-col h-[100dvh] w-full">
        <div className="border-b px-4 py-3 flex items-center gap-3">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{project?.name ?? "Project"}</span>
              {project?.system_prompt ? (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Instructions active
                </span>
              ) : null}
            </div>
            <button
              className="block max-w-full truncate text-left font-medium hover:underline"
              onClick={handleRename}
            >
              {title}
            </button>
          </div>
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={handleDelete} aria-label="Delete">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {messages.filter((m) => m.role !== "system").length === 0 && (
            <div className="text-center text-muted-foreground text-sm">
              Start the conversation. Everyone in the project can see it.
            </div>
          )}
          {messages
            .filter((m) => m.role !== "system")
            .map((m, i) => (
              <div
                key={i}
                className={`max-w-3xl mx-auto flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`rounded-2xl px-4 py-2.5 whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  {m.content ||
                    (sending && i === messages.length - 1 ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      ""
                    ))}
                </div>
              </div>
            ))}
        </div>
        <div className="border-t p-3">
          {sendError ? (
            <div
              className="mx-auto mb-2 flex max-w-3xl items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
              role="alert"
            >
              <span>{sendError}</span>
              <Button variant="ghost" size="sm" onClick={() => void handleSend()}>
                Retry
              </Button>
            </div>
          ) : null}
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={canEdit ? "Message the project…" : "You have view-only access"}
              disabled={!canEdit || sending}
              rows={2}
              className="resize-none"
            />
            {sending ? (
              <Button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop generating"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button onClick={handleSend} disabled={!canEdit || !input.trim()} aria-label="Send">
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
