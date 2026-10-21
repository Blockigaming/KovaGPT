import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
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
} from "@/components/ui/alert-dialog";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PROJECT_CHAT_DELETE_UNAVAILABLE } from "@/lib/project-chat-deletion";
import { authFetch } from "@/lib/auth-fetch";
import { chatResponseError, consumeChatSse } from "@/lib/chat-sse-client.mjs";
import { loadDraft, saveDraft, type Message } from "@/lib/chat-store";
import { normalizeResponseSources, type ResponseSource } from "@/lib/response-sources";
import {
  getProjectChat,
  saveProjectChat,
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

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const requestKey =
    isLoaded && isSignedIn && userKey ? JSON.stringify([userKey, projectId, chatId]) : null;
  // Reuse the ordinary text draft contract, with a distinct project+chat object identifier.
  const draftObjectId = `project-chat:${JSON.stringify([projectId, chatId])}`;
  const [draft, setDraft] = useState<{ key: string | null; text: string; persisted: boolean }>({
    key: null,
    text: "",
    persisted: true,
  });
  const draftRef = useRef(draft);
  const input = draft.key === requestKey ? draft.text : "";
  const [resolvedRequestKey, setResolvedRequestKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [composerAttachments, setComposerAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestKeyRef = useRef(requestKey);
  currentRequestKeyRef.current = requestKey;
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const sendOperationRef = useRef<symbol | null>(null);
  const mutationOperationRef = useRef<symbol | null>(null);
  const renameTriggerRef = useRef<HTMLButtonElement>(null);

  const fnGetChat = useServerFn(getProjectChat);
  const fnGetProject = useServerFn(getProject);
  const fnSave = useServerFn(saveProjectChat);

  function setInput(text: string) {
    if (
      !requestKey ||
      !userKey ||
      !mountedRef.current ||
      currentRequestKeyRef.current !== requestKey
    )
      return;
    let persisted = false;
    try {
      saveDraft(userKey, draftObjectId, text);
      persisted = true;
    } catch {
      // An unavailable/full browser store must not erase the mounted draft.
    }
    const next = { key: requestKey, text, persisted };
    draftRef.current = next;
    setDraft(next);
  }

  useEffect(() => {
    let text = "";
    let persisted = true;
    if (requestKey && userKey) {
      try {
        text = loadDraft(userKey, draftObjectId);
      } catch {
        persisted = false;
      }
    }
    const next = { key: requestKey, text, persisted };
    draftRef.current = next;
    setDraft(next);
  }, [requestKey, userKey, draftObjectId]);

  const hasUnprotectedWork = Boolean(
    requestKey &&
    draft.key === requestKey &&
    ((!draft.persisted && draft.text.length > 0) || sending),
  );
  const navigationBlocker = useBlocker({
    shouldBlockFn: () => hasUnprotectedWork,
    enableBeforeUnload: hasUnprotectedWork,
    withResolver: true,
  });

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    const isCurrent = () =>
      mountedRef.current &&
      generationRef.current === generation &&
      currentRequestKeyRef.current === requestKey;
    setLoading(Boolean(requestKey));
    setResolvedRequestKey(null);
    setLoadError(null);
    setProject(null);
    setTitle("");
    setMessages([]);
    setSending(false);
    setComposerAttachments([]);
    setRenameOpen(false);
    setRenameDraft("");
    setRenaming(false);
    sendOperationRef.current = null;
    mutationOperationRef.current = null;
    abortControllerRef.current?.abort();

    if (requestKey)
      void (async () => {
        try {
          const [chat, nextProject] = await Promise.all([
            fnGetChat({ data: { id: chatId } }),
            fnGetProject({ data: { id: projectId } }),
          ]);
          if (!isCurrent()) return;
          if (
            !chat ||
            !nextProject ||
            chat.project_id !== projectId ||
            nextProject.id !== projectId
          ) {
            setLoadError(
              "This chat is unavailable in this project. It may have moved or your access may have changed.",
            );
            return;
          }
          setProject(nextProject);
          setTitle(chat.title);
          setMessages(chat.snapshot.messages ?? []);
        } catch {
          if (isCurrent())
            setLoadError("The project chat could not be loaded. Your draft is preserved.");
        } finally {
          if (isCurrent()) {
            setResolvedRequestKey(requestKey);
            setLoading(false);
          }
        }
      })();

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      sendOperationRef.current = null;
      mutationOperationRef.current = null;
      abortControllerRef.current?.abort();
    };
    // Server wrappers are recreated during render; principal+route is the load boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, chatId, projectId, reloadKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  if (!isLoaded || (isSignedIn && !userKey))
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
  if (loading || resolvedRequestKey !== requestKey) {
    return (
      <AppShell>
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading chat…
        </div>
      </AppShell>
    );
  }

  if (loadError || !project) {
    return (
      <AppShell>
        <section className="mx-auto w-full max-w-2xl space-y-4 p-6" role="alert">
          <h1 className="text-xl font-semibold">Project chat unavailable</h1>
          <p>{loadError ?? "The project is unavailable."}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
              Retry loading chat
            </Button>
            <Button variant="outline" asChild>
              <Link to="/projects/$projectId" params={{ projectId }}>
                Back to project
              </Link>
            </Button>
          </div>
        </section>
      </AppShell>
    );
  }

  const canEdit = !project.archived_at && (project.role === "owner" || project.role === "editor");
  const visibleMessages = messages.filter(
    (
      message,
    ): message is ProjectChatMessage & {
      role: Message["role"];
    } => message.role !== "system",
  );

  async function handleSend() {
    const text = draftRef.current.key === requestKey ? draftRef.current.text.trim() : "";
    if (
      !text ||
      !canEdit ||
      !requestKey ||
      !mountedRef.current ||
      currentRequestKeyRef.current !== requestKey ||
      sendOperationRef.current ||
      mutationOperationRef.current
    )
      return;

    const requestChatId = chatId;
    const generation = generationRef.current;
    const operation = Symbol("project chat send");
    sendOperationRef.current = operation;
    const isCurrent = () =>
      mountedRef.current &&
      generationRef.current === generation &&
      currentRequestKeyRef.current === requestKey &&
      sendOperationRef.current === operation;
    const submittedDraft = draftRef.current;
    const clearedDraft = { key: requestKey, text: "", persisted: submittedDraft.persisted };
    draftRef.current = clearedDraft;
    setDraft(clearedDraft);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const userMessage: ProjectChatMessage = { role: "user", content: text };
    const nextHistory = [...messages, userMessage];
    setComposerAttachments([]);
    setMessages([...nextHistory, { role: "assistant", content: "" }]);
    setSending(true);

    let assistant = "";
    let responseCompleted = false;
    let assistantSources: ResponseSource[] | undefined;
    const responseMessage = (): ProjectChatMessage => ({
      role: "assistant",
      content: assistant,
      ...(assistantSources ? { sources: assistantSources } : {}),
    });
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
              choices?: Array<{
                delta?: { content?: unknown; kind?: unknown; sources?: unknown };
              }>;
            }
          ).choices?.[0]?.delta;
          if (delta?.kind === "web_sources") {
            assistantSources = normalizeResponseSources(delta.sources);
          }
          if (typeof delta?.content === "string" && delta.content) {
            assistant += delta.content;
          }
          if (isCurrent()) {
            setMessages([...nextHistory, responseMessage()]);
          }
        },
      });
      responseCompleted = true;
    } catch (error) {
      if (isCurrent() && !isAbortError(error)) {
        toast.error(error instanceof Error ? error.message : "Failed to generate a response");
      }
    } finally {
      const finalMessages: ProjectChatMessage[] = assistant.trim()
        ? [...nextHistory, responseMessage()]
        : nextHistory;

      // A stale route/account must neither mutate its replacement nor persist under a new principal.
      if (isCurrent()) {
        setMessages(finalMessages);
        let saved = false;
        try {
          await fnSave({ data: { id: requestChatId, messages: finalMessages } });
          saved = true;
        } catch {
          if (isCurrent()) toast.error("The chat could not be saved. Your draft is preserved.");
        }
        if (isCurrent()) {
          if (draftRef.current === clearedDraft) {
            // Keep newer typing untouched. Failed/stopped requests retain the original ordinary text.
            setInput(saved && responseCompleted ? "" : submittedDraft.text);
          }
          if (abortControllerRef.current === controller) abortControllerRef.current = null;
          sendOperationRef.current = null;
          setSending(false);
        }
      }
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  function openRenameDialog() {
    if (!canEdit || sendOperationRef.current || mutationOperationRef.current) return;
    setRenameDraft(title);
    setRenameOpen(true);
  }

  async function handleRename() {
    const nextTitle = renameDraft.trim();
    if (
      !canEdit ||
      !nextTitle ||
      !requestKey ||
      !mountedRef.current ||
      currentRequestKeyRef.current !== requestKey ||
      mutationOperationRef.current ||
      sendOperationRef.current
    )
      return;
    if (nextTitle === title) {
      setRenameOpen(false);
      return;
    }
    const generation = generationRef.current;
    const operation = Symbol("rename project chat");
    mutationOperationRef.current = operation;
    const isCurrent = () =>
      mountedRef.current &&
      generationRef.current === generation &&
      currentRequestKeyRef.current === requestKey &&
      mutationOperationRef.current === operation;
    setRenaming(true);
    try {
      await fnSave({ data: { id: chatId, title: nextTitle, messages } });
      if (!isCurrent()) return;
      setTitle(nextTitle);
      setRenameOpen(false);
    } catch {
      if (isCurrent()) toast.error("Failed to rename chat");
    } finally {
      if (isCurrent()) {
        mutationOperationRef.current = null;
        setRenaming(false);
      }
    }
  }

  return (
    <AppShell>
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:gap-3 sm:px-4">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="kova-button flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to project"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm"
          >
            <Link
              to="/projects"
              className="inline-flex min-h-11 items-center rounded px-1 text-muted-foreground hover:underline"
            >
              Projects
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              to="/projects/$projectId"
              params={{ projectId }}
              className="inline-flex min-h-11 max-w-48 items-center rounded px-1 text-muted-foreground hover:underline"
              title={project.name}
            >
              <span className="truncate">{project.name}</span>
            </Link>
            <span aria-hidden="true">/</span>
            <h1 className="min-w-0 max-w-full flex-1" aria-current="page">
              {canEdit ? (
                <button
                  ref={renameTriggerRef}
                  type="button"
                  className="min-h-11 w-full min-w-0 truncate rounded-lg px-2 text-left font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={openRenameDialog}
                  disabled={sending}
                  aria-label="Project chat title"
                >
                  {title}
                </button>
              ) : (
                <div className="min-w-0 flex-1 truncate px-2 font-medium">{title}</div>
              )}
            </h1>
          </nav>
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              disabled
              aria-label={`Delete ${title} unavailable`}
              aria-describedby="project-chat-delete-unavailable"
              title={PROJECT_CHAT_DELETE_UNAVAILABLE}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </header>
        {canEdit && (
          <p
            id="project-chat-delete-unavailable"
            className="px-5 py-2 text-xs text-muted-foreground"
            role="note"
          >
            {PROJECT_CHAT_DELETE_UNAVAILABLE}
          </p>
        )}

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
                  sources: message.sources,
                }}
                streaming={
                  sending && index === visibleMessages.length - 1 && message.role === "assistant"
                }
              />
            );
          })}
        </div>

        <div className="shrink-0 border-t bg-background">
          {draft.key === requestKey && !draft.persisted && input && (
            <p role="status" className="mx-auto max-w-[48rem] px-5 pt-3 text-sm text-destructive">
              Your draft is kept only on this page because browser storage is unavailable. Copy it
              before leaving.
            </p>
          )}
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            onStop={handleStop}
            isStreaming={sending}
            attachmentContext={requestKey ?? undefined}
            latestAssistantText={
              visibleMessages.filter((message) => message.role === "assistant").at(-1)?.content
            }
            disabled={!canEdit}
            showAddMenu={false}
            readOnlyContext={{
              title: "Project context",
              description: `Inspect the context available to this chat in ${project.name}.`,
              content: (
                <div className="space-y-5 text-sm">
                  <section aria-labelledby="project-chat-instructions-heading">
                    <h2 id="project-chat-instructions-heading" className="font-semibold">
                      Project instructions
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {project.name} ·{" "}
                      {project.system_prompt?.trim()
                        ? "Loaded project instructions"
                        : "No project instructions saved"}
                    </p>
                    {project.system_prompt?.trim() && (
                      <p className="mt-2 whitespace-pre-wrap break-words">
                        {project.system_prompt}
                      </p>
                    )}
                  </section>
                  <section aria-labelledby="project-chat-files-heading">
                    <h2 id="project-chat-files-heading" className="font-semibold">
                      Files
                    </h2>
                    <p className="mt-1 text-muted-foreground">
                      When you send a message, the service may retrieve relevant excerpts from this
                      project's uploaded files. Exact excerpts and readiness are not loaded here.
                    </p>
                  </section>
                  <section aria-labelledby="project-chat-results-heading">
                    <h2 id="project-chat-results-heading" className="font-semibold">
                      Saved results
                    </h2>
                    <p className="mt-1 text-muted-foreground">
                      No saved results are explicitly attached to this message. The service may also
                      use saved project memory; those entries are not loaded here.
                    </p>
                  </section>
                  <section aria-labelledby="project-chat-conversation-heading">
                    <h2 id="project-chat-conversation-heading" className="font-semibold">
                      Conversation context
                    </h2>
                    <p className="mt-1 text-muted-foreground">
                      {title} · {visibleMessages.length} loaded messages. This chat's user and
                      assistant messages are sent with your next message.
                    </p>
                  </section>
                  <p className="text-xs text-muted-foreground">
                    Project context follows existing membership and retrieval rules. Individual
                    entries cannot be excluded for a single message here.
                  </p>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId }}
                    className="inline-flex min-h-11 items-center underline"
                  >
                    Inspect {project.name}
                  </Link>
                </div>
              ),
            }}
            attachments={composerAttachments}
            onAttachmentsChange={setComposerAttachments}
            canChangeAgent={false}
            placeholder={
              canEdit
                ? "Message the project…"
                : project.archived_at
                  ? "This project is archived and read-only"
                  : "You have view-only access"
            }
          />
        </div>
      </div>

      <AlertDialog
        open={navigationBlocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) navigationBlocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              {sending
                ? draft.persisted
                  ? "The response is still in progress. Leaving stops it; the conversation may not be saved. Your submitted text remains in this chat's draft unless you replace it."
                  : "The response is still in progress and browser storage is unavailable. Leaving stops it and may lose your message. Stay here and copy your text first."
                : "Browser storage is unavailable. Your unsaved draft will be lost when you leave; copy it first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => navigationBlocker.reset?.()}>
              Stay here
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => navigationBlocker.proceed?.()}>
              Leave chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
