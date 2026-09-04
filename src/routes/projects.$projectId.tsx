import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
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
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getProject,
  updateProject,
  deleteProject,
  listMembers,
  removeMember,
  updateMemberRole,
  listInvites,
  inviteMember,
  revokeInvite,
  listProjectChats,
  createProjectChat,
  deleteProjectChat,
  type ProjectDetail,
  type ProjectMember,
  type ProjectInvite,
  type ProjectChatSummary,
} from "@/lib/projects.functions";
import {
  getProjectNote,
  saveProjectNote,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  reorderTasks,
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
  component: ProjectDetailPage,
  head: () => ({
    meta: [{ title: "KovaGPT Project" }, { name: "robots", content: "noindex" }],
  }),
});

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const { isSignedIn, isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const requestKey = userKey ? `${userKey}:${projectId}` : null;
  const navigate = useNavigate();

  const [project, setProject] = useState<(ProjectDetail & { archived_at?: string | null }) | null>(
    null,
  );
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [chats, setChats] = useState<ProjectChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvedRequestKey, setResolvedRequestKey] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [searchOpen, setSearchOpen] = useState(false);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const currentRequestKeyRef = useRef(requestKey);
  const requestSequenceRef = useRef(0);
  currentRequestKeyRef.current = requestKey;

  const fnGet = useServerFn(getProject);
  const fnUpdate = useServerFn(updateProject);
  const fnDelete = useServerFn(deleteProject);
  const fnArchive = useServerFn(setProjectArchived);
  const fnListMembers = useServerFn(listMembers);
  const fnListInvites = useServerFn(listInvites);
  const fnListChats = useServerFn(listProjectChats);

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
      setProject(p as never);
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
  }, [fnGet, fnListChats, fnListInvites, fnListMembers, isSignedIn, projectId, requestKey]);

  useEffect(() => {
    if (!isLoaded) return;

    requestSequenceRef.current += 1;
    setProject(null);
    setMembers([]);
    setInvites([]);
    setChats([]);
    setLoadError(null);
    setTab("overview");
    setSearchOpen(false);
    setDeletionBusy(false);

    if (!isSignedIn || !requestKey) {
      setResolvedRequestKey(null);
      setLoading(false);
      return;
    }

    setResolvedRequestKey(null);
    void refresh();
  }, [isLoaded, isSignedIn, refresh, requestKey]);

  const isLoading =
    !isLoaded ||
    Boolean(isSignedIn && (!requestKey || loading || resolvedRequestKey !== requestKey));

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

  const canEdit = project.role === "owner" || project.role === "editor";
  const isOwner = project.role === "owner";
  const archived = !!project.archived_at;

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
            All projects
          </Link>
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
                  className="min-h-11"
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
              <Button variant="outline" className="min-h-11" asChild>
                <Link to="/projects">Back to projects</Link>
              </Button>
            </div>
          </section>
        </main>
      </AppShell>
    );
  }

  async function toggleArchive() {
    const operationRequestKey = requestKey;
    await fnArchive({ data: { id: projectId, archived: !archived } });
    if (currentRequestKeyRef.current !== operationRequestKey) return;
    toast.success(archived ? "Project restored" : "Project archived");
    await refresh();
  }

  return (
    <AppShell>
      <main id="main-content" tabIndex={-1} className="max-w-6xl mx-auto p-4 md:p-8 w-full">
        <div className="flex items-center justify-between gap-2 mb-4">
          <Link
            to="/projects"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            All projects
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
              <Search className="w-4 h-4 mr-1.5" />
              Search
            </Button>
            {isOwner && (
              <Button variant="outline" size="sm" onClick={toggleArchive}>
                {archived ? (
                  <>
                    <ArchiveRestore className="w-4 h-4 mr-1.5" />
                    Restore
                  </>
                ) : (
                  <>
                    <Archive className="w-4 h-4 mr-1.5" />
                    Archive
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold truncate">{project.name}</h1>
              {archived && (
                <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-600">
                  Archived
                </span>
              )}
            </div>
            {project.description && (
              <p className="text-muted-foreground mt-1">{project.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="uppercase tracking-wider px-2 py-0.5 rounded bg-muted">
                {project.role}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {members.length} member{members.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList
            className="h-auto max-w-full flex-nowrap overflow-x-auto rounded-[var(--kova-radius-input)]"
            aria-label="Project workspace sections"
          >
            <TabsTrigger value="overview">
              <Activity className="w-4 h-4 mr-1.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="chats">
              <MessageCircle className="w-4 h-4 mr-1.5" />
              Chats
            </TabsTrigger>
            <TabsTrigger value="files">
              <FileText className="w-4 h-4 mr-1.5" />
              Files
            </TabsTrigger>
            <TabsTrigger value="images">
              <ImageIcon className="w-4 h-4 mr-1.5" />
              Images
            </TabsTrigger>
            <TabsTrigger value="instructions">
              <StickyNote className="w-4 h-4 mr-1.5" />
              Instructions
            </TabsTrigger>
            <TabsTrigger value="notes">
              <StickyNote className="w-4 h-4 mr-1.5" />
              Notes
            </TabsTrigger>
            <TabsTrigger value="tasks">
              <CheckSquare className="w-4 h-4 mr-1.5" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="memory">
              <Brain className="w-4 h-4 mr-1.5" />
              Memory
            </TabsTrigger>
            <TabsTrigger value="members">
              <Users className="w-4 h-4 mr-1.5" />
              Members
            </TabsTrigger>
            <TabsTrigger value="collaboration">
              <MessageCircle className="mr-1.5 h-4 w-4" /> Collaboration
            </TabsTrigger>
            {isOwner && (
              <TabsTrigger value="settings">
                <SettingsIcon className="w-4 h-4 mr-1.5" />
                Settings
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab projectId={projectId} onJump={(k) => setTab(k)} />
          </TabsContent>
          <TabsContent value="chats" className="mt-4">
            <ChatsTab projectId={projectId} chats={chats} canEdit={canEdit} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="files" className="mt-4">
            <FilesTab projectId={projectId} canEdit={canEdit} kind="file" />
          </TabsContent>
          <TabsContent value="images" className="mt-4">
            <FilesTab projectId={projectId} canEdit={canEdit} kind="image" />
          </TabsContent>
          <TabsContent value="instructions" className="mt-4">
            <ProjectInstructionsTab
              project={project}
              canEdit={canEdit}
              onSave={async (system_prompt) => {
                const operationRequestKey = requestKey;
                await fnUpdate({ data: { id: projectId, system_prompt } });
                if (currentRequestKeyRef.current !== operationRequestKey) return;
                setProject((prev) => (prev ? { ...prev, system_prompt } : prev));
              }}
            />
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
            <MembersTab
              members={members}
              invites={invites}
              isOwner={isOwner}
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
                await callServerFnDirect((await import("@/lib/projects.functions")).revokeInvite, {
                  data: { id },
                });
                await refresh();
              }}
              onRemove={async (userId) => {
                await callServerFnDirect((await import("@/lib/projects.functions")).removeMember, {
                  data: { project_id: projectId, user_id: userId },
                });
                await refresh();
              }}
              onChangeRole={async (userId, role) => {
                await callServerFnDirect(
                  (await import("@/lib/projects.functions")).updateMemberRole,
                  { data: { project_id: projectId, user_id: userId, role } },
                );
                await refresh();
              }}
            />
          </TabsContent>
          <TabsContent value="collaboration" className="mt-4">
            <ProjectCollaboration projectId={projectId} members={members} role={project.role} />
          </TabsContent>
          {isOwner && (
            <TabsContent value="settings" className="mt-4">
              <SettingsTab
                project={project}
                onSave={async (patch) => {
                  await fnUpdate({ data: { id: projectId, ...patch } });
                  await refresh();
                  toast.success("Saved");
                }}
                onDelete={async () => {
                  try {
                    await fnDelete({ data: { id: projectId } });
                    toast.success("Project deleted");
                    await navigate({ to: "/projects" });
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Deletion is incomplete. Try again.",
                    );
                  }
                }}
              />
            </TabsContent>
          )}
        </Tabs>
      </main>

      <SearchDialog
        projectId={projectId}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onNavigate={(kind) => {
          setSearchOpen(false);
          setTab(kind === "chat" ? "chats" : kind === "file" ? "files" : kind);
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
              className="text-xs text-muted-foreground hover:text-foreground"
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
function ChatsTab({
  projectId,
  chats,
  canEdit,
  onRefresh,
}: {
  projectId: string;
  chats: ProjectChatSummary[];
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const fnCreate = useServerFn(createProjectChat);
  const fnDelete = useServerFn(deleteProjectChat);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("New chat");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

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
  async function handleDelete(id: string) {
    await fnDelete({ data: { id } });
    setConfirmId(null);
    await onRefresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-muted-foreground">
          {chats.length} chat{chats.length === 1 ? "" : "s"}
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            New chat
          </Button>
        )}
      </div>
      {chats.length === 0 ? (
        <EmptyState
          icon={<MessageCircle className="w-10 h-10" />}
          title="No chats yet"
          hint="Chats you create here are visible to everyone in this project."
        />
      ) : (
        <div className="border rounded-xl divide-y">
          {chats.map((c) => (
            <div
              key={c.id}
              draggable={canEdit}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-kova-project-chat", c.id);
                event.dataTransfer.setData("text/plain", c.title);
              }}
              className="flex items-center justify-between p-3 hover:bg-accent/50 transition"
              title={canEdit ? "Drag this chat onto another project to move it" : undefined}
            >
              <Link
                to="/projects/$projectId/chat/$chatId"
                params={{ projectId, chatId: c.id }}
                className="flex-1 min-w-0"
              >
                <div className="font-medium truncate">{c.title}</div>
                <div className="text-xs text-muted-foreground">
                  Updated {new Date(c.updated_at).toLocaleString()}
                </div>
              </Link>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmId(c.id)}
                  aria-label="Delete chat"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

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

      <ConfirmDialog
        open={!!confirmId}
        onOpenChange={(v) => !v && setConfirmId(null)}
        title="Delete this chat?"
        message="This removes the chat for everyone in the project."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (confirmId) await handleDelete(confirmId);
        }}
      />
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
  const fnList = useServerFn(listFiles);
  const [items, setItems] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshedImageUrlsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    refreshedImageUrlsRef.current.clear();
    try {
      setItems(await fnList({ data: { project_id: projectId, kind } }));
    } catch {
      setLoadError(
        "Files could not be loaded because earlier storage cleanup is incomplete. Retry shortly.",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, kind, fnList]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function projectFileRequest(input: RequestInit, search = ""): Promise<Response> {
    const { data, error } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token) throw new Error("Your session expired. Sign in again and retry.");
    const headers = new Headers(input.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(`/api/project-files${search}`, {
      ...input,
      headers,
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
    if (!files || files.length === 0 || !canEdit) return;
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
          if (!response.ok) throw new Error(await responseError(response));
          toast.success(`${file.name} uploaded`);
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : `${file.name} could not be uploaded`,
          );
        }
      }
      await refresh();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
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
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-muted-foreground">
          {items.length} {kind === "image" ? "image" : "file"}
          {items.length === 1 ? "" : "s"}
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
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1.5" />
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
          className={`mb-4 border-2 border-dashed rounded-xl p-4 text-center text-sm transition ${dragOver ? "border-primary bg-primary/5" : "border-border text-muted-foreground"}`}
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
          <p className="text-sm text-foreground">{loadError}</p>
          <Button className="mt-3 min-h-11" variant="outline" onClick={() => void refresh()}>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
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
        <div className="border rounded-xl divide-y">
          {items.map((f) => (
            <div key={f.id} className="flex items-center justify-between p-3 gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{f.name}</div>
                <div className="text-xs text-muted-foreground">
                  {humanBytes(f.size_bytes)} · {new Date(f.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
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
                    className="min-h-11 min-w-11"
                    aria-label={`Delete ${f.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
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

function ProjectInstructionsTab({
  project,
  canEdit,
  onSave,
}: {
  project: ProjectDetail;
  canEdit: boolean;
  onSave: (systemPrompt: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(project.system_prompt ?? "");
  const [lastSaved, setLastSaved] = useState(project.system_prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    setDraft(project.system_prompt ?? "");
    setLastSaved(project.system_prompt ?? "");
    initialized.current = true;
  }, [project.id, project.system_prompt]);

  useEffect(() => {
    if (!initialized.current || !canEdit || draft === lastSaved) return;
    const handle = setTimeout(async () => {
      setSaving(true);
      setError(null);
      try {
        const next = draft.trim() || null;
        await onSave(next);
        setLastSaved(draft);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Instructions were not saved.");
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => clearTimeout(handle);
  }, [canEdit, draft, lastSaved, onSave]);

  return (
    <section className="kova-card p-4" aria-labelledby="project-instructions-title">
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
            : saved
              ? "Saved"
              : error
                ? "Save failed"
                : draft !== lastSaved
                  ? "Unsaved changes"
                  : ""}
        </div>
      </div>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value.slice(0, 4000))}
        disabled={!canEdit}
        rows={8}
        maxLength={4000}
        aria-describedby="project-instructions-help project-instructions-error"
        placeholder={
          canEdit
            ? "Add brand voice, audience, constraints, or team preferences for project chats."
            : "No project instructions."
        }
        className="min-h-48 resize-y"
      />
      <div id="project-instructions-help" className="mt-2 text-xs text-muted-foreground">
        {draft.length}/4000 characters. Failed saves keep your unsaved text for retry.
      </div>
      {error ? (
        <div
          id="project-instructions-error"
          className="mt-3 rounded-[var(--kova-radius-input)] border border-[var(--border-destructive)] bg-destructive/10 p-3 text-sm text-destructive"
        >
          Your instructions could not be saved. Your draft is preserved.
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void onSave(draft.trim() || null)}
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
  const fnGet = useServerFn(getProjectNote);
  const fnSave = useServerFn(saveProjectNote);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    (async () => {
      const n = await fnGet({ data: { project_id: projectId } });
      setContent(n.content);
      initialized.current = true;
      setLoading(false);
    })();
  }, [projectId, fnGet]);

  useEffect(() => {
    if (!initialized.current || !canEdit) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fnSave({ data: { project_id: projectId, content } });
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 1500);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [content, canEdit, projectId, fnSave]);

  if (loading)
    return (
      <div className="text-muted-foreground text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading notes…
      </div>
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-muted-foreground">Shared notes for this project.</div>
        <div className="text-xs text-muted-foreground h-4">
          {saving ? (
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving…
            </span>
          ) : saved ? (
            "Saved"
          ) : (
            ""
          )}
        </div>
      </div>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={canEdit ? "Start writing shared notes for the team…" : "No notes yet."}
        rows={16}
        disabled={!canEdit}
        className="font-mono text-sm"
      />
    </div>
  );
}

// ===================== TASKS =====================
function TasksTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const fnList = useServerFn(listTasks);
  const fnCreate = useServerFn(createTask);
  const fnUpdate = useServerFn(updateTask);
  const fnDelete = useServerFn(deleteTask);
  const fnReorder = useServerFn(reorderTasks);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const dragId = useRef<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await fnList({ data: { project_id: projectId } }));
    } finally {
      setLoading(false);
    }
  }, [projectId, fnList]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAdd() {
    if (!title.trim() || !canEdit) return;
    setBusy(true);
    try {
      await fnCreate({
        data: { project_id: projectId, title: title.trim(), due_date: due || null },
      });
      setTitle("");
      setDue("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cycleStatus(t: ProjectTask) {
    if (!canEdit) return;
    const next = t.status === "todo" ? "doing" : t.status === "doing" ? "done" : "todo";
    await fnUpdate({ data: { id: t.id, status: next } });
    await refresh();
  }

  function onDragStart(id: string) {
    dragId.current = id;
  }
  async function onDrop(overId: string) {
    if (!canEdit || !dragId.current || dragId.current === overId) return;
    const from = tasks.findIndex((t) => t.id === dragId.current);
    const to = tasks.findIndex((t) => t.id === overId);
    if (from < 0 || to < 0) return;
    const next = tasks.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setTasks(next);
    dragId.current = null;
    await fnReorder({ data: { project_id: projectId, order: next.map((t) => t.id) } });
  }

  const grouped = useMemo(
    () => ({
      todo: tasks.filter((t) => t.status === "todo"),
      doing: tasks.filter((t) => t.status === "doing"),
      done: tasks.filter((t) => t.status === "done"),
    }),
    [tasks],
  );

  if (loading)
    return (
      <div className="text-muted-foreground text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading tasks…
      </div>
    );

  return (
    <div>
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
            <Button onClick={handleAdd} disabled={busy || !title.trim()}>
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-1.5" />
                  Add
                </>
              )}
            </Button>
          </div>
        </div>
      )}
      {tasks.length === 0 ? (
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
                {grouped[k].map((t) => (
                  <div
                    key={t.id}
                    draggable={canEdit}
                    onDragStart={() => onDragStart(t.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(t.id)}
                    className="flex items-center gap-2 p-3 group"
                  >
                    {canEdit && (
                      <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
                    )}
                    <button
                      onClick={() => cycleStatus(t)}
                      disabled={!canEdit}
                      aria-label="Cycle status"
                      className={`w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center ${t.status === "done" ? "bg-primary border-primary text-primary-foreground" : t.status === "doing" ? "border-amber-500" : "border-muted-foreground/40"}`}
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmId(t.id)}
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
        onOpenChange={(v) => !v && setConfirmId(null)}
        title="Delete this task?"
        message="This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!confirmId) return;
          await fnDelete({ data: { id: confirmId } });
          setConfirmId(null);
          await refresh();
        }}
      />
    </div>
  );
}

// ===================== MEMORY =====================
function MemoryTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const fnList = useServerFn(listMemory);
  const fnAdd = useServerFn(addMemory);
  const fnDelete = useServerFn(deleteMemory);
  const [items, setItems] = useState<ProjectMemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fnList({ data: { project_id: projectId } }));
    } finally {
      setLoading(false);
    }
  }, [projectId, fnList]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAdd() {
    if (!content.trim() || !canEdit) return;
    setBusy(true);
    try {
      await fnAdd({ data: { project_id: projectId, content: content.trim() } });
      setContent("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">
        Persistent facts and preferences the team wants remembered in this project.
      </p>
      {canEdit && (
        <div className="border rounded-xl p-3 mb-4 flex flex-col sm:flex-row gap-2">
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="e.g. Our brand voice is warm and concise."
            maxLength={2000}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={busy || !content.trim()}>
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1.5" />
                Add
              </>
            )}
          </Button>
        </div>
      )}
      {loading ? (
        <div className="text-muted-foreground text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Brain className="w-10 h-10" />}
          title="No memories yet"
          hint={canEdit ? "Add facts the team wants persisted." : "Nothing here yet."}
        />
      ) : (
        <div className="border rounded-xl divide-y">
          {items.map((m) => (
            <div key={m.id} className="p-3 flex items-start gap-2">
              <div className="flex-1 text-sm">{m.content}</div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmId(m.id)}
                  aria-label="Delete memory"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmId}
        onOpenChange={(v) => !v && setConfirmId(null)}
        title="Remove this memory?"
        message="The team will no longer see this note in project memory."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!confirmId) return;
          await fnDelete({ data: { id: confirmId } });
          setConfirmId(null);
          await refresh();
        }}
      />
    </div>
  );
}

// ===================== SEARCH =====================
function SearchDialog({
  projectId,
  open,
  onOpenChange,
  onNavigate,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
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
      <DialogContent className="max-w-lg">
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
                    className="w-full text-left px-3 py-2 hover:bg-accent transition"
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
          <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Mail className="w-4 h-4" />
            Invite by email
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Select value={role} onValueChange={(v) => setRole(v as "editor" | "viewer")}>
              <SelectTrigger className="w-full sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleInvite} disabled={busy || !email.trim()}>
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4 mr-1.5" />
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
                    <SelectTrigger className="w-28 h-8">
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
                    aria-label="Remove"
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
                <Button variant="ghost" size="sm" onClick={() => onRevoke(i.id)}>
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
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(project.system_prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
            disabled={saving}
            onClick={async () => {
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
                <Save className="w-4 h-4 mr-1.5" />
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
          copies, chats, tasks, notes, and memberships. Interrupted cleanup stays retryable.
        </p>
        <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 className="w-4 h-4 mr-1.5" />
          Delete project
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete “${project.name}”?`}
        message="This can't be undone. Stored file copies, chats, tasks, notes, and memberships will be removed. If cleanup is interrupted, this dialog stays available so you can retry."
        confirmLabel="Delete forever"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}

// ===================== SHARED HELPERS =====================
function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="text-center py-12 border-2 border-dashed rounded-2xl">
      <div className="mx-auto mb-3 text-muted-foreground flex justify-center">{icon}</div>
      <div className="font-medium mb-1">{title}</div>
      <p className="text-sm text-muted-foreground">{hint}</p>
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
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
