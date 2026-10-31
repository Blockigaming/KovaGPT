import "@/styles/spec400-management.css";
import "@/styles/project-detail.css";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatch,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { TimersWidget } from "@/components/TimersWidget";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { CollaborativeProjectNotes } from "@/components/CollaborativeProjectNotes";
import { ProjectCollaboration } from "@/components/ProjectCollaboration";
import { RelatedWorkspaceItems } from "@/components/WorkspaceIntelligence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  FolderInput,
  MoreHorizontal,
  Clock,
  Loader2,
  Users,
  Mail,
  Plus,
  Trash2,
  Send,
  MessageCircle,
  Settings as SettingsIcon,
  Crown,
  Save,
  FileText,
  CheckSquare,
  Image as ImageIcon,
  Brain,
  Activity,
  Search,
  Archive,
  ArchiveRestore,
  Upload,
  Download,
  GripVertical,
  Calendar,
  StickyNote,
  X,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { PROJECT_CHAT_DELETE_UNAVAILABLE } from "@/lib/project-chat-deletion";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { supabase } from "@/integrations/supabase/client";
import {
  getProject,
  listProjects,
  type ProjectSummary,
  updateProject,
  deleteProject,
  listMembers,
  removeMember,
  updateMemberRole,
  leaveProject,
  listInvites,
  inviteMember,
  revokeInvite,
  listProjectChats,
  createProjectChat,
  type ProjectDetail,
  type ProjectMember,
  type ProjectInvite,
  type ProjectChatSummary,
} from "@/lib/projects.functions";
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  reorderTasks,
  moveChatToProject,
  listFiles,
  listMemory,
  addMemory,
  deleteMemory,
  listActivity,
  setProjectArchived,
  searchProject,
  type ProjectTask,
  type ProjectFile,
  type ProjectMemoryItem,
  type ProjectActivity,
  type SearchResult,
} from "@/lib/project-workspace.functions";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectDetailRoute,
  head: () => ({
    meta: [{ title: "KovaGPT Project" }, { name: "robots", content: "noindex" }],
  }),
});

function ProjectDetailRoute() {
  const chatMatch = useMatch({
    from: "/projects/$projectId/chat/$chatId",
    shouldThrow: false,
  });

  return chatMatch ? <Outlet /> : <ProjectDetailPage />;
}

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const { isSignedIn, isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const requestKey = userKey ? `${userKey}:${projectId}` : null;
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [chats, setChats] = useState<ProjectChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvedRequestKey, setResolvedRequestKey] = useState<string | null>(null);
  const [tab, setTab] = useState("chats");
  const [searchOpen, setSearchOpen] = useState(false);
  const [creatingProjectChat, setCreatingProjectChat] = useState(false);
  const creatingProjectChatRef = useRef(false);
  const fnCreateHeaderChat = useServerFn(createProjectChat);
  async function newChatInProject() {
    if (creatingProjectChatRef.current || !requestKey || !project || project.archived_at) return;
    creatingProjectChatRef.current = true;
    setCreatingProjectChat(true);
    const originalKey = requestKey;
    try {
      const result = await fnCreateHeaderChat({
        data: { project_id: projectId, title: "New chat", messages: [] },
      });
      if (currentRequestKeyRef.current === originalKey)
        await navigate({
          to: "/projects/$projectId/chat/$chatId",
          params: { projectId, chatId: result.id },
        });
    } catch (error) {
      if (currentRequestKeyRef.current === originalKey)
        toast.error(error instanceof Error ? error.message : "The chat could not be created.");
    } finally {
      creatingProjectChatRef.current = false;
      if (currentRequestKeyRef.current === originalKey) setCreatingProjectChat(false);
    }
  }
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const projectMoreRef = useRef<HTMLButtonElement>(null);
  const projectSearchTriggerRef = useRef<HTMLElement | null>(null);
  const projectSearchUrlRef = useRef<string | undefined>(undefined);
  const projectSearchRequestKeyRef = useRef<string | null>(null);
  const projectActionUrlRef = useRef<string | undefined>(undefined);
  const projectActionTriggerRef = useRef<HTMLElement | null>(null);
  const openProjectDelete = (trigger?: HTMLElement) => {
    projectActionUrlRef.current = window.location.href;
    projectActionTriggerRef.current = trigger ?? projectMoreRef.current;
    setDeleteError(null);
    setDeleteOpen(true);
  };
  const currentRequestKeyRef = useRef(requestKey);
  const requestSequenceRef = useRef(0);
  const memberRoleOperationsRef = useRef(new Map<string, symbol>());
  currentRequestKeyRef.current = requestKey;

  const openProjectSearch = (trigger: HTMLElement | null) => {
    projectSearchTriggerRef.current = trigger;
    projectSearchUrlRef.current = window.location.href;
    projectSearchRequestKeyRef.current = currentRequestKeyRef.current;
    setSearchOpen(true);
  };

  const fnGet = useServerFn(getProject);
  const fnUpdate = useServerFn(updateProject);
  const fnDelete = useServerFn(deleteProject);
  const fnArchive = useServerFn(setProjectArchived);
  const fnListMembers = useServerFn(listMembers);
  const fnListInvites = useServerFn(listInvites);
  const fnListChats = useServerFn(listProjectChats);
  const fnLeave = useServerFn(leaveProject);

  useEffect(() => {
    const operations = memberRoleOperationsRef.current;
    return () => operations.clear();
  }, [isSignedIn, requestKey]);

  const refresh = useCallback(async () => {
    if (!isSignedIn || !requestKey || currentRequestKeyRef.current !== requestKey) return;
    const loadRequestKey = requestKey;
    const requestId = ++requestSequenceRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [p, m, i, c] = await Promise.all([
        fnGet({ data: { id: projectId } }),
        fnListMembers({ data: { project_id: projectId } }),
        fnListInvites({ data: { project_id: projectId } }),
        fnListChats({ data: { project_id: projectId } }),
      ]);
      if (
        requestId !== requestSequenceRef.current ||
        currentRequestKeyRef.current !== loadRequestKey
      )
        return;
      if (!p || p.id !== projectId || !Array.isArray(m) || !Array.isArray(i) || !Array.isArray(c))
        throw new Error("The project could not be loaded. Try again.");
      setProject(p);
      try {
        const key = `kova-project-opened:${userKey}`;
        localStorage.setItem(
          key,
          JSON.stringify({
            ...JSON.parse(localStorage.getItem(key) || "{}"),
            [projectId]: Date.now(),
          }),
        );
      } catch {
        /* Device history is optional. */
      }
      setMembers(m);
      setInvites(i);
      setChats(c);
    } catch (error) {
      if (
        requestId !== requestSequenceRef.current ||
        currentRequestKeyRef.current !== loadRequestKey
      )
        return;
      setProject(null);
      setMembers([]);
      setInvites([]);
      setChats([]);
      setLoadError(error instanceof Error ? error.message : "The project could not be loaded.");
    } finally {
      if (
        requestId === requestSequenceRef.current &&
        currentRequestKeyRef.current === loadRequestKey
      ) {
        setResolvedRequestKey(loadRequestKey);
        setLoading(false);
      }
    }
  }, [
    fnGet,
    fnListChats,
    fnListInvites,
    fnListMembers,
    isSignedIn,
    projectId,
    requestKey,
    userKey,
  ]);

  useEffect(() => {
    if (!isLoaded) return;

    requestSequenceRef.current += 1;
    setProject(null);
    setMembers([]);
    setInvites([]);
    setChats([]);
    setLoadError(null);
    setTab("chats");
    setSearchOpen(false);
    setArchiveBusy(false);
    setDeletionBusy(false);
    setLeaveOpen(false);
    setDeleteOpen(false);
    setDeleteError(null);

    if (!isSignedIn || !requestKey) {
      setResolvedRequestKey(null);
      setLoading(false);
      return;
    }

    setResolvedRequestKey(null);
    void refresh();
  }, [isLoaded, isSignedIn, refresh, requestKey]);

  type MemberRemovalTarget = {
    kind: "member" | "invite";
    id: string;
    label: string;
    requestKey: string;
  };
  const memberRemovalScope = useMemo(
    () => ({ active: false, key: isSignedIn ? requestKey : null }),
    [isSignedIn, requestKey],
  );
  const memberRemovalRef = useRef<symbol | null>(null);
  const memberRemovalTriggerRef = useRef<HTMLElement | null>(null);
  const memberRemovalFeedbackRef = useRef<HTMLDivElement | null>(null);
  const [memberRemovalPending, setMemberRemovalPending] = useState<MemberRemovalTarget | null>(
    null,
  );
  const [memberRemovalError, setMemberRemovalError] = useState<
    (MemberRemovalTarget & { message: string }) | null
  >(null);
  const [memberRemovalStatus, setMemberRemovalStatus] = useState<string | null>(null);

  useEffect(() => {
    memberRemovalScope.active = true;
    memberRemovalRef.current = null;
    memberRemovalTriggerRef.current = null;
    setMemberRemovalPending(null);
    setMemberRemovalError(null);
    setMemberRemovalStatus(null);
    return () => {
      memberRemovalScope.active = false;
      memberRemovalRef.current = null;
    };
  }, [memberRemovalScope]);
  useEffect(() => {
    if (memberRemovalError || memberRemovalStatus) memberRemovalFeedbackRef.current?.focus();
  }, [memberRemovalError, memberRemovalStatus]);

  async function runMemberRemoval(
    kind: "member" | "invite",
    id: string,
    label: string,
    expectedKey = requestKey,
  ) {
    if (
      !memberRemovalScope.active ||
      !isSignedIn ||
      !requestKey ||
      project?.role !== "owner" ||
      expectedKey !== requestKey ||
      currentRequestKeyRef.current !== expectedKey ||
      memberRemovalRef.current
    )
      return;
    // A retained failure must be retried or cancelled before starting another removal.
    if (memberRemovalError && (memberRemovalError.id !== id || memberRemovalError.kind !== kind))
      return;
    if (
      !memberRemovalError &&
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      memberRemovalTriggerRef.current = document.activeElement;
    }
    const target = { kind, id, label, requestKey };
    const operation = Symbol();
    memberRemovalRef.current = operation;
    const isCurrent = () =>
      memberRemovalScope.active &&
      currentRequestKeyRef.current === target.requestKey &&
      memberRemovalRef.current === operation;
    setMemberRemovalPending(target);
    setMemberRemovalStatus(null);
    try {
      const functions = await import("@/lib/projects.functions");
      if (!isCurrent()) return;
      if (kind === "invite") {
        await callServerFnDirect(functions.revokeInvite, { data: { id } });
      } else {
        await callServerFnDirect(functions.removeMember, {
          data: { project_id: projectId, user_id: id },
        });
      }
      if (!isCurrent()) return;
      // Only the confirmed target changes; a failed refresh cannot wipe other rows or drafts.
      if (kind === "invite")
        setInvites((previous) => previous.filter((invite) => invite.id !== id));
      else setMembers((previous) => previous.filter((member) => member.user_id !== id));
      setMemberRemovalError(null);
      setMemberRemovalStatus(
        kind === "invite"
          ? `Invitation revoked for ${label}.`
          : `${label} removed from this project.`,
      );
    } catch (error) {
      if (!isCurrent()) return;
      setMemberRemovalError({
        ...target,
        message:
          error instanceof Error ? error.message : "Try again when the service is available.",
      });
    } finally {
      if (isCurrent()) {
        memberRemovalRef.current = null;
        setMemberRemovalPending(null);
      }
    }
  }

  const isLoading =
    !isLoaded ||
    Boolean(isSignedIn && (!requestKey || loading || resolvedRequestKey !== requestKey));
  const beginChatMoveFocus = useProjectChatMoveFocus(
    isLoaded && isSignedIn ? requestKey : null,
    isLoading,
    Boolean(project && !loadError && !project.deletion_requested_at && tab === "chats"),
  );

  if (isLoading)
    return (
      <AppShell>
        <main
          id="main-content"
          tabIndex={-1}
          aria-busy="true"
          className="mx-auto w-full max-w-6xl p-4 md:p-8"
        >
          <section
            role="status"
            aria-labelledby="project-loading-title"
            className="flex min-h-40 items-center gap-2 text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <h1 id="project-loading-title" className="text-sm font-normal">
              Loading project…
            </h1>
          </section>
        </main>
      </AppShell>
    );
  if (!isSignedIn) {
    return (
      <AppShell>
        <main id="main-content" tabIndex={-1} className="max-w-2xl mx-auto p-8 text-center">
          <h1 className="text-2xl font-semibold mb-2">Sign in required</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Sign in to open this project and its shared workspace.
          </p>
          <SignInButton mode="modal">
            <Button>Sign in</Button>
          </SignInButton>
        </main>
      </AppShell>
    );
  }
  if (loadError || !project) {
    return (
      <AppShell>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-2xl p-4 text-center md:p-8"
        >
          <section role="alert" className="mt-8 rounded-2xl border border-destructive/40 p-8">
            <h1 className="text-xl font-semibold">Project could not be opened</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This project is unavailable right now, or you no longer have access.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={() => void refresh()}>Try again</Button>
              <Button variant="outline" asChild>
                <Link to="/projects">Back to projects</Link>
              </Button>
            </div>
          </section>
        </main>
      </AppShell>
    );
  }

  const archived = !!project.archived_at;
  const canEdit = !archived && (project.role === "owner" || project.role === "editor");
  const isOwner = project.role === "owner";

  if (project.deletion_requested_at) {
    return (
      <AppShell>
        <main
          id="main-content"
          tabIndex={-1}
          aria-busy={deletionBusy || undefined}
          className="mx-auto w-full max-w-2xl p-4 md:p-8"
        >
          <Link
            to="/projects"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Projects
          </Link>
          <span className="spec400-breadcrumb-current" aria-current="page">
            / {project.name}
          </span>
          <section
            role="alert"
            className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 p-5 sm:p-8"
          >
            <h1 className="text-xl font-semibold">Project deletion is incomplete</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              “{project.name}” is read-only while its stored-file cleanup is pending. No new
              workspace changes are accepted.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {isOwner
                ? "Retrying resumes the bounded cleanup and never deletes outside this Project."
                : "The Project owner must retry deletion. You can return to your Projects list."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {isOwner ? (
                <Button
                  variant="destructive"

                  disabled={deletionBusy}
                  onClick={async () => {
                    const operationRequestKey = requestKey;
                    setDeletionBusy(true);
                    try {
                      await fnDelete({ data: { id: projectId } });
                      if (currentRequestKeyRef.current !== operationRequestKey) return;
                      toast.success("Project deleted");
                      await navigate({ to: "/projects" });
                    } catch (error) {
                      if (currentRequestKeyRef.current !== operationRequestKey) return;
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Deletion is incomplete. Retry when the service is available.",
                      );
                      await refresh();
                    } finally {
                      if (currentRequestKeyRef.current === operationRequestKey) {
                        setDeletionBusy(false);
                      }
                    }
                  }}
                >
                  {deletionBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Retrying deletion…
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Retry deletion
                    </>
                  )}
                </Button>
              ) : null}
              <Button variant="outline" asChild>
                <Link to="/projects">Back to projects</Link>
              </Button>
            </div>
          </section>
        </main>
      </AppShell>
    );
  }

  async function toggleArchive() {
    if (archiveBusy) return;
    const operationRequestKey = requestKey;
    setArchiveBusy(true);
    try {
      await fnArchive({ data: { id: projectId, archived: !archived } });
      if (currentRequestKeyRef.current !== operationRequestKey) return;
      toast.success(archived ? "Project restored" : "Project archived");
      await refresh();
    } catch (error) {
      if (currentRequestKeyRef.current !== operationRequestKey) return;
      toast.error(
        error instanceof Error ? error.message : "The project archive state could not be updated.",
      );
    } finally {
      if (currentRequestKeyRef.current === operationRequestKey) setArchiveBusy(false);
    }
  }

  return (
    <AppShell hideUtilities>
      <main
        id="main-content"
        tabIndex={-1}
        className="spec400-management spec400-project-detail kova-project-workspace"
        data-ui-reference="claude.projects.workspace"
      >
        <header className="kova-project-header">
          <nav aria-label="Breadcrumb" className="kova-project-breadcrumb">
            <Link
              to="/projects"
              className="min-h-11 text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Projects
            </Link>
            <span aria-hidden="true">/</span>
            <span className="kova-project-breadcrumb-current" aria-current="page">
              {project.name}
            </span>
          </nav>

          <div className="kova-project-heading">
            <div className="min-w-0">
              <div className="kova-project-title-line">
                <h1 className="kova-project-title">{project.name}</h1>
                {archived && <span className="kova-project-status">Archived</span>}
              </div>
              {project.description && (
                <p className="kova-project-description">{project.description}</p>
              )}
              <div className="kova-project-access">
                <span className="kova-project-role">{project.role}</span>
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  {members.length} member{members.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>

          <p className="kova-project-sharing-note">
            {archived
              ? "This project is archived and read-only. Its content is retained. Restore it to make changes."
              : "Project members can see conversations created in this project."}
          </p>
          <div className="kova-project-actions" aria-label="Project actions">
            {archived && isOwner && (
              <Button onClick={() => void toggleArchive()} disabled={archiveBusy}>
                <ArchiveRestore aria-hidden="true" />
                {archiveBusy ? "Restoring…" : "Restore project"}
              </Button>
            )}
            {canEdit && (
              <Button
                aria-label="New chat in project"
                onClick={() => void newChatInProject()}
                disabled={creatingProjectChat}
              >
                <Plus aria-hidden="true" />
                {creatingProjectChat ? "Creating…" : "New chat"}
              </Button>
            )}
            <Button
              variant="outline"
              aria-label={isOwner && !archived ? "Share project" : "People"}
              onClick={() => setTab("members")}
            >
              <Users aria-hidden="true" />
              {isOwner && !archived ? "Share" : "People"}
            </Button>
            <Button
              className="kova-project-search-action"
              variant="outline"
              size="icon"
              aria-label="Search this project"
              title="Search this project"
              onClick={(event) => openProjectSearch(event.currentTarget)}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  ref={projectMoreRef}
                  aria-label="More project actions"
                  title="More project actions"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openProjectSearch(projectMoreRef.current)}>
                  <Search aria-hidden="true" />
                  Search this project
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTab("members")}>
                  <Users aria-hidden="true" />
                  {isOwner && !archived ? "Share project" : "People"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTab("timers")}>
                  <Clock aria-hidden="true" />
                  Timers
                </DropdownMenuItem>
                {isOwner && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={archiveBusy} onSelect={() => void toggleArchive()}>
                      {archived ? (
                        <ArchiveRestore aria-hidden="true" />
                      ) : (
                        <Archive aria-hidden="true" />
                      )}
                      {archiveBusy
                        ? archived
                          ? "Restoring…"
                          : "Archiving…"
                        : archived
                          ? "Restore project"
                          : "Archive project"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openProjectDelete()}>
                      <Trash2 className="text-destructive" aria-hidden="true" />
                      Delete project
                    </DropdownMenuItem>
                  </>
                )}
                {!isOwner && (
                  <DropdownMenuItem
                    onSelect={() => {
                      projectActionUrlRef.current = window.location.href;
                      projectActionTriggerRef.current = projectMoreRef.current;
                      setLeaveOpen(true);
                    }}
                  >
                    Leave project
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="kova-project-content">
          <div className="spec400-project-navigation">
            <TabsList aria-label="Project sections">
              <TabsTrigger value="chats">Chats</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
              <TabsTrigger value="context">Context</TabsTrigger>
            </TabsList>
            <div className="spec400-project-tools">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="kova-project-tools-trigger"
                    aria-label="More project tools"
                  >
                    More
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px]">
                  <DropdownMenuRadioGroup value={tab} onValueChange={setTab}>
                    <DropdownMenuRadioItem value="overview">Activity</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="timers">Timers</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="files">Project files</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="images">Project images</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="notes">Notes</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="tasks">Project tasks</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="memory">Memory</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="members">Members</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="collaboration">
                      Collaboration
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="settings">
                      {isOwner ? "Settings" : "Access"}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <TabsContent value="timers" className="mt-4">
            <h2 className="mb-3 text-lg font-semibold">Timers</h2>
            <TimersWidget userKey={userKey} principalResolved={isLoaded} />
          </TabsContent>
          <TabsContent value="overview" className="mt-4">
            <OverviewTab projectId={projectId} onJump={(k) => setTab(k)} />
          </TabsContent>
          <TabsContent value="chats" className="mt-4">
            <div className="kova-project-chat-layout">
              <div className="min-w-0">
                <ChatsTab
                  projectId={projectId}
                  chats={chats}
                  canEdit={canEdit}
                  onRefresh={refresh}
                  onMoveFocusRequest={beginChatMoveFocus}
                />
              </div>
              <aside
                className="kova-project-knowledge"
                aria-labelledby="project-knowledge-title"
                data-ui-reference="claude.projects.knowledge"
              >
                <h2 id="project-knowledge-title">Project knowledge</h2>
                <p>Instructions and files used across conversations in this project.</p>
                <button
                  type="button"
                  className="kova-project-knowledge-row"
                  data-kova-button-shape="preserve"
                  onClick={() => setTab("context")}
                >
                  <Brain className="h-4 w-4" aria-hidden="true" />
                  <span>
                    <strong>Project instructions</strong>
                    <small>
                      {project.system_prompt?.trim()
                        ? "Review the instructions for this project"
                        : "Set the context for every conversation"}
                    </small>
                  </span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="kova-project-knowledge-row"
                  data-kova-button-shape="preserve"
                  onClick={() => setTab("files")}
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <span>
                    <strong>Project files</strong>
                    <small>Browse the sources available in this project</small>
                  </span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </aside>
            </div>
          </TabsContent>
          <TabsContent value="files" className="mt-4">
            <FilesTab projectId={projectId} canEdit={canEdit} kind="file" />
          </TabsContent>
          <TabsContent value="images" className="mt-4">
            <FilesTab projectId={projectId} canEdit={canEdit} kind="image" />
          </TabsContent>
          <TabsContent
            value="context"
            className="mt-4 space-y-6"
            data-ui-reference="claude.projects.instructions"
          >
            <ProjectInstructionsTab
              project={project}
              canEdit={isOwner && !archived}
              onSave={async (system_prompt) => {
                const operationRequestKey = requestKey;
                await fnUpdate({ data: { id: projectId, system_prompt } });
                if (currentRequestKeyRef.current !== operationRequestKey) return;
                setProject((prev) => (prev ? { ...prev, system_prompt } : prev));
              }}
            />
            <section className="spec400-context-files">
              <p className="spec400-supporting">
                Keep the files and instructions for this project together. Manage other saved items
                in Library.
              </p>
              <Link to="/library" className="underline">
                Open Library
              </Link>
              <FilesTab projectId={projectId} canEdit={canEdit} kind="file" />
            </section>
          </TabsContent>
          <TabsContent value="notes" className="mt-4">
            <NotesTab projectId={projectId} canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="tasks" className="mt-4">
            <TasksTab projectId={projectId} canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="memory" className="mt-4">
            <MemoryTab projectId={projectId} canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="members" className="mt-4">
            {(memberRemovalPending?.requestKey === requestKey ||
              memberRemovalError?.requestKey === requestKey ||
              memberRemovalStatus) && (
              <div
                ref={memberRemovalFeedbackRef}
                tabIndex={-1}
                className="mb-4 rounded-xl border p-3 text-sm"
              >
                {memberRemovalPending?.requestKey === requestKey && (
                  <p role="status">
                    {memberRemovalPending.kind === "invite"
                      ? "Revoking invitation for"
                      : "Removing"}{" "}
                    {memberRemovalPending.label}…
                  </p>
                )}
                {memberRemovalError?.requestKey === requestKey && (
                  <div role="alert">
                    <p>
                      Could not confirm{" "}
                      {memberRemovalError.kind === "invite"
                        ? "invitation revocation for"
                        : "removal of"}{" "}
                      {memberRemovalError.label}. The existing row is still shown.
                    </p>
                    <p className="text-muted-foreground">{memberRemovalError.message}</p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!!memberRemovalPending}
                        onClick={() =>
                          void runMemberRemoval(
                            memberRemovalError.kind,
                            memberRemovalError.id,
                            memberRemovalError.label,
                            memberRemovalError.requestKey,
                          )
                        }
                      >
                        Retry {memberRemovalError.kind === "invite" ? "revocation" : "removal"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={!!memberRemovalPending}
                        onClick={() => {
                          if (
                            !memberRemovalScope.active ||
                            memberRemovalRef.current ||
                            memberRemovalError.requestKey !== currentRequestKeyRef.current
                          )
                            return;
                          setMemberRemovalError(null);
                          if (memberRemovalTriggerRef.current?.isConnected)
                            memberRemovalTriggerRef.current.focus();
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {memberRemovalStatus && <p role="status">{memberRemovalStatus}</p>}
              </div>
            )}
            <MembersTab
              members={members}
              invites={invites}
              isOwner={isOwner && !archived}
              onInvite={async (email, role) => {
                const fn = (await import("@/lib/projects.functions")).inviteMember;
                const res = await callServerFnDirect(fn, {
                  data: { project_id: projectId, email, role },
                });
                toast.success(
                  (res as { auto_accepted: boolean }).auto_accepted
                    ? "Member added"
                    : "Invitation sent",
                );
                await refresh();
              }}
              onRevoke={async (id) => {
                const invite = invites.find((item) => item.id === id);
                if (invite) await runMemberRemoval("invite", id, invite.email);
              }}
              onRemove={async (userId) => {
                const member = members.find((item) => item.user_id === userId);
                if (member)
                  await runMemberRemoval("member", userId, member.email ?? userId.slice(0, 8));
              }}
              onChangeRole={async (userId, role) => {
                const operationRequestKey = requestKey;
                const operation = Symbol();
                const operations = memberRoleOperationsRef.current;
                operations.set(userId, operation);
                const isCurrent = () =>
                  currentRequestKeyRef.current === operationRequestKey &&
                  operations.get(userId) === operation;
                try {
                  const fn = (await import("@/lib/projects.functions")).updateMemberRole;
                  if (!isCurrent()) return;
                  await callServerFnDirect(fn, {
                    data: { project_id: projectId, user_id: userId, role },
                  });
                  if (!isCurrent()) return;
                  // Retain the mounted select and its focus after a successful role change.
                  setMembers((previous) =>
                    previous.map((member) =>
                      member.user_id === userId ? { ...member, role } : member,
                    ),
                  );
                } catch (error) {
                  if (!isCurrent()) return;
                  toast.error(error instanceof Error ? error.message : "Failed to update role");
                } finally {
                  if (operations.get(userId) === operation) operations.delete(userId);
                }
              }}
            />
          </TabsContent>
          <TabsContent value="collaboration" className="mt-4">
            <ProjectCollaboration
              projectId={projectId}
              members={members}
              role={project.role}
              readOnly={archived}
            />
          </TabsContent>
          {isOwner && (
            <TabsContent value="settings" className="mt-4">
              {archived ? (
                <p className="text-sm text-muted-foreground">
                  Restore this project before changing its settings.
                </p>
              ) : (
                <SettingsTab
                  project={project}
                  onSave={async (patch) => {
                    const operationRequestKey = requestKey;
                    try {
                      await fnUpdate({ data: { id: projectId, ...patch } });
                    } catch (error) {
                      if (currentRequestKeyRef.current !== operationRequestKey) return;
                      throw error;
                    }
                    if (currentRequestKeyRef.current !== operationRequestKey) return;
                    // Keep the form mounted so edits made during this save survive.
                    setProject((previous) => (previous ? { ...previous, ...patch } : previous));
                    toast.success("Saved");
                  }}
                  onDelete={openProjectDelete}
                />
              )}
            </TabsContent>
          )}
          {!isOwner && (
            <TabsContent value="settings" className="mt-4">
              <div className="rounded-xl border border-destructive/40 p-4">
                <h2 className="text-sm font-medium">Leave project</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  You will lose access, but the project and its content will stay available to its
                  owner and other members.
                </p>
                <Button
                  className="mt-4"
                  variant="destructive"
                  onClick={(event) => {
                    projectActionUrlRef.current = window.location.href;
                    projectActionTriggerRef.current = event.currentTarget;
                    setLeaveOpen(true);
                  }}
                >
                  Leave project
                </Button>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </main>

      <SearchDialog
        projectId={projectId}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDialogFocus(
            projectSearchTriggerRef.current,
            projectSearchUrlRef.current,
            projectSearchRequestKeyRef.current !== currentRequestKeyRef.current,
          );
        }}
        onNavigate={(kind) => {
          setSearchOpen(false);
          setTab(kind === "chat" ? "chats" : kind === "file" ? "files" : kind);
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${project.name}”?`}
        message="This can't be undone. Stored file copies, chats, tasks, notes, memberships, and saved Results (including their versions and comments) will be removed. Interrupted cleanup remains visible and retryable."
        confirmLabel="Delete forever"
        destructive
        error={deleteError}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDialogFocus(projectActionTriggerRef.current, projectActionUrlRef.current);
        }}
        onConfirm={async () => {
          if (!isOwner) return;
          const operationRequestKey = requestKey;
          setDeleteError(null);
          try {
            await fnDelete({ data: { id: projectId } });
            if (currentRequestKeyRef.current !== operationRequestKey) return;
            toast.success("Project deleted");
            await navigate({ to: "/projects" });
          } catch (error) {
            if (currentRequestKeyRef.current !== operationRequestKey) return;
            setDeleteError(error instanceof Error ? error.message : "Deletion is incomplete.");
            await refresh();
          }
        }}
      />
      <ConfirmDialog
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDialogFocus(projectActionTriggerRef.current, projectActionUrlRef.current);
        }}
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={`Leave “${project.name}”?`}
        message="You will immediately lose access. Your existing content will not be deleted."
        confirmLabel="Leave project"
        destructive
        onConfirm={async () => {
          const operationRequestKey = requestKey;
          try {
            await fnLeave({ data: { project_id: projectId } });
            if (currentRequestKeyRef.current !== operationRequestKey) return;
            setLeaveOpen(false);
            toast.success("You left the project");
            await navigate({ to: "/projects" });
          } catch (error) {
            if (currentRequestKeyRef.current !== operationRequestKey) return;
            toast.error(error instanceof Error ? error.message : "Could not leave the project");
          }
        }}
      />
    </AppShell>
  );
}

// Helper for one-off server fn calls inside callbacks
function callServerFnDirect<T>(fn: unknown, arg: unknown): Promise<T> {
  return (fn as (a: unknown) => Promise<T>)(arg);
}

// ===================== OVERVIEW =====================
function OverviewTab({ projectId, onJump }: { projectId: string; onJump: (k: string) => void }) {
  const fnAct = useServerFn(listActivity);
  const fnTasks = useServerFn(listTasks);
  const [activity, setActivity] = useState<ProjectActivity[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [a, t] = await Promise.all([
          fnAct({ data: { project_id: projectId } }),
          fnTasks({ data: { project_id: projectId } }),
        ]);
        if (!active) return;
        setActivity(a);
        setTasks(t);
      } catch (reason) {
        if (!active) return;
        setError(
          reason instanceof Error ? reason.message : "Project overview could not be loaded.",
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, fnAct, fnTasks, reloadKey]);

  const openTasks = tasks.filter((t) => t.status !== "done").slice(0, 5);
  const doneCount = tasks.filter((t) => t.status === "done").length;

  if (loading)
    return (
      <div className="text-muted-foreground text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    );

  if (error)
    return (
      <section role="alert" className="rounded-xl border border-destructive/40 p-4">
        <h2 className="font-medium">Project overview could not be loaded</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Project activity and tasks are temporarily unavailable. Try again in a moment.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          Try again
        </Button>
      </section>
    );

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium flex items-center gap-2">
              <CheckSquare className="w-4 h-4" />
              Open tasks
            </div>
            <button
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onJump("tasks")}
            >
              View all
            </button>
          </div>
          {openTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No open tasks. {doneCount > 0 && `${doneCount} completed.`}
            </p>
          ) : (
            <ul className="space-y-2">
              {openTasks.map((t) => (
                <li key={t.id} className="text-sm flex items-center justify-between gap-2">
                  <span className="truncate">{t.title}</span>
                  {t.due_date && (
                    <span className="text-xs text-muted-foreground shrink-0">{t.due_date}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Recent activity
            </div>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity yet. Get started by adding chats, files, or tasks.
            </p>
          ) : (
            <ul className="space-y-2 max-h-80 overflow-auto">
              {activity.slice(0, 20).map((a) => (
                <li key={a.id} className="text-sm">
                  <div>{a.summary}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <RelatedWorkspaceItems projectId={projectId} title="Connected project work" />
    </>
  );
}

// ===================== CHATS =====================
// The page, rather than the dialog, owns successful Move focus: its refresh
// temporarily unmounts the entire Chats tab before the updated list is shown.
function useProjectChatMoveFocus(
  requestKey: string | null,
  refreshing: boolean,
  eligible: boolean,
) {
  const router = useRouter();
  const scope = useMemo(() => ({ key: requestKey, active: false }), [requestKey]);
  const currentScopeRef = useRef(scope);
  currentScopeRef.current = scope;
  const viewRef = useRef({ refreshing, eligible });
  viewRef.current = { refreshing, eligible };
  const pendingRef = useRef<{
    scope: typeof scope;
    url: string;
    source: HTMLElement | null;
    dialog: HTMLElement | null;
    completed: boolean;
    cancel: () => void;
  } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      pendingRef.current?.cancel();
    };
  }, [scope]);

  const begin = useCallback(
    (source: HTMLElement | null) => {
      pendingRef.current?.cancel();
      if (
        !requestKey ||
        !scope.active ||
        currentScopeRef.current !== scope ||
        typeof document === "undefined"
      )
        return null;
      const intent = {
        scope,
        url: window.location.href,
        source:
          source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
        dialog: source?.closest<HTMLElement>('[role="dialog"]') ?? null,
        completed: false,
        cancel: () => {},
      };
      const focusMoved = (event: FocusEvent) => {
        if (
          event.target !== document.body &&
          event.target !== document.documentElement &&
          event.target !== intent.source &&
          !intent.dialog?.contains(event.target as Node)
        )
          intent.cancel();
      };
      const cancel = () => intent.cancel();
      const unsubscribe = router.subscribe("onBeforeNavigate", cancel);
      intent.cancel = () => {
        if (pendingRef.current === intent) pendingRef.current = null;
        for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "visibilitychange"])
          document.removeEventListener(type, cancel, true);
        document.removeEventListener("focusin", focusMoved, true);
        window.removeEventListener("blur", cancel);
        window.removeEventListener("popstate", cancel);
        window.removeEventListener("hashchange", cancel);
        unsubscribe();
      };
      pendingRef.current = intent;
      for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "visibilitychange"])
        document.addEventListener(type, cancel, true);
      document.addEventListener("focusin", focusMoved, true);
      window.addEventListener("blur", cancel);
      window.addEventListener("popstate", cancel);
      window.addEventListener("hashchange", cancel);
      return {
        cancel: intent.cancel,
        complete: () => {
          if (pendingRef.current !== intent || !scope.active || currentScopeRef.current !== scope)
            return;
          intent.completed = true;
          setRevision((value) => value + 1);
        },
      };
    },
    [requestKey, router, scope],
  );

  useEffect(() => {
    const intent = pendingRef.current;
    if (!intent || refreshing) return;
    if (!eligible) {
      intent.cancel();
      return;
    }
    if (!intent.completed) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingRef.current !== intent) return;
      const active = document.activeElement;
      const target = document.querySelector<HTMLElement>("[data-project-chats-region]");
      const hasModal = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"][data-state="open"], dialog[open], [aria-modal="true"]:not([data-state="closed"])',
        ),
      ).some((dialog) => dialog.isConnected && dialog.getClientRects().length > 0);
      const current =
        intent.scope.active &&
        currentScopeRef.current === intent.scope &&
        !viewRef.current.refreshing &&
        viewRef.current.eligible &&
        window.location.href === intent.url &&
        document.visibilityState !== "hidden" &&
        router.state.status === "idle" &&
        !hasModal &&
        (!active ||
          active === document.body ||
          active === document.documentElement ||
          active === intent.source ||
          intent.dialog?.contains(active));
      intent.cancel();
      if (current) restoreDialogFocus(target, intent.url);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [eligible, refreshing, revision, router, scope]);
  return begin;
}

function ChatsTab({
  projectId,
  chats,
  canEdit,
  onRefresh,
  onMoveFocusRequest,
}: {
  projectId: string;
  chats: ProjectChatSummary[];
  canEdit: boolean;
  onRefresh: () => Promise<void>;
  onMoveFocusRequest?: (
    source: HTMLElement | null,
  ) => { complete: () => void; cancel: () => void } | null;
}) {
  const navigate = useNavigate();
  const fnCreate = useServerFn(createProjectChat);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("New chat");
  const [busy, setBusy] = useState(false);
  const { isSignedIn, user } = useUser();
  const requestKey = isSignedIn && user?.id ? JSON.stringify([user.id, projectId]) : null;
  const moveScope = useMemo(() => ({ key: requestKey, active: false }), [requestKey]);
  const currentMoveScopeRef = useRef(moveScope);
  currentMoveScopeRef.current = moveScope;
  const moveSessionRef = useRef<symbol | null>(null);
  const destinationLoadSequenceRef = useRef(0);
  const moveOperationRef = useRef<symbol | null>(null);
  const moveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moveOriginRef = useRef<{ scope: typeof moveScope; url: string } | null>(null);
  const chatsRegionRef = useRef<HTMLDivElement | null>(null);
  const fnListProjects = useServerFn(listProjects);
  const fnMoveChat = useServerFn(moveChatToProject);
  const [moveChat, setMoveChat] = useState<ProjectChatSummary | null>(null);
  const [destinations, setDestinations] = useState<ProjectSummary[]>([]);
  const [destinationId, setDestinationId] = useState("");
  const [destinationSearch, setDestinationSearch] = useState("");
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    moveScope.active = true;
    moveSessionRef.current = null;
    moveOperationRef.current = null;
    setMoveChat(null);
    setDestinations([]);
    setDestinationId("");
    setDestinationSearch("");
    setDestinationError(null);
    setMoveError(null);
    setMoving(false);
    setDestinationsLoading(false);
    return () => {
      moveScope.active = false;
      moveSessionRef.current = null;
      moveOperationRef.current = null;
    };
  }, [moveScope]);

  async function loadDestinations(session: symbol) {
    const sequence = ++destinationLoadSequenceRef.current;
    const isCurrent = () =>
      moveScope.active &&
      currentMoveScopeRef.current === moveScope &&
      moveSessionRef.current === session &&
      destinationLoadSequenceRef.current === sequence;
    if (!requestKey || !canEdit || !isCurrent()) return;
    setDestinationsLoading(true);
    setDestinationError(null);
    try {
      const projects = await fnListProjects();
      if (!isCurrent()) return;
      setDestinations(
        projects.filter(
          (item) => item.id !== projectId && item.role !== "viewer" && !item.deletion_requested_at,
        ),
      );
    } catch {
      if (isCurrent()) setDestinationError("Projects could not be loaded. Try again.");
    } finally {
      if (isCurrent()) setDestinationsLoading(false);
    }
  }

  function openMove(chat: ProjectChatSummary, trigger: HTMLButtonElement) {
    if (
      !canEdit ||
      !requestKey ||
      !moveScope.active ||
      currentMoveScopeRef.current !== moveScope ||
      moveOperationRef.current
    )
      return;
    const session = Symbol("move chat destinations");
    moveSessionRef.current = session;
    moveTriggerRef.current = trigger;
    moveOriginRef.current = {
      scope: moveScope,
      url: typeof window === "undefined" ? "" : window.location.href,
    };
    setMoveChat(chat);
    setDestinationId("");
    setDestinationSearch("");
    setDestinations([]);
    setMoveError(null);
    void loadDestinations(session);
  }

  async function handleMove(event?: { currentTarget: HTMLButtonElement }) {
    const destination = destinations.find((item) => item.id === destinationId);
    const session = moveSessionRef.current;
    if (
      !canEdit ||
      !requestKey ||
      !moveChat ||
      !session ||
      !destination ||
      destination.id === projectId ||
      destination.role === "viewer" ||
      destination.deletion_requested_at ||
      destinationsLoading ||
      destinationError ||
      moveOperationRef.current ||
      !moveScope.active ||
      currentMoveScopeRef.current !== moveScope
    )
      return;
    const operation = Symbol("move project chat");
    moveOperationRef.current = operation;
    const focusReturn = onMoveFocusRequest?.(event?.currentTarget ?? null);
    const isCurrent = () =>
      moveScope.active &&
      currentMoveScopeRef.current === moveScope &&
      moveSessionRef.current === session &&
      moveOperationRef.current === operation;
    setMoving(true);
    setMoveError(null);
    try {
      await fnMoveChat({ data: { chat_id: moveChat.id, project_id: destination.id } });
      if (!isCurrent()) {
        focusReturn?.cancel();
        return;
      }
      // The invoker and its fallback both disappear during the page refresh.
      // Successful moves use the page-owned focus intent instead of dialog return.
      moveOriginRef.current = null;
      setMoveChat(null);
      toast.success(`Chat moved to ${destination.name}`);
      // The source list is refreshed only after the existing move contract confirms success.
      await onRefresh();
      focusReturn?.complete();
    } catch {
      focusReturn?.cancel();
      if (isCurrent())
        setMoveError(
          "The move could not be confirmed. Your selected destination is preserved; check the chat's location before trying again.",
        );
    } finally {
      if (isCurrent()) {
        moveOperationRef.current = null;
        setMoving(false);
      }
    }
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const { id } = await fnCreate({
        data: { project_id: projectId, title: title.trim(), messages: [] },
      });
      setCreating(false);
      await onRefresh();
      navigate({ to: "/projects/$projectId/chat/$chatId", params: { projectId, chatId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={chatsRegionRef}
      data-project-chats-region
      tabIndex={-1}
      role="region"
      aria-label="Project chats"
      className="kova-project-collection"
    >
      <div className="kova-project-collection-toolbar">
        <div>
          <h2>Chats</h2>
          <p className="kova-project-collection-summary">
            {chats.length} chat{chats.length === 1 ? "" : "s"} in this project
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" />
            New chat
          </Button>
        )}
      </div>
      {canEdit && chats.length > 0 && (
        <p
          id="project-chat-delete-unavailable"
          className="kova-project-collection-note"
          role="note"
        >
          {PROJECT_CHAT_DELETE_UNAVAILABLE}
        </p>
      )}
      {chats.length === 0 ? (
        <EmptyState
          icon={<MessageCircle className="w-10 h-10" />}
          title="No chats yet"
          hint="Chats you create here are visible to everyone in this project."
        />
      ) : (
        <div className="kova-project-resource-list" data-editable={canEdit}>
          <div
            className="kova-project-chat-columns kova-project-resource-columns"
            aria-hidden="true"
          >
            <span>Name</span>
            <span>Last updated</span>
            {canEdit && <span className="sr-only">Actions</span>}
          </div>
          <div role="list" aria-label="Project conversations">
            {chats.map((c) => (
              <div
                key={c.id}
                role="listitem"
                draggable={canEdit && !moving}
                onDragStart={(event) => {
                  if (!canEdit || moveOperationRef.current) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-kova-project-chat", c.id);
                  event.dataTransfer.setData("text/plain", c.title);
                }}
                className="kova-project-resource-row kova-project-chat-columns"
                title={
                  canEdit ? "Use Move to project or drag this chat onto another project" : undefined
                }
              >
                <Link
                  to="/projects/$projectId/chat/$chatId"
                  params={{ projectId, chatId: c.id }}
                  className="kova-project-resource-link min-h-11"
                >
                  <span className="kova-project-resource-icon" aria-hidden="true">
                    <MessageCircle className="h-5 w-5" />
                  </span>
                  <span className="kova-project-resource-name">{c.title}</span>
                </Link>
                <time
                  className="kova-project-resource-date"
                  dateTime={c.updated_at}
                  title={new Date(c.updated_at).toLocaleString()}
                >
                  <span className="kova-project-mobile-label">Updated </span>
                  {new Date(c.updated_at).toLocaleDateString()}
                </time>
                {canEdit && (
                  <div className="kova-project-resource-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      disabled={moving}
                      aria-label={`Move ${c.title} to project`}
                      title="Move to project"
                      onClick={(event) => openMove(c, event.currentTarget)}
                    >
                      <FolderInput className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      disabled
                      aria-label={`Delete ${c.title} unavailable`}
                      aria-describedby="project-chat-delete-unavailable"
                      title={PROJECT_CHAT_DELETE_UNAVAILABLE}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(moveChat && moveScope.active && requestKey)}
        onOpenChange={(open) => {
          if (!open && !moveOperationRef.current) {
            moveSessionRef.current = null;
            setMoveChat(null);
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const origin = moveOriginRef.current;
            moveOriginRef.current = null;
            if (
              !origin ||
              !origin.scope.active ||
              currentMoveScopeRef.current !== origin.scope ||
              (typeof window !== "undefined" && origin.url !== window.location.href)
            )
              return;
            if (moveTriggerRef.current?.isConnected && !moveTriggerRef.current.disabled)
              moveTriggerRef.current.focus();
            else chatsRegionRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Move to project</DialogTitle>
            <DialogDescription>
              Move “{moveChat?.title}” to a project you can edit. Members of the destination project
              will be able to see this chat.
            </DialogDescription>
          </DialogHeader>
          {destinationsLoading ? (
            <p role="status">Loading projects…</p>
          ) : destinationError ? (
            <div role="alert" className="space-y-2">
              <p>{destinationError}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (moveSessionRef.current) void loadDestinations(moveSessionRef.current);
                }}
              >
                Retry loading projects
              </Button>
            </div>
          ) : (
            <>
              {destinations.length > 7 && (
                <Input
                  aria-label="Search destination projects"
                  placeholder="Search projects…"
                  value={destinationSearch}
                  disabled={moving}
                  onChange={(event) => setDestinationSearch(event.target.value)}
                />
              )}
              <fieldset className="max-h-72 space-y-1 overflow-y-auto" disabled={moving}>
                <legend className="sr-only">Destination project</legend>
                {destinations
                  .filter((item) =>
                    item.name
                      .toLocaleLowerCase()
                      .includes(destinationSearch.trim().toLocaleLowerCase()),
                  )
                  .map((item) => (
                    <label
                      key={item.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 hover:bg-accent"
                    >
                      <input
                        type="radio"
                        name="project-chat-destination"
                        value={item.id}
                        checked={destinationId === item.id}
                        onChange={() => setDestinationId(item.id)}
                      />
                      <span className="min-w-0 break-words">
                        {item.name}
                        {item.archived_at ? " (archived)" : ""}
                      </span>
                    </label>
                  ))}
                {!destinations.length && (
                  <p className="text-sm text-muted-foreground">
                    No other editable projects are available.
                  </p>
                )}
                {destinations.length > 0 &&
                  !destinations.some((item) =>
                    item.name
                      .toLocaleLowerCase()
                      .includes(destinationSearch.trim().toLocaleLowerCase()),
                  ) && (
                    <p className="text-sm text-muted-foreground">No projects match your search.</p>
                  )}
              </fieldset>
            </>
          )}
          {moveError && (
            <p role="alert" className="text-sm text-destructive">
              {moveError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={moving}
              onClick={() => {
                moveSessionRef.current = null;
                setMoveChat(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                moving || destinationsLoading || !!destinationError || !destinationId || !canEdit
              }
              onClick={handleMove}
            >
              {moving ? "Moving…" : "Move chat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New chat</DialogTitle>
          </DialogHeader>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !title.trim()} onClick={handleCreate}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===================== FILES / IMAGES =====================
function FilesTab({
  projectId,
  canEdit,
  kind,
}: {
  projectId: string;
  canEdit: boolean;
  kind: "file" | "image";
}) {
  const { user } = useUser();
  const fileOwnerId = user?.id;
  const fnList = useServerFn(listFiles);
  const [items, setItems] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadOperationRef = useRef<symbol | null>(null);
  const uploadContextKey = `${fileOwnerId ?? ""}:${projectId}:${kind}`;
  const currentUploadContextRef = useRef(uploadContextKey);
  currentUploadContextRef.current = uploadContextKey;
  useEffect(() => {
    uploadOperationRef.current = null;
    setUploading(false);
    return () => {
      uploadOperationRef.current = null;
    };
  }, [uploadContextKey]);
  const refreshedImageUrlsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!isCurrent()) return;
      setLoading(true);
      setLoadError(null);
      refreshedImageUrlsRef.current.clear();
      try {
        const files = await fnList({ data: { project_id: projectId, kind } });
        if (isCurrent()) setItems(files);
      } catch {
        if (!isCurrent()) return;
        setLoadError(
          "Files could not be loaded because earlier storage cleanup is incomplete. Retry shortly.",
        );
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [projectId, kind, fnList],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function projectFileRequest(input: RequestInit, search = ""): Promise<Response> {
    const { data, error } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token || !fileOwnerId || data.session?.user.id !== fileOwnerId)
      throw new Error("Your session expired or account changed. Sign in again and retry.");
    const headers = new Headers(input.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-Kova-Owner", fileOwnerId);
    return fetch(`/api/project-files${search}`, {
      ...input,
      headers,
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
    });
  }

  async function getFreshFileUrl(fileId: string): Promise<string> {
    const response = await projectFileRequest(
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
      `?id=${encodeURIComponent(fileId)}`,
    );
    const payload = (await response.json().catch(() => null)) as { url?: unknown } | null;
    if (!response.ok || typeof payload?.url !== "string" || !payload.url) {
      throw new Error("A fresh file link could not be created. Please retry.");
    }
    const url = new URL(payload.url, window.location.origin);
    const localHttp =
      url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) {
      throw new Error("The file service returned an unsafe link.");
    }
    return url.toString();
  }

  async function openFile(file: ProjectFile) {
    setDownloadingId(file.id);
    const target = window.open("about:blank", "_blank");
    if (target) target.opener = null;
    try {
      const url = await getFreshFileUrl(file.id);
      if (target) target.location.replace(url);
      else window.location.assign(url);
    } catch (error) {
      target?.close();
      toast.error(error instanceof Error ? error.message : "The file could not be opened.");
    } finally {
      setDownloadingId((current) => (current === file.id ? null : current));
    }
  }

  async function refreshImageUrl(file: ProjectFile) {
    if (refreshedImageUrlsRef.current.has(file.id)) {
      setItems((current) =>
        current.map((item) => (item.id === file.id ? { ...item, signed_url: null } : item)),
      );
      return;
    }
    refreshedImageUrlsRef.current.add(file.id);
    try {
      const url = await getFreshFileUrl(file.id);
      setItems((current) =>
        current.map((item) => (item.id === file.id ? { ...item, signed_url: url } : item)),
      );
    } catch {
      setItems((current) =>
        current.map((item) => (item.id === file.id ? { ...item, signed_url: null } : item)),
      );
      toast.error(`${file.name} could not be previewed. Retry shortly.`);
    }
  }

  async function responseError(response: Response): Promise<string> {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const code = typeof payload?.error === "string" ? payload.error : "";
    const messages: Record<string, string> = {
      file_too_large: "Files must be 10 MB or smaller.",
      unsupported_file_type: "That file type is not supported.",
      image_signature_required: "The selected file is not a valid image.",
      file_content_does_not_match_type: "The file contents do not match its type.",
      invalid_json_file: "The selected JSON file is invalid.",
      project_file_limit_reached: "This project has reached its file limit.",
      project_file_upload_in_progress: "This upload is already in progress.",
      project_file_daily_limit_reached: "You have reached today's file upload limit.",
      project_file_quota_unavailable: "Upload limits could not be verified. Retry shortly.",
      project_file_cleanup_incomplete:
        "Earlier file cleanup must finish before another upload. Retry shortly.",
      project_file_storage_unavailable: "File storage is temporarily unavailable. Retry shortly.",
      project_storage_limit_reached: "This project's owner has reached their storage limit.",
      project_storage_quota_unavailable:
        "Project storage limits could not be verified. Retry shortly.",
      project_file_quota_recovery_failed:
        "The upload could not be safely released after its quota check. Retry shortly.",
      project_file_storage_finalize_failed:
        "The uploaded file could not be finalized safely. Retry shortly.",
      project_file_temp_cleanup_failed:
        "The upload completed, but temporary storage cleanup must finish before it appears.",
      project_file_finalize_unavailable:
        "The upload is stored safely but could not be published yet. Retry shortly.",
    };
    return messages[code] ?? "The file could not be uploaded. Please retry.";
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !canEdit || uploadOperationRef.current) return;
    const operation = Symbol();
    uploadOperationRef.current = operation;
    const isCurrent = () =>
      uploadOperationRef.current === operation &&
      currentUploadContextRef.current === uploadContextKey;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name}: files must be 10 MB or smaller`);
          continue;
        }
        const idempotencyKey = crypto.randomUUID();
        try {
          const response = await projectFileRequest({
            method: "POST",
            body: file,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Kova-Project-Id": projectId,
              "X-Kova-File-Name": encodeURIComponent(file.name),
              "X-Kova-File-Kind": kind,
              "X-Kova-Idempotency-Key": idempotencyKey,
            },
          });
          if (!isCurrent()) return;
          if (!response.ok) throw new Error(await responseError(response));
          toast.success(`${file.name} uploaded`);
        } catch (error) {
          if (!isCurrent()) return;
          toast.error(
            error instanceof Error ? error.message : `${file.name} could not be uploaded`,
          );
        }
      }
      await refresh(isCurrent);
    } finally {
      if (isCurrent()) {
        uploadOperationRef.current = null;
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  }

  async function handleDeleteFile(id: string) {
    try {
      const response = await projectFileRequest({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        throw new Error("The file could not be deleted. Please retry.");
      }
      setConfirmId(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The file could not be deleted.");
    }
  }

  return (
    <div className="kova-project-collection">
      <div className="kova-project-collection-toolbar">
        <div>
          <h2>{kind === "image" ? "Images" : "Files"}</h2>
          <p className="kova-project-collection-summary">
            {items.length} {kind === "image" ? "image" : "file"}
            {items.length === 1 ? "" : "s"} in this project
          </p>
        </div>
        {canEdit && (
          <div>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              accept={
                kind === "image"
                  ? "image/png,image/jpeg,image/webp,image/gif"
                  : ".txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.log,.ini,.conf,.cfg,.toml,.sql,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.php,.sh,.c,.cpp,.h,.hpp,.cs,.vue,.svelte,.r,.pdf"
              }
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              size="sm"
              onClick={() => {
                if (!uploadOperationRef.current) inputRef.current?.click();
              }}
              aria-disabled={uploading}
              aria-busy={uploading}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Upload
            </Button>
          </div>
        )}
      </div>

      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className="kova-project-upload-zone"
          data-drag-over={dragOver}
        >
          Drag {kind === "image" ? "images" : "files"} here to upload
        </div>
      )}

      {loading ? (
        <div className="text-muted-foreground text-sm flex items-center gap-2" role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
          <p className="text-sm text-foreground">Files could not be loaded. Try again.</p>
          <Button className="mt-3" variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={
            kind === "image" ? (
              <ImageIcon className="w-10 h-10" />
            ) : (
              <FileText className="w-10 h-10" />
            )
          }
          title={kind === "image" ? "No images yet" : "No files yet"}
          hint={
            canEdit
              ? `Upload ${kind === "image" ? "images" : "files"} to share with your project.`
              : "Nothing has been uploaded here yet."
          }
        />
      ) : kind === "image" ? (
        <div className="kova-project-image-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {items.map((f) => (
            <div
              key={f.id}
              className="group relative border rounded-xl overflow-hidden aspect-square bg-muted"
            >
              {f.signed_url ? (
                <img
                  src={f.signed_url}
                  alt={f.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={() => void refreshImageUrl(f)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="w-8 h-8" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs text-white truncate">
                {f.name}
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setConfirmId(f.id)}
                  className="absolute right-2 top-2 flex min-h-11 min-w-11 items-center justify-center rounded bg-background/90 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  aria-label="Delete image"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="kova-project-resource-list" data-editable={canEdit}>
          <div
            className="kova-project-file-columns kova-project-resource-columns"
            aria-hidden="true"
          >
            <span>Name</span>
            <span>File size</span>
            <span>Added</span>
            <span className="sr-only">Actions</span>
          </div>
          <div role="list" aria-label="Project files">
            {items.map((f) => (
              <div
                key={f.id}
                role="listitem"
                className="kova-project-resource-row kova-project-file-columns"
              >
                <button
                  type="button"
                  className="kova-project-resource-link min-h-11"
                  onClick={() => void openFile(f)}
                  disabled={downloadingId === f.id}
                >
                  <span className="kova-project-resource-icon" aria-hidden="true">
                    <FileText className="h-5 w-5" />
                  </span>
                  <span className="kova-project-resource-name">{f.name}</span>
                </button>
                <span className="kova-project-resource-size">{humanBytes(f.size_bytes)}</span>
                <time
                  className="kova-project-resource-date"
                  dateTime={f.created_at}
                  title={new Date(f.created_at).toLocaleString()}
                >
                  <span className="kova-project-mobile-label">Added </span>
                  {new Date(f.created_at).toLocaleDateString()}
                </time>
                <div className="kova-project-resource-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"

                    onClick={() => void openFile(f)}
                    disabled={downloadingId === f.id}
                    aria-label={`Open ${f.name}`}
                  >
                    {downloadingId === f.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmId(f.id)}

                      aria-label={`Delete ${f.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId}
        onOpenChange={(v) => !v && setConfirmId(null)}
        title={`Delete this ${kind}?`}
        message="This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!confirmId) return;
          await handleDeleteFile(confirmId);
        }}
      />
    </div>
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const projectInstructionDrafts = new Map<string, string>();

function ProjectInstructionsTab({
  project,
  canEdit,
  onSave,
}: {
  project: ProjectDetail;
  canEdit: boolean;
  onSave: (systemPrompt: string | null) => Promise<void>;
}) {
  const { user } = useUser();
  const draftKey = `${user?.id ?? "signed-out"}:${project.id}`;
  const [draft, setDraft] = useState(
    () => projectInstructionDrafts.get(draftKey) ?? project.system_prompt ?? "",
  );
  const [lastSaved, setLastSaved] = useState(project.system_prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lifetimeRef = useRef(0);
  const instructionsInputRef = useRef<HTMLTextAreaElement | null>(null);
  const projectRef = useRef(project);
  const onSaveRef = useRef(onSave);
  projectRef.current = project;
  onSaveRef.current = onSave;

  useEffect(() => {
    // A completed save updates props, but must never overwrite newer typing.
    const initial = projectRef.current.system_prompt ?? "";
    setDraft(projectInstructionDrafts.get(draftKey) ?? initial);
    setLastSaved(initial);
    setSaving(false);
    setError(null);
    setSaved(false);
    return () => {
      lifetimeRef.current += 1;
    };
  }, [project.id, draftKey]);

  const saveBusyRef = useRef(false);
  async function saveInstructions() {
    if (!canEdit || saveBusyRef.current || draft === lastSaved) return;
    const lifetime = lifetimeRef.current;
    saveBusyRef.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await onSaveRef.current(draft.trim() || null);
      if (lifetime !== lifetimeRef.current) return;
      setLastSaved(draft);
      if (projectInstructionDrafts.get(draftKey) === draft)
        projectInstructionDrafts.delete(draftKey);
      setSaved(true);
    } catch (saveError) {
      if (lifetime === lifetimeRef.current)
        setError(saveError instanceof Error ? saveError.message : "Instructions were not saved.");
    } finally {
      saveBusyRef.current = false;
      if (lifetime === lifetimeRef.current) setSaving(false);
    }
  }

  return (
    <section className="kova-project-instructions" aria-labelledby="project-instructions-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="project-instructions-title" className="text-base font-semibold">
            Project instructions
          </h2>
          <p className="text-sm text-muted-foreground">
            These instructions are injected into project chats once and combined with authorized
            project file context.
          </p>
        </div>
        <div className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
          {saving
            ? "Saving…"
            : saved && draft === lastSaved
              ? "Saved"
              : error
                ? "Save failed"
                : draft !== lastSaved
                  ? "Unsaved changes"
                  : ""}
        </div>
      </div>
      <Textarea
        ref={instructionsInputRef}
        value={draft}
        onChange={(event) => {
          const value = event.target.value.slice(0, 4000);
          setDraft(value);
          projectInstructionDrafts.set(draftKey, value);
        }}
        disabled={!canEdit}
        rows={8}
        maxLength={4000}
        aria-labelledby="project-instructions-title"
        aria-describedby={
          error
            ? "project-instructions-help project-instructions-error"
            : "project-instructions-help"
        }
        placeholder={
          canEdit
            ? "Add brand voice, audience, constraints, or team preferences for project chats."
            : "No project instructions."
        }
        className="min-h-48 resize-y"
      />
      <div id="project-instructions-help" className="mt-2 text-xs text-muted-foreground">
        {draft.length}/4000 characters.{" "}
        {canEdit
          ? "Failed saves keep your unsaved text for retry."
          : "Only the project owner can change these instructions."}
      </div>
      {canEdit && (
        <div className="spec400-form-actions">
          <Button
            variant="outline"
            disabled={saving || draft === lastSaved}
            onClick={() => {
              setDraft(lastSaved);
              projectInstructionDrafts.delete(draftKey);
              setError(null);
              instructionsInputRef.current?.focus();
            }}
          >
            Cancel
          </Button>
          <Button disabled={saving || draft === lastSaved} onClick={() => void saveInstructions()}>
            {saving ? (
              <span className="spec400-loading-label">
                <span className="spec400-loading-spinner" aria-hidden="true" />
                Saving…
              </span>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      )}
      {error ? (
        <div
          id="project-instructions-error"
          className="mt-3 rounded-[var(--kova-radius-input)] border border-[var(--border-destructive)] bg-destructive/10 p-3 text-sm text-foreground"
        >
          Your instructions could not be saved. Your draft is preserved.
          <button
            type="button"
            className="ml-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 underline"
            disabled={saving || !canEdit}
            onClick={() => void saveInstructions()}
          >
            Retry
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ===================== NOTES =====================
function NotesTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  return <CollaborativeProjectNotes projectId={projectId} canEdit={canEdit} />;
}

// ===================== TASKS =====================
function TasksTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { user, isSignedIn } = useUser();
  const requestKey = isSignedIn && user?.id ? `${user.id}:${projectId}` : null;
  const fnList = useServerFn(listTasks);
  const fnCreate = useServerFn(createTask);
  const fnUpdate = useServerFn(updateTask);
  const fnDelete = useServerFn(deleteTask);
  const fnReorder = useServerFn(reorderTasks);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewKey, setViewKey] = useState(requestKey);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const currentRequestKeyRef = useRef(requestKey);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const loadingRef = useRef(true);
  const hasLoadedRef = useRef(false);
  const mutationOperationRef = useRef<symbol | null>(null);
  const reorderOperationRef = useRef<symbol | null>(null);
  currentRequestKeyRef.current = requestKey;
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const dragId = useRef<string | null>(null);
  const taskRegionRef = useRef<HTMLDivElement | null>(null);
  const deleteInvokerRef = useRef<{
    target: HTMLButtonElement | null;
    key: string | null;
    generation: number;
    url: string;
  } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!requestKey || !mountedRef.current || currentRequestKeyRef.current !== requestKey)
      return false;
    const generation = generationRef.current;
    const sequence = ++loadSequenceRef.current;
    const isCurrent = () =>
      mountedRef.current &&
      generationRef.current === generation &&
      currentRequestKeyRef.current === requestKey &&
      loadSequenceRef.current === sequence;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await fnList({ data: { project_id: projectId } });
      if (!isCurrent()) return false;
      setTasks(rows);
      hasLoadedRef.current = true;
      setHasLoaded(true);
      setReorderError((error) =>
        error
          ? "The previous reorder couldn't be confirmed. Showing the latest saved tasks."
          : null,
      );
      return true;
    } catch {
      if (isCurrent())
        setLoadError(
          hasLoadedRef.current
            ? "Couldn't refresh tasks. The previously loaded tasks are still shown; their order may be out of date."
            : "Couldn't load tasks. Try again.",
        );
      return false;
    } finally {
      if (isCurrent()) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [projectId, fnList, requestKey]);
  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    hasLoadedRef.current = false;
    loadingRef.current = false;
    reorderOperationRef.current = null;
    mutationOperationRef.current = null;
    dragId.current = null;
    setViewKey(requestKey);
    setTasks([]);
    setHasLoaded(false);
    setLoadError(null);
    setReorderError(null);
    setReordering(false);
    setMutationError(null);
    setBusy(false);
    setTitle("");
    setDue("");
    setConfirmId(null);
    setLoading(Boolean(requestKey));
    void refresh();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      loadSequenceRef.current += 1;
      reorderOperationRef.current = null;
      mutationOperationRef.current = null;
      dragId.current = null;
    };
  }, [refresh, requestKey]);

  async function runTaskMutation(
    action: () => Promise<unknown>,
    failureMessage: string,
    onSuccess?: () => void,
    onStart?: () => void,
  ) {
    if (
      !canEdit ||
      !requestKey ||
      !mountedRef.current ||
      currentRequestKeyRef.current !== requestKey ||
      loadingRef.current ||
      loadError ||
      mutationOperationRef.current ||
      reorderOperationRef.current
    )
      return;
    const generation = generationRef.current;
    const operation = Symbol("task mutation");
    mutationOperationRef.current = operation;
    const isCurrent = () =>
      mountedRef.current &&
      generationRef.current === generation &&
      currentRequestKeyRef.current === requestKey &&
      mutationOperationRef.current === operation;
    onStart?.();
    setBusy(true);
    setMutationError(null);
    try {
      await action();
      if (!isCurrent()) return;
      onSuccess?.();
      await refresh();
    } catch {
      if (!isCurrent()) return;
      setMutationError(failureMessage);
      toast.error(failureMessage);
      await refresh();
    } finally {
      if (isCurrent()) {
        mutationOperationRef.current = null;
        setBusy(false);
      }
    }
  }

  async function handleAdd() {
    if (!title.trim()) return;
    await runTaskMutation(
      () =>
        fnCreate({ data: { project_id: projectId, title: title.trim(), due_date: due || null } }),
      "Couldn't confirm that the task was added. Check the task list before trying again.",
      () => {
        setTitle("");
        setDue("");
      },
    );
  }

  async function cycleStatus(t: ProjectTask) {
    const next = t.status === "todo" ? "doing" : t.status === "doing" ? "done" : "todo";
    await runTaskMutation(
      () => fnUpdate({ data: { id: t.id, status: next } }),
      "Couldn't confirm the task status. Check the task list before trying again.",
      undefined,
      () => taskRegionRef.current?.focus(),
    );
  }

  async function handleDelete() {
    if (!confirmId) return;
    await runTaskMutation(
      () => fnDelete({ data: { id: confirmId } }),
      "Couldn't confirm that the task was deleted. Check the task list before trying again.",
      () => setConfirmId(null),
    );
  }

  function onDragStart(id: string) {
    if (
      !canEdit ||
      loadingRef.current ||
      mutationOperationRef.current ||
      reorderOperationRef.current ||
      loadError
    )
      return;
    dragId.current = id;
  }
  async function onDrop(overId: string) {
    const draggedId = dragId.current;
    dragId.current = null;
    if (draggedId) await moveTask(draggedId, overId);
  }

  // Both pointer controls and drag-and-drop use the same guarded persistence/recovery path.
  async function moveTask(draggedId: string, overId: string, returnToRegion = false) {
    if (
      !canEdit ||
      !requestKey ||
      !mountedRef.current ||
      currentRequestKeyRef.current !== requestKey ||
      loadingRef.current ||
      reorderOperationRef.current ||
      mutationOperationRef.current ||
      loadError ||
      !draggedId ||
      draggedId === overId
    )
      return;
    const from = tasks.findIndex((t) => t.id === draggedId);
    const to = tasks.findIndex((t) => t.id === overId);
    if (from < 0 || to < 0) return;
    const previous = tasks;
    const next = tasks.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const generation = generationRef.current;
    const operation = Symbol("task reorder");
    reorderOperationRef.current = operation;
    const isCurrent = () =>
      mountedRef.current &&
      generationRef.current === generation &&
      currentRequestKeyRef.current === requestKey &&
      reorderOperationRef.current === operation;
    // Explicit Up/Down loses its position or becomes disabled immediately.
    // Focus the stable region now; async reconciliation never overrides later input.
    if (returnToRegion) taskRegionRef.current?.focus({ preventScroll: true });
    setReordering(true);
    setReorderError(null);
    setMutationError(null);
    setTasks(next);
    try {
      await fnReorder({ data: { project_id: projectId, order: next.map((t) => t.id) } });
    } catch {
      if (!isCurrent()) return;
      // A failure may follow successful earlier writes, so rollback is only a readable fallback.
      setTasks(previous);
      const message = "Couldn't confirm the task order. Some changes may have been saved.";
      setReorderError(message);
      toast.error(message);
      await refresh();
    } finally {
      if (isCurrent()) {
        reorderOperationRef.current = null;
        setReordering(false);
      }
    }
  }

  const grouped = useMemo(
    () => ({
      todo: tasks.filter((t) => t.status === "todo"),
      doing: tasks.filter((t) => t.status === "doing"),
      done: tasks.filter((t) => t.status === "done"),
    }),
    [tasks],
  );

  if (viewKey !== requestKey || (loading && !hasLoaded))
    return (
      <div
        ref={taskRegionRef}
        data-project-tasks-region
        role="region"
        aria-label="Project tasks"
        tabIndex={-1}
        aria-busy="true"
        className="text-muted-foreground text-sm flex items-center gap-2"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading tasks…
      </div>
    );

  return (
    <div
      ref={taskRegionRef}
      data-project-tasks-region
      role="region"
      aria-label="Project tasks"
      tabIndex={-1}
      aria-busy={loading || reordering || busy}
    >
      {(reorderError || mutationError || loadError) && (
        <div role="alert" className="mb-3 text-sm text-destructive">
          {reorderError && <p>{reorderError}</p>}
          {mutationError && <p>{mutationError}</p>}
          {loadError && <p>{loadError}</p>}
          {loadError && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!mountedRef.current || currentRequestKeyRef.current !== requestKey) return;
                // Move to the stable region before Retry is removed. Later user
                // navigation is never overridden by an asynchronous completion.
                taskRegionRef.current?.focus();
                void refresh();
              }}
              disabled={loading || reordering || busy}
            >
              Retry loading tasks
            </Button>
          )}
        </div>
      )}
      {reordering && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {reorderError ? "Reloading tasks…" : "Saving task order…"}
        </p>
      )}
      {canEdit && (
        <div className="border rounded-xl p-3 mb-4 flex flex-col sm:flex-row gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New task…"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-40"
            />
            <Button
              onClick={handleAdd}
              disabled={busy || loading || reordering || !!loadError || !title.trim()}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add
                </>
              )}
            </Button>
          </div>
        </div>
      )}
      {!hasLoaded ? null : tasks.length === 0 ? (
        <EmptyState
          icon={<CheckSquare className="w-10 h-10" />}
          title="No tasks yet"
          hint={canEdit ? "Add your first task above." : "Nothing to do here yet."}
        />
      ) : (
        <div className="space-y-4">
          {(["todo", "doing", "done"] as const).map((k) => (
            <div key={k}>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                {k === "todo" ? "To do" : k === "doing" ? "In progress" : "Done"} ·{" "}
                {grouped[k].length}
              </div>
              <div className="border rounded-xl divide-y">
                {grouped[k].length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">Nothing here.</div>
                )}
                {grouped[k].map((t, position) => (
                  <div
                    key={t.id}
                    draggable={canEdit && !loading && !busy && !reordering && !loadError}
                    onDragStart={() => onDragStart(t.id)}
                    onDragEnd={() => {
                      dragId.current = null;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(t.id)}
                    className="flex items-center gap-2 p-3 group"
                  >
                    {canEdit && (
                      <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
                    )}
                    <button
                      onClick={() => cycleStatus(t)}
                      disabled={!canEdit || busy || loading || reordering || !!loadError}
                      aria-label="Cycle status"
                      className={`min-w-11 min-h-11 rounded-lg border-2 shrink-0 flex items-center justify-center ${t.status === "done" ? "bg-primary border-primary text-primary-foreground" : t.status === "doing" ? "border-amber-500" : "border-muted-foreground/40"}`}
                    >
                      {t.status === "done" && <CheckSquare className="w-3 h-3" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm truncate ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}
                      >
                        {t.title}
                      </div>
                      {t.due_date && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {t.due_date}
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <div
                        className="flex shrink-0 flex-col sm:flex-row"
                        aria-label={`Reorder ${t.title}`}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"

                          aria-label={`Move ${t.title} up`}
                          title="Move up"
                          disabled={position === 0 || busy || loading || reordering || !!loadError}
                          onClick={() => {
                            const previous = grouped[k][position - 1];
                            if (previous) void moveTask(t.id, previous.id, true);
                          }}
                        >
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"

                          aria-label={`Move ${t.title} down`}
                          title="Move down"
                          disabled={
                            position === grouped[k].length - 1 ||
                            busy ||
                            loading ||
                            reordering ||
                            !!loadError
                          }
                          onClick={() => {
                            const next = grouped[k][position + 1];
                            if (next) void moveTask(t.id, next.id, true);
                          }}
                        >
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => {
                          deleteInvokerRef.current = {
                            target: event?.currentTarget ?? null,
                            key: requestKey,
                            generation: generationRef.current,
                            url: typeof window === "undefined" ? "" : window.location.href,
                          };
                          setMutationError(null);
                          setConfirmId(t.id);
                        }}
                        disabled={busy || loading || reordering || !!loadError}
                        aria-label="Delete task"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmId}
        onOpenChange={(v) => {
          if (!v && !mutationOperationRef.current) setConfirmId(null);
        }}
        title={`Delete “${tasks.find((task) => task.id === confirmId)?.title ?? "this task"}”?`}
        message="This removes the task from this project. This can't be undone."
        error={mutationError}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const origin = deleteInvokerRef.current;
          deleteInvokerRef.current = null;
          if (
            !origin ||
            !mountedRef.current ||
            origin.key !== currentRequestKeyRef.current ||
            origin.generation !== generationRef.current ||
            (typeof window !== "undefined" && origin.url !== window.location.href)
          )
            return;
          if (origin.target?.isConnected && !origin.target.disabled) origin.target.focus();
          else taskRegionRef.current?.focus();
        }}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ===================== MEMORY =====================
function MemoryTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { isSignedIn, user } = useUser();
  const scopeKey = isSignedIn && user?.id ? `${user.id}:${projectId}` : null;
  const scope = useMemo(() => ({ key: scopeKey, active: false }), [scopeKey]);
  const currentScopeRef = useRef(scope);
  currentScopeRef.current = scope;
  const isCurrent = useCallback(
    () => scope.active && scope.key !== null && currentScopeRef.current === scope,
    [scope],
  );
  const fnList = useServerFn(listMemory);
  const fnAdd = useServerFn(addMemory);
  const fnDelete = useServerFn(deleteMemory);
  const [stateScope, setStateScope] = useState(scopeKey);
  const [items, setItems] = useState<ProjectMemoryItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState<"add" | "delete" | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const listRequestRef = useRef<symbol | null>(null);
  const mutationRef = useRef<symbol | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const summaryRef = useRef<HTMLParagraphElement | null>(null);
  const deleteErrorRef = useRef<HTMLDivElement | null>(null);
  const sameScope = stateScope === scopeKey;

  useEffect(() => {
    scope.active = true;
    setStateScope(scope.key);
    setItems([]);
    setHasLoaded(false);
    setLoading(true);
    setLoadError(null);
    setContent("");
    setBusy(null);
    setAddError(null);
    setDeleteError(null);
    setConfirmId(null);
    listRequestRef.current = null;
    mutationRef.current = null;
    deleteTriggerRef.current = null;
    return () => {
      scope.active = false;
      listRequestRef.current = null;
      mutationRef.current = null;
    };
  }, [scope]);

  const refresh = useCallback(async () => {
    if (!isCurrent() || listRequestRef.current || mutationRef.current) return;
    const operation = Symbol();
    listRequestRef.current = operation;
    setLoading(true);
    try {
      const rows = await fnList({ data: { project_id: projectId } });
      if (!isCurrent() || listRequestRef.current !== operation) return;
      setItems(rows);
      setHasLoaded(true);
      setLoadError(null);
    } catch {
      if (!isCurrent() || listRequestRef.current !== operation) return;
      setLoadError("Please try loading project memories again.");
    } finally {
      if (isCurrent() && listRequestRef.current === operation) {
        listRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [projectId, fnList, isCurrent]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (deleteError && isCurrent()) deleteErrorRef.current?.focus();
  }, [deleteError, isCurrent]);

  async function handleAdd() {
    if (
      !isCurrent() ||
      !sameScope ||
      !hasLoaded ||
      !canEdit ||
      !content.trim() ||
      listRequestRef.current ||
      mutationRef.current
    )
      return;
    const submittedDraft = content;
    const operation = Symbol();
    mutationRef.current = operation;
    summaryRef.current?.focus();
    setBusy("add");
    try {
      const row = await fnAdd({ data: { project_id: projectId, content: submittedDraft.trim() } });
      if (!isCurrent() || mutationRef.current !== operation) return;
      setItems((previous) => [row, ...previous.filter((item) => item.id !== row.id)]);
      setContent((previous) => (previous === submittedDraft ? "" : previous));
      setAddError(null);
    } catch {
      if (!isCurrent() || mutationRef.current !== operation) return;
      setAddError("Refresh project memories before trying again.");
    } finally {
      if (isCurrent() && mutationRef.current === operation) {
        mutationRef.current = null;
        setBusy(null);
      }
    }
  }

  async function handleDelete() {
    if (!isCurrent() || !canEdit || !confirmId || listRequestRef.current || mutationRef.current)
      return;
    const id = confirmId;
    const operation = Symbol();
    mutationRef.current = operation;
    setBusy("delete");
    try {
      await fnDelete({ data: { id } });
      if (!isCurrent() || mutationRef.current !== operation) return;
      setItems((previous) => previous.filter((item) => item.id !== id));
      setDeleteError(null);
      setConfirmId(null);
    } catch {
      if (!isCurrent() || mutationRef.current !== operation) return;
      setDeleteError("Please retry removal or cancel to keep reviewing project memories.");
    } finally {
      if (isCurrent() && mutationRef.current === operation) {
        mutationRef.current = null;
        setBusy(null);
      }
    }
  }

  function closeDelete() {
    if (!isCurrent() || mutationRef.current) return;
    setConfirmId(null);
    setDeleteError(null);
  }

  return (
    <div aria-busy={loading || !!busy || undefined}>
      <p ref={summaryRef} tabIndex={-1} className="text-sm text-muted-foreground mb-3">
        Persistent facts and preferences the team wants remembered in this project.
      </p>
      {canEdit && (
        <div className="border rounded-xl p-3 mb-4 flex flex-col sm:flex-row gap-2">
          <Input
            value={sameScope ? content : ""}
            onChange={(e) => setContent(e.target.value)}
            aria-label="New project memory"
            placeholder="e.g. Our brand voice is warm and concise."
            maxLength={2000}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void handleAdd();
            }}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!sameScope || loading || !hasLoaded || !!busy || !content.trim()}
            aria-busy={busy === "add" || undefined}
          >
            {busy === "add" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add
              </>
            )}
          </Button>
        </div>
      )}
      {sameScope && addError && (
        <div role="alert" className="mb-3 rounded-xl border border-destructive/40 p-3 text-sm">
          <p>
            Could not confirm that this memory was added. Your draft is kept. Check the list before
            trying again.
          </p>
          <p className="text-muted-foreground">{addError}</p>
          <Button
            type="button"
            variant="outline"
            disabled={loading || !!busy}
            onClick={() => {
              if (!isCurrent()) return;
              // This summary survives loading and success, unlike the Retry button.
              summaryRef.current?.focus();
              void refresh();
            }}
          >
            Refresh memories
          </Button>
        </div>
      )}
      {sameScope && loadError && (
        <div role="alert" className="mb-3 rounded-xl border border-destructive/40 p-3 text-sm">
          <p>
            Memories could not be loaded.
            {hasLoaded ? " Previously loaded memories are still shown." : ""}
          </p>
          <p className="text-muted-foreground">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            disabled={loading || !!busy}
            onClick={() => {
              if (!isCurrent()) return;
              // This summary survives loading and success, unlike the Retry button.
              summaryRef.current?.focus();
              void refresh();
            }}
          >
            {loading ? "Retrying…" : "Retry loading memories"}
          </Button>
        </div>
      )}
      {(!sameScope || loading) && (
        <div role="status" className="text-muted-foreground text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading memories…
        </div>
      )}
      {sameScope && hasLoaded && items.length === 0 && !loading && !loadError && !addError ? (
        <EmptyState
          icon={<Brain className="w-10 h-10" />}
          title="No memories yet"
          hint={canEdit ? "Add facts the team wants persisted." : "Nothing here yet."}
        />
      ) : sameScope && items.length > 0 ? (
        <div className="border rounded-xl divide-y">
          {items.map((m) => (
            <div key={m.id} className="p-3 flex items-start gap-2">
              <div className="flex-1 text-sm">{m.content}</div>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={loading || !!busy}
                  onClick={(event) => {
                    if (!isCurrent() || listRequestRef.current || mutationRef.current) return;
                    deleteTriggerRef.current = event.currentTarget;
                    setDeleteError(null);
                    setConfirmId(m.id);
                  }}
                  aria-label="Delete memory"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      <Dialog
        open={sameScope && !!confirmId}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!isCurrent()) return;
            if (deleteTriggerRef.current?.isConnected) deleteTriggerRef.current.focus();
            else summaryRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Remove this memory?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The team will no longer see this note in project memory.
          </p>
          {deleteError && (
            <div
              ref={deleteErrorRef}
              role="alert"
              tabIndex={-1}
              className="text-sm text-destructive"
            >
              <p>Could not confirm removal. The memory is still shown; retry or cancel.</p>
              <p>{deleteError}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDelete} disabled={!!busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!!busy || loading}
              aria-busy={busy === "delete" || undefined}
              onClick={() => void handleDelete()}
            >
              {busy === "delete" ? "Removing…" : deleteError ? "Retry removal" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===================== SEARCH =====================
function SearchDialog({
  projectId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  onNavigate,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  onNavigate: (kind: SearchResult["kind"]) => void;
}) {
  const fn = useServerFn(searchProject);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await fn({ data: { project_id: projectId, q: q.trim() } }));
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, projectId, fn]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Search this project</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Search chats, notes, tasks, files, memory…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-80 overflow-auto -mx-1">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching…
            </div>
          ) : q.trim().length < 2 ? (
            <div className="p-4 text-sm text-muted-foreground">Type at least 2 characters.</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No matches.</div>
          ) : (
            <ul className="divide-y">
              {results.map((r) => (
                <li key={`${r.kind}:${r.id}`}>
                  <button
                    className="min-h-11 w-full text-left px-3 py-2 hover:bg-accent transition"
                    onClick={() => onNavigate(r.kind)}
                  >
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      {r.kind}
                    </div>
                    <div className="font-medium truncate">{r.title}</div>
                    {r.snippet && (
                      <div className="text-xs text-muted-foreground truncate">{r.snippet}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===================== MEMBERS =====================
function MembersTab({
  members,
  invites,
  isOwner,
  onInvite,
  onRevoke,
  onRemove,
  onChangeRole,
}: {
  members: ProjectMember[];
  invites: ProjectInvite[];
  isOwner: boolean;
  onInvite: (email: string, role: "editor" | "viewer") => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  onChangeRole: (userId: string, role: "editor" | "viewer") => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const pending = invites.filter((i) => i.status === "pending");

  async function handleInvite() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await onInvite(email.trim(), role);
      setEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {isOwner && (
        <div className="border rounded-xl p-4">
          <label
            htmlFor="project-invite-email"
            className="text-sm font-medium mb-2 flex items-center gap-1.5"
          >
            <Mail className="w-4 h-4" />
            Invite by email
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="project-invite-email"
              type="email"
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Select value={role} onValueChange={(v) => setRole(v as "editor" | "viewer")}>
              <SelectTrigger aria-label="Invite role" className="w-full sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleInvite}
              disabled={busy || !email.trim()}
              aria-label="Invite"
              aria-busy={busy}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Invite
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <div>
        <div className="text-sm font-medium mb-2">Members</div>
        <div className="border rounded-xl divide-y">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-1.5">
                  {m.role === "owner" && <Crown className="w-3.5 h-3.5 text-amber-500" />}
                  {m.email ?? m.user_id.slice(0, 8)}
                </div>
                <div className="text-xs text-muted-foreground capitalize">{m.role}</div>
              </div>
              {isOwner && m.role !== "owner" && (
                <div className="flex items-center gap-2">
                  <Select
                    value={m.role}
                    onValueChange={(v) => onChangeRole(m.user_id, v as "editor" | "viewer")}
                  >
                    <SelectTrigger
                      aria-label={`Role for ${m.email ?? m.user_id.slice(0, 8)}`}
                      className="w-28"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemove(m.user_id)}
                    aria-label={`Remove ${m.email ?? m.user_id.slice(0, 8)} from project`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {pending.length > 0 && isOwner && (
        <div>
          <div className="text-sm font-medium mb-2">Pending invites</div>
          <div className="border rounded-xl divide-y">
            {pending.map((i) => (
              <div key={i.id} className="flex items-center justify-between p-3">
                <div>
                  <div className="font-medium">{i.email}</div>
                  <div className="text-xs text-muted-foreground capitalize">{i.role} · pending</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRevoke(i.id)}
                  aria-label={`Revoke invitation for ${i.email}`}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== SETTINGS =====================
function SettingsTab({
  project,
  onSave,
  onDelete,
}: {
  project: ProjectDetail;
  onSave: (patch: {
    name?: string;
    description?: string | null;
    system_prompt?: string | null;
  }) => Promise<void>;
  onDelete: (trigger?: HTMLElement) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(project.system_prompt ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-6">
      <div className="border rounded-xl p-4 space-y-3">
        <div>
          <label className="text-sm font-medium mb-1 block">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={1000}
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Custom instructions</label>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder="Persistent instructions added to every chat in this project (e.g. brand voice, product details)."
          />
        </div>
        <div>
          <Button
            disabled={saving || !name.trim()}
            onClick={async () => {
              if (saving || !name.trim()) return;
              setSaving(true);
              try {
                await onSave({
                  name: name.trim(),
                  description: description.trim() || null,
                  system_prompt: systemPrompt.trim() || null,
                });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save changes
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="border border-destructive/40 rounded-xl p-4">
        <div className="text-sm font-medium text-destructive mb-1">Danger zone</div>
        <p className="text-xs text-muted-foreground mb-3">
          Deleting a project removes it for every member and permanently deletes its stored file
          copies, chats, tasks, notes, memberships, and saved Results (including their versions and
          comments). Interrupted cleanup stays retryable.
        </p>
        <Button variant="destructive" size="sm" onClick={(event) => onDelete(event.currentTarget)}>
          <Trash2 className="w-4 h-4" />
          Delete project
        </Button>
      </div>
    </div>
  );
}

// ===================== SHARED HELPERS =====================
function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="kova-project-empty-state">
      <div className="kova-project-empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{hint}</p>
    </div>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  error,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  error?: string | null;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (open && error) errorRef.current?.focus();
  }, [open, error]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        {error && (
          <p ref={errorRef} role="alert" tabIndex={-1} className="text-sm text-destructive">
            {error} You can retry or cancel.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>{confirmLabel}…</span>
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
