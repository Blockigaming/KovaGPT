import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type Conversation,
  archiveConversation,
  loadConversations,
  saveConversations,
} from "@/lib/chat-store";
import { chatHistorySnapshot } from "@/lib/chat-history-bridge";
import { completeProjectChatMove } from "@/lib/project-chat-move.mjs";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import { importChatToProject } from "@/lib/project-workspace.functions";

export function ChatProjectDialog({
  open,
  onOpenChange,
  conversation,
  initialProjectId = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation | null;
  initialProjectId?: string;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const principalId = isLoaded && isSignedIn ? (user?.id ?? "") : "";
  // The selected sidebar conversation belongs to the account that opened this dialog.
  // A later principal must explicitly select a chat again before any copy is allowed.
  const openedFor = useRef(principalId);
  const canAccess = Boolean(principalId && principalId === openedFor.current);
  const getProjects = useServerFn(listProjects);
  const importChat = useServerFn(importChatToProject);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [titleSubmitted, setTitleSubmitted] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const errorFocusRef = useRef<{
    request: number;
    principalId: string;
    conversationId: string;
    trigger: Element | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<{
    id: string;
    projectId: string;
    name: string;
    moved: boolean;
  } | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const current = useRef({ open, principalId, conversationId: conversation?.id, canAccess });
  current.current = { open, principalId, conversationId: conversation?.id, canAccess };
  const projectFieldId = useId();
  const titleFieldId = useId();
  const titleErrorId = `${titleFieldId}-error`;
  const titleError = titleTouched
    ? !title.trim()
      ? "Enter a chat title."
      : title.trim().length > 200
        ? "Use a chat title of 200 characters or fewer."
        : ""
    : "";

  useEffect(() => {
    if (!error || busy) return;
    const origin = errorFocusRef.current;
    errorFocusRef.current = null;
    const scope = current.current;
    if (
      !origin ||
      generation.current !== origin.request ||
      !scope.open ||
      !scope.canAccess ||
      scope.principalId !== origin.principalId ||
      scope.conversationId !== origin.conversationId
    )
      return;
    const active = document.activeElement;
    if (active === null || active === document.body || active === origin.trigger)
      errorRef.current?.focus({ preventScroll: true });
  }, [error, busy]);

  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    setProjects([]);
    setProjectId(initialProjectId);
    setLoadError("");
    setError("");
    setTitleTouched(false);
    setTitleSubmitted(false);
    errorFocusRef.current = null;
    setAdded(null);
    setBusy(false);
    inFlight.current = false;
    completed.current = false;
    setTitle(conversation?.title.trim() || "Untitled chat");
    setLoading(Boolean(open && canAccess && conversation));
    if (open && canAccess && conversation) {
      void getProjects()
        .then((items) => {
          if (!active || generation.current !== request) return;
          setProjects(
            items.filter(
              (project) =>
                (project.role === "owner" || project.role === "editor") &&
                !project.archived_at &&
                !project.deletion_requested_at,
            ),
          );
        })
        .catch(() => {
          if (active && generation.current === request) {
            setLoadError("Could not load your projects. Try again.");
          }
        })
        .finally(() => {
          if (active && generation.current === request) setLoading(false);
        });
    }
    return () => {
      active = false;
      // This counter intentionally invalidates pending work, including on unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      errorFocusRef.current = null;
    };
    // Refresh when the selected chat or account changes, not while the user edits the title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canAccess, principalId, conversation?.id, getProjects, attempt, initialProjectId]);

  const renderGeneration = generation.current;
  const submit = async () => {
    const selected = projects.find((project) => project.id === projectId);
    const scope = current.current;
    if (
      generation.current !== renderGeneration ||
      inFlight.current ||
      completed.current ||
      added ||
      loading ||
      !open ||
      !canAccess ||
      !conversation ||
      !selected ||
      !scope.open ||
      !scope.canAccess ||
      scope.principalId !== principalId ||
      scope.conversationId !== conversation.id
    )
      return;
    const trimmedTitle = title.trim();
    setTitleTouched(true);
    setTitleSubmitted(true);
    setError("");
    if (!trimmedTitle || trimmedTitle.length > 200) {
      titleInputRef.current?.focus({ preventScroll: true });
      return;
    }
    errorFocusRef.current = {
      request: generation.current,
      principalId,
      conversationId: conversation.id,
      trigger: document.activeElement,
    };
    const messages = conversation.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map(({ role, content }) => ({ role, content }));
    if (!messages.some((message) => message.content.trim())) {
      setError("This chat has no text messages to add yet.");
      return;
    }
    if (messages.length > 500 || messages.some((message) => message.content.length > 100_000)) {
      setError("This chat is too long to copy into a project. Create a shorter chat first.");
      return;
    }
    const request = generation.current;
    const isCurrent = () =>
      generation.current === request &&
      current.current.open &&
      current.current.canAccess &&
      current.current.principalId === principalId &&
      current.current.conversationId === conversation.id;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await importChat({
        data: { project_id: selected.id, title: trimmedTitle, messages },
      });
      if (!isCurrent()) return;
      if (!result?.id) throw new Error("No saved chat was returned.");
      completed.current = true;
      let moved = false;
      try {
        moved = await completeProjectChatMove({
          source: conversation,
          isCurrent,
          readActive: () => loadConversations(principalId),
          archive: (chat) => archiveConversation(principalId, chat),
          remove: (items) =>
            saveConversations(principalId, items, { snapshot: chatHistorySnapshot(principalId) }),
        });
      } catch {
        /* The confirmed project copy remains available; keep the original on uncertainty. */
      }
      if (!isCurrent()) return;
      setAdded({ id: result.id, projectId: selected.id, name: selected.name, moved });
    } catch {
      if (isCurrent()) {
        setError("Could not confirm the chat was added. Check the project before trying again.");
      }
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>
            {added ? (added.moved ? "Chat moved" : "Project copy saved") : "Move to project"}
          </DialogTitle>
          <DialogDescription>
            Move this chat’s text into a project. Project members can view it. After the project
            copy is saved, the original goes to Archived chats for recovery. Attachments stay with
            the archived original. Future replies in the project update only the project chat.
          </DialogDescription>
        </DialogHeader>
        {!canAccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Your account changed. Close this dialog and select a chat again after logging in.
          </p>
        ) : added ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              {added.moved
                ? `Moved to ${added.name}.`
                : `Saved to ${added.name}. The original was kept because it changed or could not be archived. You can open the project copy below.`}
            </p>
            <Button asChild className="w-full">
              <Link
                to="/projects/$projectId/chat/$chatId"
                params={{ projectId: added.projectId, chatId: added.id }}
                onClick={() => onOpenChange(false)}
              >
                Open project chat
              </Link>
            </Button>
          </div>
        ) : loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading projects…
          </p>
        ) : loadError ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm">
              {loadError}
            </p>
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No writable projects found. Choose a project where you are an owner or editor.
              Archived projects aren’t available.
            </p>
            <Button asChild variant="outline">
              <Link to="/projects" onClick={() => onOpenChange(false)}>
                Go to projects
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor={projectFieldId} className="text-sm font-medium">
                Project
              </label>
              <SearchablePicker
                id={projectFieldId}
                value={projectId}
                onValueChange={setProjectId}
                disabled={busy}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                placeholder="Select a project"
                searchLabel="Search projects"
                options={projects.map((project) => ({ value: project.id, label: project.name }))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={titleFieldId} className="text-sm font-medium">
                Chat title
              </label>
              <Input
                id={titleFieldId}
                ref={titleInputRef}
                aria-invalid={Boolean(titleError)}
                aria-describedby={titleError ? titleErrorId : undefined}
                value={title}
                maxLength={200}
                disabled={busy}
                onChange={(event) => {
                  const scope = current.current;
                  if (
                    generation.current !== renderGeneration ||
                    !scope.open ||
                    !scope.canAccess ||
                    scope.principalId !== principalId ||
                    scope.conversationId !== conversation?.id ||
                    inFlight.current
                  )
                    return;
                  setTitle(event.target.value);
                }}
                onBlur={() => {
                  const scope = current.current;
                  if (
                    generation.current === renderGeneration &&
                    scope.open &&
                    scope.canAccess &&
                    scope.principalId === principalId &&
                    scope.conversationId === conversation?.id
                  )
                    setTitleTouched(true);
                }}
              />
              {titleError && (
                <p id={titleErrorId} className="text-sm text-destructive">
                  {titleError}
                </p>
              )}
            </div>
            {titleSubmitted && titleError && (
              <p role="alert" className="text-sm text-destructive">
                Review the highlighted chat title before adding this chat.
              </p>
            )}
            {error && (
              <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {error && projectId && (
              <Link
                to="/projects/$projectId"
                params={{ projectId }}
                className="inline-block text-sm underline"
                onClick={() => onOpenChange(false)}
              >
                Open project to check
              </Link>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {added ? "Done" : "Cancel"}
          </Button>
          {canAccess && !added && projects.length > 0 && !loadError && (
            <Button disabled={busy || loading || !projectId} onClick={submit}>
              {busy ? "Moving…" : "Move to project"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
