import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

type ProjectSnapshot = {
  principalId: string;
  cycle: number;
  projects: ProjectSummary[];
  status: "loading" | "ready" | "error";
};

/** Reads existing projects only. Opening a project never moves or copies this chat. */
export function ComposerProjectPicker({
  open,
  onOpenChange,
  navigationBlocked,
  navigationBlockedReason = "Send or clear your draft and attachments before opening a project.",
  returnFocusTarget,
  returnFocusUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Must include unsent text, attachments, streaming, and unresolved composer state. */
  navigationBlocked: boolean;
  navigationBlockedReason?: string;
  returnFocusTarget?: HTMLElement | null;
  returnFocusUrl?: string;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const principalId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const navigate = useNavigate();
  const getProjects = useServerFn(listProjects);
  const opening = useRef({ open, principalId, cycle: 0, invalidated: false });
  if (opening.current.open !== open) {
    opening.current = {
      open,
      principalId,
      cycle: opening.current.cycle + 1,
      invalidated: false,
    };
  } else if (open && opening.current.principalId !== principalId) {
    opening.current.invalidated = true;
  }
  const cycle = opening.current.cycle;
  const canAccess = Boolean(open && principalId && !opening.current.invalidated);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [navigationError, setNavigationError] = useState("");
  const [navigating, setNavigating] = useState<string | null>(null);
  const mounted = useRef(true);
  const navigationPending = useRef(false);
  const generation = useRef(0);
  const current = useRef({ open, principalId, cycle, canAccess, navigationBlocked });
  current.current = { open, principalId, cycle, canAccess, navigationBlocked };
  const visible =
    canAccess && snapshot?.principalId === principalId && snapshot.cycle === cycle
      ? snapshot
      : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    setSnapshot(null);
    setNavigationError("");
    setNavigating(null);
    navigationPending.current = false;
    if (canAccess && principalId) {
      setSnapshot({ principalId, cycle, projects: [], status: "loading" });
      const isCurrent = () =>
        active &&
        request === generation.current &&
        current.current.canAccess &&
        current.current.principalId === principalId &&
        current.current.cycle === cycle;
      void getProjects().then(
        (projects) => {
          if (!isCurrent()) return;
          setSnapshot({
            principalId,
            cycle,
            projects: projects.filter(
              (project) => !project.archived_at && !project.deletion_requested_at,
            ),
            status: "ready",
          });
        },
        () => {
          if (isCurrent()) setSnapshot({ principalId, cycle, projects: [], status: "error" });
        },
      );
    }
    return () => {
      active = false;
    };
  }, [canAccess, principalId, cycle, getProjects, attempt]);

  useEffect(() => {
    if (!open || !principalId) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, principalId)) return;
      opening.current.invalidated = true;
      current.current.canAccess = false;
      generation.current++;
      setSnapshot(null);
      setAttempt((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [open, principalId]);

  const chooseProject = async (projectId: string) => {
    const scope = current.current;
    if (
      !scope.open ||
      !mounted.current ||
      !scope.canAccess ||
      scope.navigationBlocked ||
      navigationPending.current ||
      scope.principalId !== principalId ||
      scope.cycle !== cycle ||
      visible?.status !== "ready" ||
      !visible.projects.some((project) => project.id === projectId)
    )
      return;
    navigationPending.current = true;
    setNavigating(projectId);
    setNavigationError("");
    const request = generation.current;
    const isCurrent = () =>
      mounted.current &&
      request === generation.current &&
      current.current.canAccess &&
      current.current.principalId === principalId &&
      current.current.cycle === cycle;
    try {
      await navigate({ to: "/projects/$projectId", params: { projectId } });
      if (isCurrent()) onOpenChange(false);
    } catch {
      if (isCurrent()) setNavigationError("The project could not be opened. Try again.");
    } finally {
      if (isCurrent()) {
        navigationPending.current = false;
        setNavigating(null);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDialogFocus(returnFocusTarget, returnFocusUrl, navigationPending.current);
        }}
      >
        <DialogHeader>
          <DialogTitle>Choose project</DialogTitle>
          <DialogDescription>
            Open a project to use its chats, instructions, and files. This does not move or copy
            your current chat.
          </DialogDescription>
        </DialogHeader>
        {!canAccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Close this picker and open it again after signing in to your account.
          </p>
        ) : !visible || visible.status === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading projects…
          </p>
        ) : visible.status === "error" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm">
              Your projects could not be loaded.
            </p>
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        ) : visible.projects.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            No active projects found.
          </p>
        ) : (
          <div className="space-y-3">
            {navigationBlocked && (
              <p role="status" className="text-sm text-muted-foreground">
                {navigationBlockedReason}
              </p>
            )}
            <ul className="max-h-[50dvh] space-y-2 overflow-y-auto">
              {visible.projects.map((project) => (
                <li key={project.id}>
                  <Button
                    data-kova-button-shape="preserve"
                    type="button"
                    variant="ghost"
                    disabled={navigationBlocked || navigating !== null}
                    onClick={() => void chooseProject(project.id)}
                    className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal rounded-xl border px-3 py-2 text-left"
                    aria-label={`Open project ${project.name}`}
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">{project.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {navigating === project.id
                        ? "Opening…"
                        : project.role === "viewer"
                          ? "View only"
                          : "Open"}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {navigationError && (
          <p role="alert" className="text-sm">
            {navigationError}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
