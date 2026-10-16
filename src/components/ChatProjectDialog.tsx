import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Conversation } from "@/lib/chat-store";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import { importChatToProject } from "@/lib/project-workspace.functions";

export function ChatProjectDialog({
  open,
  onOpenChange,
  conversation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation | null;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<{ id: string; projectId: string; name: string } | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const current = useRef({ open, principalId, conversationId: conversation?.id, canAccess });
  current.current = { open, principalId, conversationId: conversation?.id, canAccess };
  const projectFieldId = useId();
  const titleFieldId = useId();

  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    setProjects([]);
    setProjectId("");
    setLoadError("");
    setError("");
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
    };
    // Refresh when the selected chat or account changes, not while the user edits the title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canAccess, principalId, conversation?.id, getProjects, attempt]);

  const submit = async () => {
    const selected = projects.find((project) => project.id === projectId);
    const scope = current.current;
    if (
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
    if (!trimmedTitle || trimmedTitle.length > 200) {
      setError("Use a title between 1 and 200 characters.");
      return;
    }
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
      setAdded({ id: result.id, projectId: selected.id, name: selected.name });
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
          <DialogTitle>{added ? "Chat added" : "Add to project"}</DialogTitle>
          <DialogDescription>
            Copy this chat’s text into a project. Project members can view the copy. Your original
            chat stays here, and future replies won’t update the copy. Attachments aren’t copied.
          </DialogDescription>
        </DialogHeader>
        {!canAccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Your account changed. Close this dialog and select a chat again after logging in.
          </p>
        ) : added ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              Added to {added.name}.
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
              <select
                id={projectFieldId}
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={busy}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={titleFieldId} className="text-sm font-medium">
                Chat title
              </label>
              <Input
                id={titleFieldId}
                value={title}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm">
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
              {busy ? "Adding…" : "Add to project"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
