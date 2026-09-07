import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { ChatInput, type PendingAttachment } from "@/components/ChatInput";
import { ChatMessage } from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import { chatResponseError, consumeChatSse } from "@/lib/chat-sse-client.mjs";
import type { Message } from "@/lib/chat-store";
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
    meta: [{ title: "KovaGPT Project" }, { name: "robots", content: "noindex" }],
  }),
});

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function ProjectChatPage() {
  const { projectId, chatId } = Route.useParams();
  const { isSignedIn, isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeChatIdRef = useRef(chatId);
  const renameTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  const fnGetChat = useServerFn(getProjectChat);
  const fnGetProject = useServerFn(getProject);
  const fnSave = useServerFn(saveProjectChat);
  const fnDelete = useServerFn(deleteProjectChat);

  activeChatIdRef.current = chatId;

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    setLoading(true);
    setSending(false);
    setInput("");
    setComposerAttachments([]);
    setRenameOpen(false);
    setRenameDraft("");
    setRenaming(false);
    setDeleteOpen(false);
    setDeleting(false);
    abortControllerRef.current?.abort();

    void (async () => {
      try {
        const [chat, nextProject] = await Promise.all([
          fnGetChat({ data: { id: chatId } }),
          fnGetProject({ data: { id: projectId } }),
        ]);
        if (cancelled) return;
        if (!chat) {
          toast.error("Chat not found");
          navigate({ to: "/projects/$projectId", params: { projectId } });
          return;
        }
        setProject(nextProject);
        setTitle(chat.title);
        setMessages(chat.snapshot.messages ?? []);
        setComposerAttachments([]);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        toast.error("Failed to load chat");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      abortControllerRef.current?.abort();
    };
    // The server function wrappers are intentionally omitted because they are
    // recreated during render; route identity is the data-loading boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, chatId, projectId]);

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
        <div className="mx-auto max-w-2xl p-8 text-center">
          <h1 className="mb-2 text-2xl font-semibold">Sign in required</h1>
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
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading chat…
        </div>
      </AppShell>
    );
  }

  const canEdit = project?.role === "owner" || project?.role === "editor";
  const visibleMessages = messages.filter(
    (
      message,
    ): message is ProjectChatMessage & {
      role: Message["role"];
    } => message.role !== "system",
  );

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !canEdit) return;

    const requestChatId = chatId;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const userMessage: ProjectChatMessage = { role: "user", content: text };
    const nextHistory = [...messages, userMessage];
    setInput("");
    setComposerAttachments([]);
    setMessages([...nextHistory, { role: "assistant", content: "" }]);
    setSending(true);

    let assistant = "";
    try {
      const response = await authFetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextHistory
            .filter((message) => message.role === "user" || message.role === "assistant")
            .map((message) => ({
              role: message.role,
              content: message.content,
            })),
          mode: "default",
          user: {},
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
          projectId,
        }),
      });
      if (!response.ok || !response.body) {
        throw await chatResponseError(response);
      }

      await consumeChatSse(response.body, {
        signal: controller.signal,
        onEvent: (parsed) => {
          const delta = (
            parsed as {
              choices?: Array<{ delta?: { content?: unknown } }>;
            }
          ).choices?.[0]?.delta?.content;
          if (typeof delta !== "string" || !delta) return;
          assistant += delta;
          if (activeChatIdRef.current === requestChatId) {
            setMessages([
              ...nextHistory,
              {
                role: "assistant",
                content: assistant,
              },
            ]);
          }
        },
      });
    } catch (error) {
      if (!isAbortError(error)) {
        toast.error(error instanceof Error ? error.message : "Failed to generate a response");
      }
    } finally {
      const finalMessages: ProjectChatMessage[] = assistant.trim()
        ? [...nextHistory, { role: "assistant", content: assistant }]
        : nextHistory;

      if (activeChatIdRef.current === requestChatId) {
        setMessages(finalMessages);
      }

      try {
        await fnSave({ data: { id: requestChatId, messages: finalMessages } });
      } catch (error) {
        console.error(error);
        if (activeChatIdRef.current === requestChatId) {
          toast.error("The chat could not be saved");
        }
      }

      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (activeChatIdRef.current === requestChatId) {
        setSending(false);
      }
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  async function handleDelete() {
    if (!canEdit || deleting || sending) return;
    setDeleting(true);
    try {
      await fnDelete({ data: { id: chatId } });
      navigate({ to: "/projects/$projectId", params: { projectId } });
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete chat");
      setDeleting(false);
    }
  }

  function openRenameDialog() {
    if (!canEdit || sending) return;
    setRenameDraft(title);
    setRenameOpen(true);
  }

  async function handleRename() {
    const nextTitle = renameDraft.trim();
    if (!canEdit || renaming || sending || !nextTitle) return;
    if (nextTitle === title) {
      setRenameOpen(false);
      return;
    }

    setRenaming(true);
    try {
      await fnSave({ data: { id: chatId, title: nextTitle, messages } });
      setTitle(nextTitle);
      setRenameOpen(false);
    } catch (error) {
      console.error(error);
      toast.error("Failed to rename chat");
    } finally {
      setRenaming(false);
    }
  }

  return (
    <AppShell>
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:gap-3 sm:px-4">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to project"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {canEdit ? (
            <button
              ref={renameTriggerRef}
              type="button"
              className="min-h-11 min-w-0 flex-1 truncate rounded-lg px-2 text-left font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              onClick={openRenameDialog}
              disabled={sending}
              aria-label="Project chat title"
            >
              {title}
            </button>
          ) : (
            <div className="min-w-0 flex-1 truncate px-2 font-medium">{title}</div>
          )}
          {canEdit && (
            <AlertDialog
              open={deleteOpen}
              onOpenChange={(open) => {
                if (!deleting) setDeleteOpen(open);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  ref={deleteTriggerRef}
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  disabled={sending}
                  aria-label="Delete chat"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  deleteTriggerRef.current?.focus();
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the conversation for everyone in the project. This action cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={(event) => {
                      event.preventDefault();
                      void handleDelete();
                    }}
                  >
                    {deleting ? "Deleting…" : "Delete chat"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
          {visibleMessages.length === 0 ? (
            <div className="mx-auto max-w-[48rem] px-5 py-12 text-center text-sm text-muted-foreground">
              Start the conversation. Everyone in the project can see it.
            </div>
          ) : null}
          {visibleMessages.map((message, index) => {
            const messageId = `project-${chatId}-${index}`;
            return (
              <ChatMessage
                key={messageId}
                chatId={chatId}
                projectId={projectId}
                userKey={userKey}
                principalResolved={isLoaded}
                message={{
                  id: messageId,
                  role: message.role,
                  content: message.content,
                }}
                streaming={
                  sending && index === visibleMessages.length - 1 && message.role === "assistant"
                }
              />
            );
          })}
        </div>

        <div className="shrink-0 border-t bg-background">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={() => void handleSend()}
            onStop={handleStop}
            isStreaming={sending}
            disabled={!canEdit}
            showAddMenu={false}
            attachments={composerAttachments}
            onAttachmentsChange={setComposerAttachments}
            canChangeAgent={false}
            placeholder={canEdit ? "Message the project…" : "You have view-only access"}
          />
        </div>
      </div>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          if (!renaming) setRenameOpen(open);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            renameTriggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>
              Choose a name everyone in the project will recognize.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleRename();
            }}
          >
            <Input
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              maxLength={200}
              autoFocus
              aria-label="Chat name"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={renaming}
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renaming || !renameDraft.trim()}>
                {renaming ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
