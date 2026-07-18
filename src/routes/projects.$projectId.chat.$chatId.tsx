import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Send, Trash2 } from "lucide-react";
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
    meta: [
      { title: "Project chat | KovaGPT" },
      { name: "robots", content: "noindex" },
    ],
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
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fnGetChat = useServerFn(getProjectChat);
  const fnGetProject = useServerFn(getProject);
  const fnSave = useServerFn(saveProjectChat);
  const fnDelete = useServerFn(deleteProjectChat);

  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
      try {
        const [c, p] = await Promise.all([
          fnGetChat({ data: { id: chatId } }),
          fnGetProject({ data: { id: projectId } }),
        ]);
        if (!c) { toast.error("Chat not found"); navigate({ to: "/projects/$projectId", params: { projectId } }); return; }
        setProject(p);
        setTitle(c.title);
        setMessages(c.snapshot.messages ?? []);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load chat");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, [isSignedIn, chatId, projectId]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, sending]);

  if (!isLoaded) return <AppShell><div className="p-8 text-muted-foreground">Loading…</div></AppShell>;
  if (!isSignedIn) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto p-8 text-center">
          <h1 className="text-2xl font-semibold mb-2">Sign in required</h1>
          <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
        </div>
      </AppShell>
    );
  }
  if (loading) {
    return <AppShell><div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading chat…</div></AppShell>;
  }

  const canEdit = project?.role === "owner" || project?.role === "editor";

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !canEdit) return;
    setInput("");
    const userMsg: ProjectChatMessage = { role: "user", content: text };
    const priorSystem: ProjectChatMessage[] = project?.system_prompt
      ? [{ role: "system", content: project.system_prompt }]
      : [];
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setSending(true);
    let assistant = "";
    try {
      const resp = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...priorSystem, ...nextHistory].map((m) => ({ role: m.role, content: m.content })),
          mode: "default",
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
          } catch { /* ignore */ }
        }
      }
      const finalMsgs: ProjectChatMessage[] = [...nextHistory, { role: "assistant", content: assistant }];
      await fnSave({ data: { id: chatId, messages: finalMsgs } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
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
          <Link to="/projects/$projectId" params={{ projectId }} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <button className="font-medium truncate flex-1 text-left hover:underline" onClick={handleRename}>{title}</button>
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={handleDelete} aria-label="Delete"><Trash2 className="w-4 h-4" /></Button>
          )}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {messages.filter((m) => m.role !== "system").length === 0 && (
            <div className="text-center text-muted-foreground text-sm">Start the conversation. Everyone in the project can see it.</div>
          )}
          {messages.filter((m) => m.role !== "system").map((m, i) => (
            <div key={i} className={`max-w-3xl mx-auto flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`rounded-2xl px-4 py-2.5 whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m.content || (sending && i === messages.length - 1 ? <Loader2 className="w-4 h-4 animate-spin" /> : "")}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t p-3">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              placeholder={canEdit ? "Message the project…" : "You have view-only access"}
              disabled={!canEdit || sending}
              rows={2}
              className="resize-none"
            />
            <Button onClick={handleSend} disabled={!canEdit || sending || !input.trim()}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
