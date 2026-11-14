import { useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Folder, FolderPlus, Search } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { createProjectChat, listProjects, type ProjectSummary } from "@/lib/projects.functions";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

type ProjectSnapshot = {
  principalId: string;
  projects: ProjectSummary[];
  status: "ready" | "error";
};

/** Reads existing projects only. Opening a project never moves or copies this chat. */
export function ComposerProjectPicker({
  open,
  onOpenChange,
  navigationBlocked,
  navigationBlockedReason = "Send or clear your draft and attachments before opening a project.",
  anchorRef,
  startChat,
  side,
  returnFocusTarget,
  returnFocusUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Must include unsent text, attachments, streaming, and unresolved composer state. */
  navigationBlocked: boolean;
  navigationBlockedReason?: string;
  anchorRef: RefObject<HTMLElement | null>;
  startChat: boolean;
  side: "top" | "bottom";
  returnFocusTarget?: HTMLElement | null;
  returnFocusUrl?: string;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const principalId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const navigate = useNavigate();
  const getProjects = useServerFn(listProjects);
  const createChat = useServerFn(createProjectChat);
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
  const [refresh, setRefresh] = useState(0);
  const [projectQuery, setProjectQuery] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [navigating, setNavigating] = useState<string | null>(null);
  const mounted = useRef(true);
  const navigationPending = useRef(false);
  const storageGeneration = useRef(0);
  const current = useRef({ open, principalId, cycle, canAccess, navigationBlocked });
  current.current = { open, principalId, cycle, canAccess, navigationBlocked };
  const visible = canAccess && snapshot?.principalId === principalId ? snapshot : null;

  useEffect(() => {
    if (open) {
      setProjectQuery("");
      setNavigationError("");
      setNavigating(null);
      navigationPending.current = false;
    }
  }, [open, principalId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const request = storageGeneration.current;
    let active = true;
    if (!principalId) setSnapshot(null);
    if (principalId) {
      setSnapshot((previous) => (previous?.principalId === principalId ? previous : null));
      const isCurrent = () =>
        active &&
        request === storageGeneration.current &&
        current.current.principalId === principalId;
      const showLoadError = () => {
        if (!isCurrent()) return;
        setSnapshot((previous) =>
          previous?.principalId === principalId && previous.status === "ready"
            ? previous
            : { principalId, projects: [], status: "error" },
        );
      };
      void getProjects().then((projects) => {
        if (!isCurrent()) return;
        if (!Array.isArray(projects)) {
          showLoadError();
          return;
        }
        setSnapshot({
          principalId,
          projects: projects.filter(
            (project) => !project.archived_at && !project.deletion_requested_at,
          ),
          status: "ready",
        });
      }, showLoadError);
    }
    return () => {
      active = false;
    };
  }, [principalId, getProjects, refresh]);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) setRefresh((value) => value + 1);
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!principalId) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, principalId)) return;
      opening.current.invalidated = open;
      current.current.canAccess = false;
      storageGeneration.current++;
      setSnapshot(null);
      setRefresh((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [open, principalId]);

  const matchingProjects =
    visible?.status === "ready"
      ? visible.projects.filter((project) =>
          project.name.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()),
        )
      : [];

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
      !visible.projects.some(
        (project) => project.id === projectId && (!startChat || project.role !== "viewer"),
      )
    )
      return;
    navigationPending.current = true;
    setNavigating(projectId);
    setNavigationError("");
    const request = storageGeneration.current;
    const isCurrent = () =>
      mounted.current &&
      request === storageGeneration.current &&
      current.current.canAccess &&
      current.current.principalId === principalId &&
      current.current.cycle === cycle;
    try {
      if (startChat) {
        const result = await createChat({
          data: { project_id: projectId, title: "New chat", messages: [] },
        });
        if (!isCurrent()) return;
        await navigate({
          to: "/projects/$projectId/chat/$chatId",
          params: { projectId, chatId: result.id },
        });
      } else {
        await navigate({ to: "/projects/$projectId", params: { projectId } });
      }
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
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next || !navigationPending.current) onOpenChange(next);
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        role="dialog"
        aria-label="Choose project"
        side={side}
        align="start"
        className={startChat ? "kova-composer-menu kova-composer-full-menu" : "kova-composer-menu"}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDialogFocus(returnFocusTarget, returnFocusUrl, navigationPending.current);
        }}
      >
        {visible?.status === "ready" ? (
          <div className="space-y-2">
            <label className="kova-composer-menu-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Search projects</span>
              <input
                type="search"
                aria-label="Search projects"
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder="Search projects"
                className="w-full bg-transparent text-sm"
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full justify-start rounded-xl"
              disabled={navigationBlocked || navigating !== null}
              onClick={async () => {
                if (navigationPending.current || navigationBlocked) return;
                navigationPending.current = true;
                setNavigating("__new__");
                setNavigationError("");
                try {
                  await navigate({ to: "/projects", search: { new: true } });
                  if (mounted.current) onOpenChange(false);
                } catch {
                  if (mounted.current) setNavigationError("Could not open the new project form.");
                } finally {
                  navigationPending.current = false;
                  if (mounted.current) setNavigating(null);
                }
              }}
            >
              <FolderPlus aria-hidden="true" />
              {navigating === "__new__" ? "Opening…" : "New project"}
            </Button>
          </div>
        ) : null}
        {!canAccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Close this picker and open it again after signing in to your account.
          </p>
        ) : !visible ? (
          <div
            aria-busy="true"
            aria-label="Projects"
            className="h-10 rounded-lg bg-muted motion-safe:animate-pulse"
          />
        ) : visible.status === "error" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm">
              Your projects could not be loaded.
            </p>
            <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
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
              {matchingProjects.map((project) => (
                <li key={project.id}>
                  <Button
                    data-kova-button-shape="preserve"
                    type="button"
                    variant="ghost"
                    disabled={
                      navigationBlocked ||
                      navigating !== null ||
                      (startChat && project.role === "viewer")
                    }
                    onClick={() => void chooseProject(project.id)}
                    className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal rounded-xl px-3 py-2 text-left"
                    aria-label={`Open project ${project.name}`}
                  >
                    <span className="flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
                      <Folder aria-hidden="true" />
                      {project.name}
                    </span>
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
            {matchingProjects.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                No matching projects.
              </p>
            ) : null}
          </div>
        )}
        {navigationError && (
          <p role="alert" className="text-sm">
            {navigationError}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
