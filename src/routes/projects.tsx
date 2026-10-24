import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import "@/styles/file-directories.css";
import "@/styles/spec400-management.css";
import { createFileRoute, Link, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useServerFn } from "@tanstack/react-start";
import {
  FolderKanban,
  LayoutTemplate,
  Grid2X2,
  List,
  Plus,
  Check,
  X as XIcon,
  Loader2,
  Sparkles,
  Wand2,
  MoreHorizontal,
  Pin,
  PinOff,
  Copy as CopyIcon,
  Archive,
  ArchiveRestore,
  Pencil,
  Trash2,
  Search as SearchIcon,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { SkeletonLine, EmptyState, ErrorState } from "@/components/states";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  pinProject,
  duplicateProject,
  listMyPendingInvites,
  acceptInvite,
  declineInvite,
  type ProjectSummary,
  type PendingInvite,
} from "@/lib/projects.functions";
import { moveChatToProject, setProjectArchived } from "@/lib/project-workspace.functions";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { ProjectTemplatesDialog } from "@/components/ProjectTemplatesDialog";
import { usePrincipalSessionPreferences } from "@/hooks/use-principal-session-preferences";
import {
  MAX_MANAGEMENT_QUERY_LENGTH,
  migrateProjectListPreferences,
  parseProjectListPreferences,
  parseProjectOpenedHistory,
  PROJECT_LIST_STORAGE_BASE,
  type ProjectListPreferences,
} from "@/lib/management-list-preferences.mjs";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export const Route = createFileRoute("/projects")({
  component: ProjectsRoute,
  head: () => ({
    meta: [
      { title: "KovaGPT Projects" },
      { name: "description", content: "Shared collaboration workspaces in KovaGPT." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ProjectsRoute() {
  const projectMatch = useMatch({
    from: "/projects/$projectId",
    shouldThrow: false,
  });

  return projectMatch ? <Outlet /> : <ProjectsPage />;
}

function ProjectsPage() {
  const { isSignedIn, isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const createReturnFocusRef = useRef<HTMLElement | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templatesReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const templatesOpenedUrlRef = useRef<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [createNameTouched, setCreateNameTouched] = useState(false);
  const createNameError = createNameTouched && !name.trim() ? "Enter a project name." : null;
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const createBusyRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createUnconfirmedName, setCreateUnconfirmedName] = useState<string | null>(null);
  const [createChecked, setCreateChecked] = useState(false);
  const createReviewRef = useRef({ name: createUnconfirmedName, checked: createChecked });
  createReviewRef.current = { name: createUnconfirmedName, checked: createChecked };
  const createDialogRef = useRef<HTMLDivElement>(null);
  const createErrorRef = useRef<HTMLDivElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const createActiveRef = useRef(false);
  const createEpochRef = useRef(0);
  const createOperationRef = useRef<object | null>(null);
  const createContextRef = useRef({ isLoaded, isSignedIn, userKey });
  createContextRef.current = { isLoaded, isSignedIn, userKey };
  type CreateSession = { userKey: string; epoch: number; url: string };
  const createSessionRef = useRef<CreateSession | null>(null);
  const createOriginRef = useRef<CreateSession | null>(null);
  const renderedCreateSession = createSessionRef.current;
  const createFailureFocusRef = useRef<{ session: CreateSession; trigger: Element | null } | null>(
    null,
  );
  const createVisible = Boolean(
    createOpen && isLoaded && isSignedIn && createSessionRef.current?.userKey === userKey,
  );

  useEffect(() => {
    createActiveRef.current = true;
    createEpochRef.current++;
    createSessionRef.current = null;
    createOriginRef.current = null;
    createOperationRef.current = null;
    createFailureFocusRef.current = null;
    createBusyRef.current = false;
    setCreateOpen(false);
    setCreateError(null);
    setCreateUnconfirmedName(null);
    setCreateChecked(false);
    createReviewRef.current = { name: null, checked: false };
    setBusy(false);
    return () => {
      createActiveRef.current = false;
      // Invalidate asynchronous work; this counter is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      createEpochRef.current++;
      createSessionRef.current = null;
      createOriginRef.current = null;
      createOperationRef.current = null;
      createFailureFocusRef.current = null;
      createBusyRef.current = false;
    };
  }, [isLoaded, isSignedIn, userKey]);

  function isCreateCurrent(session: CreateSession, operation?: object) {
    const context = createContextRef.current;
    return (
      createActiveRef.current &&
      context.isLoaded &&
      context.isSignedIn &&
      context.userKey === session.userKey &&
      createEpochRef.current === session.epoch &&
      createSessionRef.current === session &&
      window.location.href === session.url &&
      (!operation || createOperationRef.current === operation)
    );
  }
  function openCreate(trigger: HTMLButtonElement) {
    const context = createContextRef.current;
    if (
      !createActiveRef.current ||
      !context.isLoaded ||
      !context.isSignedIn ||
      !userKey ||
      context.userKey !== userKey ||
      createBusyRef.current
    )
      return;
    const session = { userKey, epoch: createEpochRef.current, url: window.location.href };
    createSessionRef.current = session;
    createOriginRef.current = session;
    createReturnFocusRef.current = trigger;
    createFailureFocusRef.current = null;
    setCreateError(null);
    setCreateOpen(true);
  }
  function closeCreate() {
    if (createBusyRef.current) return;
    createSessionRef.current = null;
    createFailureFocusRef.current = null;
    setCreateError(null);
    setCreateOpen(false);
  }
  function restoreCreateFocus(event: Event) {
    event.preventDefault();
    const origin = createOriginRef.current;
    createOriginRef.current = null;
    const trigger = createReturnFocusRef.current;
    const active = document.activeElement;
    const context = createContextRef.current;
    restoreDialogFocus(
      trigger,
      origin?.url,
      !origin ||
        !createActiveRef.current ||
        !context.isLoaded ||
        !context.isSignedIn ||
        context.userKey !== origin.userKey ||
        createEpochRef.current !== origin.epoch ||
        (active !== null &&
          active !== document.body &&
          active !== trigger &&
          !createDialogRef.current?.contains(active)),
    );
  }
  useEffect(() => {
    if (busy || !createError) return;
    const origin = createFailureFocusRef.current;
    createFailureFocusRef.current = null;
    if (!origin || !isCreateCurrent(origin.session)) return;
    const active = document.activeElement;
    restoreDialogFocus(
      createErrorRef.current,
      origin.session.url,
      active !== null && active !== document.body && active !== origin.trigger,
    );
  });
  const navigate = useNavigate();
  // Run the one-time, same-owner legacy migration before the shared hook hydrates.
  useEffect(() => {
    if (isLoaded) migrateProjectListPreferences(safeBrowserStorage("sessionStorage"), userKey);
  }, [isLoaded, userKey]);
  const [{ query, sort: sortBy, scope, archived: showArchived, view }, setListPreferences] =
    usePrincipalSessionPreferences(
      PROJECT_LIST_STORAGE_BASE,
      isLoaded ? userKey : undefined,
      parseProjectListPreferences,
    );
  const setQuery = (query: string) => setListPreferences({ query });
  const setSortBy = (sort: ProjectListPreferences["sort"]) => setListPreferences({ sort });
  const setScope = (scope: ProjectListPreferences["scope"]) => setListPreferences({ scope });
  const setView = (view: ProjectListPreferences["view"]) => setListPreferences({ view });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openedHistory, setOpenedHistory] = useState<{
    userKey: string | null;
    entries: Record<string, number>;
  }>({ userKey: null, entries: {} });
  const openedProjects = isLoaded && openedHistory.userKey === userKey ? openedHistory.entries : {};
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null);
  const [deletingProjectIds, setDeletingProjectIds] = useState<Set<string>>(() => new Set());
  const [resolvedUserKey, setResolvedUserKey] = useState<string | null>(null);
  const currentUserKeyRef = useRef(userKey);
  const refreshSequenceRef = useRef(0);
  const retryPanelRef = useRef<HTMLDivElement>(null);
  const retryReturnRef = useRef<{
    trigger: HTMLButtonElement | null;
    url: string;
    userKey: string | null;
    requestId: number;
  } | null>(null);
  currentUserKeyRef.current = userKey;

  useEffect(() => {
    if (!isLoaded) return;
    const reset = (event: Event) => {
      if (
        currentUserKeyRef.current !== userKey ||
        !isPrincipalBrowserStorageClearedEvent(event, userKey)
      )
        return;
      setOpenedHistory({ userKey, entries: {} });
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, userKey]);

  const fnList = useServerFn(listProjects);
  const fnInvites = useServerFn(listMyPendingInvites);
  const fnCreate = useServerFn(createProject);
  const fnAccept = useServerFn(acceptInvite);
  const fnDecline = useServerFn(declineInvite);
  const fnUpdate = useServerFn(updateProject);
  const fnDelete = useServerFn(deleteProject);
  const fnPin = useServerFn(pinProject);
  const fnDuplicate = useServerFn(duplicateProject);
  const fnArchive = useServerFn(setProjectArchived);
  const fnMoveChat = useServerFn(moveChatToProject);
  const [dropProjectId, setDropProjectId] = useState<string | null>(null);

  const [renameFor, setRenameFor] = useState<ProjectSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDesc, setRenameDesc] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameOwner, setRenameOwner] = useState<string | null>(null);
  const [renameDiscardOpen, setRenameDiscardOpen] = useState(false);
  const [renameNameVisited, setRenameNameVisited] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameActiveRef = useRef(false);
  const renameOperationRef = useRef<object | null>(null);
  const renameOriginRef = useRef<{
    userKey: string;
    projectId: string;
    url: string;
  } | null>(null);
  const projectMenuTriggers = useRef(new Map<string, HTMLButtonElement>());
  const renameDialogRef = useRef<HTMLDivElement>(null);
  const renameDiscardDialogRef = useRef<HTMLDivElement>(null);
  const renameNameInputRef = useRef<HTMLInputElement>(null);
  const renameEditFocusRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const renameVisible = Boolean(isLoaded && isSignedIn && renameOwner === userKey && renameFor);
  const renameNameError =
    renameVisible && renameNameVisited && !renameName.trim() ? "Enter a project name" : null;
  const renameContextRef = useRef({ isLoaded, isSignedIn, userKey });
  renameContextRef.current = { isLoaded, isSignedIn, userKey };
  const renameDirty = Boolean(
    renameFor && (renameName !== renameFor.name || renameDesc !== (renameFor.description ?? "")),
  );

  useEffect(() => {
    // Invalidate pending completions and focus origins even while auth is unresolved.
    renameActiveRef.current = false;
    renameOperationRef.current = null;
    renameOriginRef.current = null;
    renameEditFocusRef.current = null;
    setRenameFor(null);
    setRenameOwner(null);
    setRenameName("");
    setRenameDesc("");
    setRenameBusy(false);
    setRenameDiscardOpen(false);
    setRenameNameVisited(false);
    setRenameError(null);
  }, [isLoaded, isSignedIn, userKey]);

  useEffect(
    () => () => {
      renameActiveRef.current = false;
      renameOperationRef.current = null;
      renameOriginRef.current = null;
    },
    [],
  );

  async function togglePin(p: ProjectSummary) {
    const operationUserKey = userKey;
    const next = !p.pinned_at;
    setProjects((prev) =>
      prev.map((x) =>
        x.id === p.id ? { ...x, pinned_at: next ? new Date().toISOString() : null } : x,
      ),
    );
    try {
      await fnPin({ data: { id: p.id, pinned: next } });
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(e instanceof Error ? e.message : "Failed to pin");
      void refresh();
    }
  }
  async function toggleArchive(p: ProjectSummary) {
    const operationUserKey = userKey;
    const archive = !p.archived_at;
    setProjects((prev) =>
      prev.map((x) =>
        x.id === p.id ? { ...x, archived_at: archive ? new Date().toISOString() : null } : x,
      ),
    );
    try {
      await fnArchive({ data: { id: p.id, archived: archive } });
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.success(archive ? "Project archived" : "Project restored");
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(e instanceof Error ? e.message : "Failed");
      void refresh();
    }
  }
  async function handleDuplicate(p: ProjectSummary) {
    const operationUserKey = userKey;
    try {
      const { id } = await fnDuplicate({ data: { id: p.id } });
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.success("Project duplicated");
      void refresh();
      await navigate({ to: "/projects/$projectId", params: { projectId: id } });
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(e instanceof Error ? e.message : "Failed to duplicate");
    }
  }
  async function handleDelete(p: ProjectSummary) {
    const operationUserKey = userKey;
    const toastId = toast.loading("Deleting the project and its stored files…");
    setDeletingProjectIds((current) => new Set(current).add(p.id));
    try {
      await fnDelete({ data: { id: p.id } });
      if (currentUserKeyRef.current !== operationUserKey) return;
      setProjects((current) => current.filter((project) => project.id !== p.id));
      toast.success("Project deleted", { id: toastId });
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(e instanceof Error ? e.message : "Failed to delete", { id: toastId });
      // Cleanup is resumable. Reload the durable project state instead of
      // pretending an interrupted Storage deletion succeeded.
      await refresh();
    } finally {
      if (currentUserKeyRef.current !== operationUserKey) {
        toast.dismiss(toastId);
      } else {
        setDeletingProjectIds((current) => {
          const next = new Set(current);
          next.delete(p.id);
          return next;
        });
      }
    }
  }
  function openRename(p: ProjectSummary) {
    if (!isLoaded || !isSignedIn || !userKey || currentUserKeyRef.current !== userKey) return;
    if (renameOperationRef.current) return;
    renameOriginRef.current = { userKey, projectId: p.id, url: window.location.href };
    renameActiveRef.current = true;
    renameEditFocusRef.current = null;
    setRenameOwner(userKey);
    setRenameDiscardOpen(false);
    setRenameNameVisited(false);
    setRenameError(null);
    setRenameFor(p);
    setRenameName(p.name);
    setRenameDesc(p.description ?? "");
  }
  function closeRename() {
    renameActiveRef.current = false;
    renameOperationRef.current = null;
    setRenameBusy(false);
    setRenameDiscardOpen(false);
    setRenameNameVisited(false);
    setRenameError(null);
    setRenameFor(null);
    setRenameOwner(null);
    setRenameName("");
    setRenameDesc("");
  }
  function requestRenameClose() {
    if (!renameVisible || renameOperationRef.current || renameDiscardOpen) return;
    if (renameDirty) {
      setRenameDiscardOpen(true);
      return;
    }
    closeRename();
  }
  function restoreRenameFocus(event: Event, fromDiscard = false) {
    event.preventDefault();
    // When both layers close, the confirmation owns the final focus restoration.
    if (!fromDiscard && renameDiscardDialogRef.current?.isConnected) return;
    const origin = renameOriginRef.current;
    renameOriginRef.current = null;
    if (!origin || currentUserKeyRef.current !== origin.userKey) return;
    const trigger = projectMenuTriggers.current.get(origin.projectId);
    const target =
      trigger?.isConnected && trigger.getClientRects().length ? trigger : searchInputRef.current;
    const focused = document.activeElement;
    if (
      focused &&
      focused !== document.body &&
      focused !== target &&
      !renameDialogRef.current?.contains(focused) &&
      !renameDiscardDialogRef.current?.contains(focused)
    )
      return;
    restoreDialogFocus(target, origin.url);
  }
  function restoreRenameEditingFocus(event: Event) {
    event.preventDefault();
    if (!renameActiveRef.current) {
      restoreRenameFocus(event, true);
      return;
    }
    const origin = renameOriginRef.current;
    if (!origin || currentUserKeyRef.current !== origin.userKey) return;
    const input = renameEditFocusRef.current;
    const target = input?.isConnected ? input : renameNameInputRef.current;
    const focused = document.activeElement;
    if (
      focused &&
      focused !== document.body &&
      focused !== target &&
      !renameDiscardDialogRef.current?.contains(focused)
    )
      return;
    restoreDialogFocus(target, origin.url);
  }
  async function saveRename() {
    if (!renameVisible || !renameFor || renameDiscardOpen || renameOperationRef.current) return;
    const operationUserKey = userKey;
    const origin = renameOriginRef.current;
    if (
      !origin ||
      origin.userKey !== operationUserKey ||
      origin.projectId !== renameFor.id ||
      currentUserKeyRef.current !== operationUserKey
    )
      return;
    setRenameNameVisited(true);
    if (!renameName.trim()) {
      renameNameInputRef.current?.focus();
      return;
    }
    const operation = {};
    renameOperationRef.current = operation;
    const current = () =>
      renameActiveRef.current &&
      renameOperationRef.current === operation &&
      renameOriginRef.current === origin &&
      currentUserKeyRef.current === operationUserKey &&
      renameContextRef.current.isLoaded &&
      renameContextRef.current.isSignedIn;
    setRenameBusy(true);
    const target = renameFor;
    const nextName = renameName.trim();
    const nextDesc = renameDesc.trim();
    setProjects((prev) =>
      prev.map((x) =>
        x.id === target.id ? { ...x, name: nextName, description: nextDesc || null } : x,
      ),
    );
    try {
      await fnUpdate({ data: { id: target.id, name: nextName, description: nextDesc || null } });
      if (!current()) return;
      closeRename();
      toast.success("Project updated");
    } catch (e) {
      if (!current()) return;
      setRenameError(
        e instanceof Error && e.message.trim() ? e.message : "The project could not be updated.",
      );
      void refresh();
    } finally {
      if (current()) {
        renameOperationRef.current = null;
        setRenameBusy(false);
      }
    }
  }

  async function refresh() {
    if (!isSignedIn || !userKey || currentUserKeyRef.current !== userKey) return;
    const requestUserKey = userKey;
    const requestId = ++refreshSequenceRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [p, i] = await Promise.all([fnList(), fnInvites()]);
      if (requestId !== refreshSequenceRef.current || currentUserKeyRef.current !== requestUserKey)
        return;
      setProjects(p);
      setInvites(i);
    } catch (e) {
      if (requestId !== refreshSequenceRef.current || currentUserKeyRef.current !== requestUserKey)
        return;
      setLoadError(e instanceof Error ? e.message : "Could not load your projects.");
    } finally {
      if (
        requestId === refreshSequenceRef.current &&
        currentUserKeyRef.current === requestUserKey
      ) {
        setResolvedUserKey(requestUserKey);
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!loading || !retryReturnRef.current) return;
    const relinquishFocus = (event: Event) => {
      const origin = retryReturnRef.current;
      if (!origin || event.target === origin.trigger) return;
      if (event.type === "pointerdown" || event.target !== document.body)
        retryReturnRef.current = null;
    };
    document.addEventListener("focusin", relinquishFocus);
    document.addEventListener("pointerdown", relinquishFocus);
    return () => {
      document.removeEventListener("focusin", relinquishFocus);
      document.removeEventListener("pointerdown", relinquishFocus);
    };
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    const origin = retryReturnRef.current;
    retryReturnRef.current = null;
    if (!origin || !loadError) return;
    const active = document.activeElement;
    restoreDialogFocus(
      retryPanelRef.current?.querySelector<HTMLButtonElement>("button"),
      origin.url,
      !isLoaded ||
        !isSignedIn ||
        origin.userKey !== currentUserKeyRef.current ||
        origin.requestId !== refreshSequenceRef.current ||
        (active !== null && active !== document.body && active !== origin.trigger),
    );
  }, [loading, loadError, isLoaded, isSignedIn]);

  useEffect(
    () => () => {
      retryReturnRef.current = null;
    },
    [],
  );

  useEffect(() => {
    retryReturnRef.current = null;
    if (!isLoaded) return;

    refreshSequenceRef.current += 1;
    setProjects([]);
    setInvites([]);
    setLoadError(null);
    try {
      setOpenedHistory({
        userKey,
        entries: parseProjectOpenedHistory(
          safeBrowserStorage("localStorage")?.getItem(`kova-project-opened:${userKey}`) ?? null,
        ),
      });
    } catch {
      setOpenedHistory({ userKey, entries: {} });
    }
    setDropProjectId(null);
    setCreateOpen(false);
    setTemplatesOpen(false);
    setName("");
    setCreateNameTouched(false);
    setDescription("");
    setBusy(false);
    setAiBusy(false);
    setDeletingProject(null);
    setDeletingProjectIds(new Set());

    if (!isSignedIn || !userKey) {
      setResolvedUserKey(null);
      setLoading(false);
      return;
    }

    setResolvedUserKey(null);
    void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [isLoaded, isSignedIn, userKey]);

  async function handleCreate() {
    const session = renderedCreateSession;
    if (
      createBusyRef.current ||
      !session ||
      !isCreateCurrent(session) ||
      (createReviewRef.current.name && !createReviewRef.current.checked)
    )
      return;
    setCreateNameTouched(true);
    if (!name.trim()) {
      createNameRef.current?.focus();
      return;
    }
    const operation = {};
    createOperationRef.current = operation;
    createBusyRef.current = true;
    const attemptedName = name.trim();
    const attemptedDescription = description.trim() || null;
    createFailureFocusRef.current = { session, trigger: document.activeElement };
    setCreateError(null);
    setBusy(true);
    let id: string;
    try {
      const result = await fnCreate({
        data: { name: attemptedName, description: attemptedDescription },
      });
      if (!isCreateCurrent(session, operation)) return;
      if (!result?.id) throw new Error("No saved project was returned.");
      id = result.id;
    } catch {
      if (!isCreateCurrent(session, operation)) return;
      createReviewRef.current = { name: attemptedName, checked: false };
      setCreateUnconfirmedName(attemptedName);
      setCreateChecked(false);
      setCreateError(
        `Could not confirm project creation for “${attemptedName}”. It may already have been created. Check or refresh Projects before trying again; retrying may create a duplicate.`,
      );
      return;
    } finally {
      if (isCreateCurrent(session, operation)) {
        createOperationRef.current = null;
        createBusyRef.current = false;
        setBusy(false);
      }
    }
    if (!isCreateCurrent(session)) return;
    createFailureFocusRef.current = null;
    createReviewRef.current = { name: null, checked: false };
    setCreateUnconfirmedName(null);
    setCreateChecked(false);
    setCreateOpen(false);
    setName("");
    setCreateNameTouched(false);
    setDescription("");
    // Only a confirmed ID can update the list or report successful creation.
    setProjects((prev) => [
      {
        id,
        name: attemptedName,
        description: attemptedDescription,
        color: "blue",
        owner_id: "",
        role: "owner" as const,
        member_count: 1,
        chat_count: 0,
        file_count: 0,
        instructions_preview: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        pinned_at: null,
        archived_at: null,
        deletion_requested_at: null,
      },
      ...prev.filter((project) => project.id !== id),
    ]);
    toast.success("Project created");
    void refresh();
    // Navigation can fail after the insert was confirmed; never offer another create as recovery.
    try {
      await navigate({ to: "/projects/$projectId", params: { projectId: id } });
    } catch {
      if (isCreateCurrent(session))
        toast.error(
          `“${attemptedName}” was created, but could not be opened. Open it from Projects.`,
        );
    }
  }

  const suggestions: { name: string; description: string }[] = [
    {
      name: "Marketing Campaign",
      description: "Plan, draft, and coordinate launch content across channels.",
    },
    {
      name: "Product Research",
      description: "User interviews, competitive notes, and opportunity briefs.",
    },
    {
      name: "Content Calendar",
      description: "Track posts, deadlines, and drafts for the upcoming quarter.",
    },
    { name: "Team Onboarding", description: "Docs, checklists, and resources for new hires." },
  ];
  const [aiBusy, setAiBusy] = useState(false);
  async function generateWithKova() {
    const operationUserKey = userKey;
    setAiBusy(true);
    try {
      const res = await fetchWithTimeoutAuthenticated(
        "/api/project-suggest",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hint: name || description || "" }),
        },
        15_000,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Suggestion service unavailable");
      }
      const data = (await res.json()) as { name?: string; description?: string };
      if (currentUserKeyRef.current !== operationUserKey) return;
      if (data.name) setName(data.name);
      if (data.description) setDescription(data.description);
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(
        e instanceof DOMException && e.name === "TimeoutError"
          ? "Suggestion timed out. Check your connection and try again."
          : e instanceof Error
            ? e.message
            : "Couldn't generate suggestion",
      );
    } finally {
      if (currentUserKeyRef.current === operationUserKey) setAiBusy(false);
    }
  }

  async function handleAccept(id: string) {
    const operationUserKey = userKey;
    try {
      const { project_id } = await fnAccept({ data: { invite_id: id } });
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.success("Joined project");
      navigate({ to: "/projects/$projectId", params: { projectId: project_id } });
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }
  async function handleDecline(id: string) {
    const operationUserKey = userKey;
    try {
      await fnDecline({ data: { invite_id: id } });
      if (currentUserKeyRef.current !== operationUserKey) return;
      setInvites((prev) => prev.filter((i) => i.invite_id !== id));
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const isLoading =
    !isLoaded || Boolean(isSignedIn && (!userKey || loading || resolvedUserKey !== userKey));

  return (
    <AppShell utilitiesInHeader hideUtilities>
      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="projects-title"
        aria-busy={isLoading || undefined}
        className="kova-page kova-secondary-page kova-core-page kova-directory kova-file-directory kova-projects-page spec400-management spec400-projects pb-24 lg:pb-8"
      >
        <WorkspacePageHeader
          icon={FolderKanban}
          title="Projects"
          titleId="projects-title"
          description="Keep related chats, files, and instructions together."
          actions={
            isSignedIn && !isLoading ? (
              <div className="kova-project-header-actions flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="kova-project-templates min-h-11"
                  aria-label="Project templates"
                  title="Project templates"
                  onClick={(event) => {
                    templatesReturnFocusRef.current = event.currentTarget;
                    templatesOpenedUrlRef.current = window.location.href;
                    setTemplatesOpen(true);
                  }}
                >
                  <LayoutTemplate
                    className="kova-directory-mobile-icon h-4 w-4"
                    aria-hidden="true"
                  />
                  <span>Templates</span>
                </Button>
                <Button
                  onClick={(event) => openCreate(event.currentTarget)}
                  className="kova-project-create min-h-11"
                >
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  New project
                </Button>
              </div>
            ) : null
          }
        />

        {!isLoading && isSignedIn && invites.length > 0 && (
          <section
            className="mb-6 rounded-xl border bg-accent/30 p-4"
            aria-labelledby="project-invitations-title"
          >
            <h2 id="project-invitations-title" className="mb-3 text-sm font-medium">
              Pending invitations
            </h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div
                  key={inv.invite_id}
                  className="flex items-center justify-between gap-2 bg-background rounded-lg px-3 py-2"
                >
                  <div>
                    <div className="font-medium">{inv.project_name}</div>
                    <div className="text-xs text-muted-foreground">Role: {inv.role}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="min-h-11"
                      onClick={() => handleAccept(inv.invite_id)}
                    >
                      <Check className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => handleDecline(inv.invite_id)}
                    >
                      <XIcon className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {isSignedIn && (isLoading || projects.length > 0) && (
          <div className="kova-project-file-browser">
            <p id="project-sort-explanation" className="sr-only">
              Last opened uses project visits on this device. Projects not opened here fall back to
              last activity.
            </p>
            <div className="kova-toolbar kova-file-toolbar">
              <div className="kova-directory-search kova-directory-search-with-icon relative flex-1">
                <SearchIcon className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  aria-label="Search projects"
                  value={query}
                  maxLength={MAX_MANAGEMENT_QUERY_LENGTH}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search projects"
                  className="h-11 pl-9"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Sort projects"
                aria-describedby="project-sort-explanation"
              >
                <option value="opened">Last opened (this device)</option>
                <option value="opened-help" disabled>
                  Unvisited projects use last activity
                </option>
                <option value="name">Name</option>
                <option value="updated">Last updated</option>
              </select>
              <div className="kova-file-view-toggle" role="group" aria-label="Projects view">
                <button
                  type="button"
                  className={`kova-icon-button min-h-11 ${view === "grid" ? "bg-[var(--surface-selected)]" : ""}`}
                  onClick={() => setView("grid")}
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                >
                  <Grid2X2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`kova-icon-button min-h-11 ${view === "list" ? "bg-[var(--surface-selected)]" : ""}`}
                  onClick={() => setView("list")}
                  aria-label="List view"
                  aria-pressed={view === "list"}
                >
                  <List className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div
              className="kova-file-filters kova-project-filters"
              role="group"
              aria-label="Filter projects"
            >
              {(
                [
                  ["all", "All"],
                  ["owned", "My projects"],
                  ["shared", "Shared with me"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  aria-pressed={scope === value}
                  className={`min-h-11 shrink-0 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    scope === value
                      ? "bg-[var(--surface-selected)] text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <section role="status" aria-labelledby="projects-loading-title" className="space-y-6">
            <h2 id="projects-loading-title" className="sr-only">
              Loading projects
            </h2>
            <div
              className={
                view === "list" ? "kova-list kova-project-file-list" : "kova-grid kova-file-grid"
              }
              aria-hidden="true"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className={
                    view === "list"
                      ? "kova-row kova-directory-row kova-project-file kova-project-file-row spec400-project-skeleton-row"
                      : "kova-card kova-project-file"
                  }
                >
                  <div className="kova-project-file-link spec400-project-skeleton-content">
                    <SkeletonLine className="w-1/2" />
                    <SkeletonLine className="w-4/5" />
                    <div className="kova-project-file-date">
                      <SkeletonLine className="w-1/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : !isSignedIn ? (
          <section
            className="kova-empty-state mx-auto mt-8 max-w-2xl"
            aria-labelledby="projects-sign-in-title"
          >
            <FolderKanban
              className="mx-auto mb-4 h-10 w-10 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 id="projects-sign-in-title" className="mb-2 text-xl font-semibold">
              Sign in to use Projects
            </h2>
            <p className="mb-6 text-muted-foreground">
              Organize your conversations, files, and instructions in one place.
            </p>
            <SignInButton mode="modal">
              <Button className="min-h-11">Sign in</Button>
            </SignInButton>
          </section>
        ) : loadError ? (
          <div ref={retryPanelRef}>
            <ErrorState
              title="Couldn't load your projects"
              description="Your projects are temporarily unavailable. Try again in a moment."
              onRetry={() => {
                const trigger =
                  retryPanelRef.current?.querySelector<HTMLButtonElement>("button") ?? null;
                void refresh();
                retryReturnRef.current = {
                  trigger,
                  url: window.location.href,
                  userKey,
                  requestId: refreshSequenceRef.current,
                };
              }}
            />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project to keep related chats, files, and instructions together."
            tip="Create one project for each long-running goal or team workspace."
            action={
              <Button className="min-h-11" onClick={(event) => openCreate(event.currentTarget)}>
                <Plus className="w-4 h-4 mr-1.5" />
                Create project
              </Button>
            }
          />
        ) : (
          (() => {
            const q = query.trim().toLowerCase();
            const matches = (p: ProjectSummary) => {
              const inScope =
                scope === "all" ||
                (scope === "owned" && p.role === "owner") ||
                (scope === "shared" && p.role !== "owner");
              return (
                inScope &&
                (!q ||
                  p.name.toLowerCase().includes(q) ||
                  (p.description ?? "").toLowerCase().includes(q) ||
                  (p.instructions_preview ?? "").toLowerCase().includes(q))
              );
            };
            const sortFn = (a: ProjectSummary, b: ProjectSummary) => {
              if (sortBy === "name") return a.name.localeCompare(b.name);
              if (sortBy === "opened") {
                const difference = (openedProjects[b.id] ?? 0) - (openedProjects[a.id] ?? 0);
                if (difference) return difference;
              }
              return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
            };
            const pinned = projects
              .filter((p) => p.pinned_at && !p.archived_at && matches(p))
              .sort(sortFn);
            const active = projects
              .filter((p) => !p.pinned_at && !p.archived_at && matches(p))
              .sort(sortFn);
            const archived = projects.filter((p) => p.archived_at && matches(p)).sort(sortFn);
            const noMatches = pinned.length + active.length + archived.length === 0;

            const Card = ({ p }: { p: ProjectSummary }) => (
              <div
                aria-busy={deletingProjectIds.has(p.id) || undefined}
                onDragOver={(event) => {
                  if (p.deletion_requested_at || deletingProjectIds.has(p.id)) return;
                  if (!event.dataTransfer.types.includes("application/x-kova-project-chat")) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropProjectId(p.id);
                }}
                onDragLeave={() =>
                  setDropProjectId((current) => (current === p.id ? null : current))
                }
                onDrop={async (event) => {
                  event.preventDefault();
                  setDropProjectId(null);
                  const chatId = event.dataTransfer.getData("application/x-kova-project-chat");
                  if (
                    !chatId ||
                    p.role === "viewer" ||
                    p.deletion_requested_at ||
                    deletingProjectIds.has(p.id)
                  )
                    return;
                  const operationUserKey = userKey;
                  if (!operationUserKey || currentUserKeyRef.current !== operationUserKey) return;
                  try {
                    await fnMoveChat({
                      data: { chat_id: chatId, project_id: p.id },
                    });
                    if (currentUserKeyRef.current !== operationUserKey) return;
                    void refresh();
                    toast.success(`Chat moved to ${p.name}`);
                  } catch (error) {
                    if (currentUserKeyRef.current !== operationUserKey) return;
                    toast.error(error instanceof Error ? error.message : "Could not move chat");
                  }
                }}
                className={`${dropProjectId === p.id ? "ring-2 ring-primary bg-primary/5" : ""} ${
                  p.deletion_requested_at ? "border-destructive/40" : ""
                } ${
                  view === "list"
                    ? "relative kova-row kova-directory-row kova-project-file kova-project-file-row group"
                    : "relative kova-card kova-project-file group"
                }`}
              >
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="kova-project-file-link"
                  onClick={() => {
                    if (!isLoaded || !userKey || currentUserKeyRef.current !== userKey) return;
                    try {
                      const storage = safeBrowserStorage("localStorage");
                      const key = `kova-project-opened:${userKey}`;
                      // Re-read durable history so a mounted stale callback cannot resurrect
                      // cleared visits. Keep the existing per-owner Last opened key and values.
                      const next = parseProjectOpenedHistory(
                        JSON.stringify({
                          ...parseProjectOpenedHistory(storage?.getItem(key) ?? null),
                          [p.id]: Date.now(),
                        }),
                      );
                      setOpenedHistory({ userKey, entries: next });
                      storage?.setItem(key, JSON.stringify(next));
                    } catch {
                      /* optional history */
                    }
                  }}
                >
                  <div className="kova-project-file-name">
                    <h3 title={p.name}>{p.name}</h3>
                    {p.pinned_at && (
                      <Pin className="kova-project-pin h-4 w-4" aria-label="Pinned" />
                    )}
                  </div>
                  {(p.deletion_requested_at || deletingProjectIds.has(p.id)) && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="kova-project-file-status mt-1 flex items-center gap-1.5 text-xs font-medium text-destructive"
                    >
                      {deletingProjectIds.has(p.id) ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Deleting stored files…
                        </>
                      ) : (
                        "Deletion incomplete — retry cleanup"
                      )}
                    </p>
                  )}
                  {(p.description || p.instructions_preview) && (
                    <p className="kova-project-file-description">
                      {p.description || p.instructions_preview}
                    </p>
                  )}
                  <div className="kova-project-file-stats">
                    <span className="kova-project-role">
                      {p.role === "owner" ? "Owner" : p.role === "editor" ? "Editor" : "Viewer"}
                    </span>
                  </div>
                  <div className="kova-project-file-date">
                    Last activity{" "}
                    <time dateTime={p.updated_at}>
                      {new Date(p.updated_at).toLocaleDateString()}
                    </time>
                  </div>
                </Link>
                <div className="kova-project-file-menu absolute top-3 right-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        ref={(node) => {
                          if (node) projectMenuTriggers.current.set(p.id, node);
                          else projectMenuTriggers.current.delete(p.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-11 w-11 items-center justify-center rounded-md opacity-70 transition hover:bg-background/70 hover:opacity-100 data-[state=open]:opacity-100"
                        aria-label={`Options for ${p.name}`}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={() => togglePin(p)}
                        disabled={
                          p.role === "viewer" ||
                          Boolean(p.deletion_requested_at) ||
                          deletingProjectIds.has(p.id)
                        }
                      >
                        {p.pinned_at ? (
                          <>
                            <PinOff className="w-4 h-4 mr-2" />
                            Unpin
                          </>
                        ) : (
                          <>
                            <Pin className="w-4 h-4 mr-2" />
                            Pin to top
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openRename(p)}
                        disabled={
                          p.role === "viewer" ||
                          Boolean(p.deletion_requested_at) ||
                          deletingProjectIds.has(p.id)
                        }
                      >
                        <Pencil className="w-4 h-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDuplicate(p)}
                        disabled={Boolean(p.deletion_requested_at) || deletingProjectIds.has(p.id)}
                      >
                        <CopyIcon className="w-4 h-4 mr-2" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => toggleArchive(p)}
                        disabled={
                          p.role !== "owner" ||
                          Boolean(p.deletion_requested_at) ||
                          deletingProjectIds.has(p.id)
                        }
                      >
                        {p.archived_at ? (
                          <>
                            <ArchiveRestore className="w-4 h-4 mr-2" />
                            Restore
                          </>
                        ) : (
                          <>
                            <Archive className="w-4 h-4 mr-2" />
                            Archive
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeletingProject(p)}
                        disabled={p.role !== "owner" || deletingProjectIds.has(p.id)}
                        className="text-foreground focus:text-foreground"
                      >
                        <Trash2 className="w-4 h-4 mr-2 text-destructive" />
                        {p.deletion_requested_at ? "Retry deletion" : "Delete"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );

            const Section = ({ title, items }: { title: string; items: ProjectSummary[] }) =>
              items.length === 0 ? null : (
                <section className="kova-file-collection mb-6" aria-label={title}>
                  <div className="kova-file-section-heading">
                    <h2>{title}</h2>
                    <span>
                      {items.length} {items.length === 1 ? "project" : "projects"}
                    </span>
                  </div>
                  {view === "list" ? (
                    <div className="kova-project-list-heading" aria-hidden="true">
                      <span>Project</span>
                      <span>Updated</span>
                    </div>
                  ) : null}
                  <div
                    className={
                      view === "list"
                        ? "kova-list kova-project-file-list"
                        : "kova-grid kova-file-grid"
                    }
                  >
                    {items.map((p) => (
                      <Card key={p.id} p={p} />
                    ))}
                  </div>
                </section>
              );

            return (
              <div className="kova-project-file-browser">
                {noMatches ? (
                  <EmptyState
                    icon={SearchIcon}
                    title={scope === "shared" && !query ? "No shared projects yet" : "No matches"}
                    description={
                      scope === "shared" && !query
                        ? "Projects other people share with you will appear here."
                        : `No projects match "${query}".`
                    }
                    action={
                      query ? (
                        <Button
                          className="min-h-11"
                          variant="outline"
                          onClick={() => {
                            setQuery("");
                            searchInputRef.current?.focus();
                          }}
                        >
                          Clear search
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <>
                    <Section title="Pinned" items={pinned} />
                    <Section
                      title={
                        query
                          ? "Search results"
                          : scope === "shared"
                            ? "Shared projects"
                            : scope === "owned"
                              ? "My projects"
                              : "All projects"
                      }
                      items={active}
                    />
                    {archived.length > 0 && (
                      <section className="mb-6">
                        <button
                          type="button"
                          onClick={() => setListPreferences({ archived: !showArchived })}
                          aria-expanded={showArchived}
                          aria-controls="archived-projects"
                          className="mb-2 flex min-h-11 items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                        >
                          {showArchived ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          Archived ({archived.length})
                        </button>
                        {showArchived && (
                          <div
                            id="archived-projects"
                            className={
                              view === "list"
                                ? "kova-list kova-project-file-list opacity-80"
                                : "kova-grid kova-file-grid opacity-80"
                            }
                          >
                            {archived.map((p) => (
                              <Card key={p.id} p={p} />
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </>
                )}
              </div>
            );
          })()
        )}
      </main>

      <Dialog open={renameVisible} onOpenChange={(open) => !open && requestRenameClose()}>
        <DialogContent
          ref={renameDialogRef}
          className="spec400-management-dialog"
          onCloseAutoFocus={restoreRenameFocus}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            requestRenameClose();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestRenameClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>Update the project name and optional description.</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            aria-describedby={
              renameVisible && renameError ? "rename-project-save-error" : undefined
            }
            onSubmit={(e) => {
              e.preventDefault();
              if (!renameBusy) saveRename();
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="rename-project-name" className="text-sm font-medium mb-1 block">
                Name
              </label>
              <Input
                ref={renameNameInputRef}
                id="rename-project-name"
                value={renameVisible ? renameName : ""}
                onChange={(e) => setRenameName(e.target.value)}
                onFocus={(event) => {
                  renameEditFocusRef.current = event.currentTarget;
                }}
                onBlur={() => setRenameNameVisited(true)}
                aria-invalid={Boolean(renameNameError)}
                aria-describedby={renameNameError ? "rename-project-name-error" : undefined}
                disabled={renameBusy}
                maxLength={100}
                required
                autoFocus
              />
              {renameNameError && (
                <p
                  id="rename-project-name-error"
                  role="alert"
                  className="mt-1 text-sm text-destructive"
                >
                  {renameNameError}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="rename-project-description"
                className="text-sm font-medium mb-1 block"
              >
                Description (optional)
              </label>
              <Textarea
                id="rename-project-description"
                value={renameVisible ? renameDesc : ""}
                onChange={(e) => setRenameDesc(e.target.value)}
                onFocus={(event) => {
                  renameEditFocusRef.current = event.currentTarget;
                }}
                disabled={renameBusy}
                rows={3}
                maxLength={1000}
              />
            </div>
            {renameVisible && renameError && (
              <div
                id="rename-project-save-error"
                role="alert"
                className="space-y-1 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
              >
                <p>Couldn’t save the project. {renameError}</p>
                <p>Your changes are still here. Use Save project to try again.</p>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={requestRenameClose}
                disabled={renameBusy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renameBusy} aria-busy={renameBusy}>
                {renameBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {renameBusy ? "Saving…" : "Save project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={renameVisible && renameDiscardOpen} onOpenChange={setRenameDiscardOpen}>
        <AlertDialogContent
          ref={renameDiscardDialogRef}
          onCloseAutoFocus={restoreRenameEditingFocus}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard project changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved name and description will be lost. The saved project will not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={closeRename}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isSignedIn && userKey && (
        <ProjectTemplatesDialog
          key={userKey}
          open={templatesOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreDialogFocus(templatesReturnFocusRef.current, templatesOpenedUrlRef.current);
          }}
          onOpenChange={setTemplatesOpen}
          userId={userKey}
          onCopied={(projectId) => {
            setTemplatesOpen(false);
            void refresh();
            void navigate({
              to: "/projects/$projectId",
              params: { projectId },
            });
          }}
        />
      )}

      <Dialog
        open={createVisible}
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
      >
        <DialogContent
          className="spec400-management-dialog"
          ref={createDialogRef}
          onCloseAutoFocus={restoreCreateFocus}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) handleCreate();
            }}
            className="space-y-4"
          >
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="create-project-name" className="text-sm font-medium">
                  Name
                </label>
              </div>
              <Input
                ref={createNameRef}
                disabled={busy}
                id="create-project-name"
                aria-invalid={Boolean(createNameError)}
                aria-describedby={createNameError ? "create-project-name-error" : undefined}
                onBlur={(event) => {
                  // Dismissal should not move Cancel beneath the pointer by
                  // inserting a validation message between pointer down and up.
                  if (
                    (event?.relatedTarget as HTMLElement | null)?.closest?.(
                      "[data-project-create-dismiss]",
                    )
                  )
                    return;
                  setCreateNameTouched(true);
                }}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Marketing campaign"
                maxLength={100}
                required
                autoFocus
              />
              {createNameError && (
                <p
                  id="create-project-name-error"
                  aria-live="polite"
                  className="mt-2 text-sm text-destructive"
                >
                  {createNameError}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="create-project-description"
                className="text-sm font-medium mb-1 block"
              >
                Description (optional)
              </label>
              <Textarea
                disabled={busy}
                id="create-project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this project about?"
                rows={3}
                maxLength={1000}
              />
            </div>
            {createError && (
              <div
                ref={createErrorRef}
                tabIndex={-1}
                role="alert"
                className="rounded-lg border border-destructive/40 p-3 text-sm"
              >
                <p className="text-destructive">{createError}</p>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    const session = createSessionRef.current;
                    if (!session || !isCreateCurrent(session)) return;
                    createNameRef.current?.focus();
                    setCreateError(null);
                  }}
                >
                  Dismiss error
                </Button>
              </div>
            )}
            {createUnconfirmedName && (
              <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
                <p>
                  Check Projects for “{createUnconfirmedName}” before retrying. A retry may create a
                  duplicate.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const session = createSessionRef.current;
                    if (!session || !isCreateCurrent(session) || createBusyRef.current) return;
                    // Refresh removes both create entry points; the title stays mounted
                    // through loading, empty, and failed results. The close handler owns focus.
                    const title = document.getElementById("projects-title");
                    if (title) title.tabIndex = -1;
                    createReturnFocusRef.current = title;
                    closeCreate();
                    void refresh();
                  }}
                >
                  Check Projects
                </Button>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={createChecked}
                    disabled={busy}
                    onChange={(event) => {
                      const session = createSessionRef.current;
                      if (!session || !isCreateCurrent(session) || createBusyRef.current) return;
                      createReviewRef.current.checked = event.target.checked;
                      setCreateChecked(event.target.checked);
                    }}
                  />
                  I checked Projects and want to retry creating this project.
                </label>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                data-project-create-dismiss=""
                onClick={closeCreate}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !name.trim() || Boolean(createUnconfirmedName && !createChecked)}
              >
                {busy
                  ? "Creating…"
                  : createUnconfirmedName
                    ? "Retry create project"
                    : "Create project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={Boolean(deletingProject)}
        onOpenChange={(open) => !open && setDeletingProject(null)}
        title="Delete this project?"
        description={
          deletingProject?.deletion_requested_at
            ? `Cleanup for “${deletingProject.name}” did not finish. Retry the bounded stored-file cleanup, then permanently delete its chats, tasks, notes, memberships, and saved Results (including their versions and comments).`
            : deletingProject
              ? `“${deletingProject.name}”, its stored file copies, chats, tasks, notes, memberships, and saved Results (including their versions and comments) will be permanently deleted.`
              : "This project, its stored file copies, chats, tasks, notes, memberships, and saved Results (including their versions and comments) will be permanently deleted."
        }
        confirmLabel={deletingProject?.deletion_requested_at ? "Retry deletion" : "Delete project"}
        destructive
        onConfirm={() => {
          const project = deletingProject;
          setDeletingProject(null);
          if (project) void handleDelete(project);
        }}
      />
    </AppShell>
  );
}
