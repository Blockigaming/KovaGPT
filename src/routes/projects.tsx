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
  DialogFooter,
} from "@/components/ui/dialog";
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
  Plus,
  Users,
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
import { SkeletonGrid, EmptyState, ErrorState } from "@/components/states";
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
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "created" | "members">("recent");
  const [view, setView] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    return localStorage.getItem("kova-projects-view") === "list" ? "list" : "grid";
  });
  const [showArchived, setShowArchived] = useState(false);
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null);
  const [deletingProjectIds, setDeletingProjectIds] = useState<Set<string>>(() => new Set());
  const [resolvedUserKey, setResolvedUserKey] = useState<string | null>(null);
  const currentUserKeyRef = useRef(userKey);
  const refreshSequenceRef = useRef(0);
  currentUserKeyRef.current = userKey;

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("kova-projects-view", view);
  }, [view]);

  const colorClass = (c?: string | null) => {
    const map: Record<string, string> = {
      blue: "text-blue-500 bg-blue-500/10",
      green: "text-emerald-500 bg-emerald-500/10",
      red: "text-red-500 bg-red-500/10",
      orange: "text-orange-500 bg-orange-500/10",
      yellow: "text-amber-500 bg-amber-500/10",
      purple: "text-violet-500 bg-violet-500/10",
      pink: "text-pink-500 bg-pink-500/10",
      teal: "text-teal-500 bg-teal-500/10",
    };
    return map[c ?? "blue"] ?? map.blue;
  };

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
    setRenameFor(p);
    setRenameName(p.name);
    setRenameDesc(p.description ?? "");
  }
  async function saveRename() {
    if (!renameFor || !renameName.trim()) return;
    const operationUserKey = userKey;
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
      if (currentUserKeyRef.current !== operationUserKey) return;
      setRenameFor(null);
      toast.success("Project updated");
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(e instanceof Error ? e.message : "Failed to update");
      void refresh();
    } finally {
      if (currentUserKeyRef.current === operationUserKey) setRenameBusy(false);
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
    if (!isLoaded) return;

    refreshSequenceRef.current += 1;
    setProjects([]);
    setInvites([]);
    setLoadError(null);
    setQuery("");
    setShowArchived(false);
    setDropProjectId(null);
    setCreateOpen(false);
    setTemplatesOpen(false);
    setName("");
    setDescription("");
    setBusy(false);
    setAiBusy(false);
    setRenameFor(null);
    setRenameName("");
    setRenameDesc("");
    setRenameBusy(false);
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
    if (!name.trim()) return;
    const operationUserKey = userKey;
    setBusy(true);
    try {
      const { id } = await fnCreate({
        data: { name: name.trim(), description: description.trim() || null },
      });
      if (currentUserKeyRef.current !== operationUserKey) return;
      setCreateOpen(false);
      setName("");
      setDescription("");
      // Optimistically prepend so the list is fresh if the user navigates back.
      setProjects((prev) => [
        {
          id,
          name: name.trim(),
          description: description.trim() || null,
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
        ...prev.filter((p) => p.id !== id),
      ]);
      toast.success("Project created");
      // Fire-and-forget authoritative refresh; navigation happens immediately.
      void refresh();
      await navigate({ to: "/projects/$projectId", params: { projectId: id } });
    } catch (e) {
      if (currentUserKeyRef.current !== operationUserKey) return;
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      if (currentUserKeyRef.current === operationUserKey) setBusy(false);
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
    <AppShell>
      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="projects-title"
        aria-busy={isLoading || undefined}
        className="kova-page kova-secondary-page pb-24 lg:pb-8"
      >
        <WorkspacePageHeader
          icon={FolderKanban}
          title="Projects"
          titleId="projects-title"
          description="Shared workspaces for your chats, files, instructions, and team."
          actions={
            isSignedIn && !isLoading ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setTemplatesOpen(true)}
                >
                  Templates
                </Button>
                <Button
                  onClick={() => setCreateOpen(true)}
                  className="hidden min-h-11 lg:inline-flex"
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

        {isLoading ? (
          <section role="status" aria-labelledby="projects-loading-title" className="space-y-6">
            <h2 id="projects-loading-title" className="sr-only">
              Loading projects
            </h2>
            <SkeletonGrid count={6} minWidth={240} />
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
              Create shared workspaces, invite teammates, and collaborate on chats.
            </p>
            <SignInButton mode="modal">
              <Button className="min-h-11">Sign in</Button>
            </SignInButton>
          </section>
        ) : loadError ? (
          <ErrorState
            title="Couldn't load your projects"
            description="Your projects are temporarily unavailable. Try again in a moment."
            onRetry={refresh}
          />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project to collaborate on chats, files, notes, and tasks with your team."
            tip="Create one project for each long-running goal or team workspace."
            action={
              <Button className="min-h-11" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" />
                Create project
              </Button>
            }
          />
        ) : (
          (() => {
            const q = query.trim().toLowerCase();
            const matches = (p: ProjectSummary) =>
              !q ||
              p.name.toLowerCase().includes(q) ||
              (p.description ?? "").toLowerCase().includes(q) ||
              (p.instructions_preview ?? "").toLowerCase().includes(q);
            const sortFn = (a: ProjectSummary, b: ProjectSummary) => {
              if (sortBy === "name") return a.name.localeCompare(b.name);
              if (sortBy === "members") return b.member_count - a.member_count;
              if (sortBy === "created")
                return (
                  new Date(b.created_at ?? b.updated_at).getTime() -
                  new Date(a.created_at ?? a.updated_at).getTime()
                );
              return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
            };
            const pinned = projects
              .filter((p) => p.pinned_at && !p.archived_at && matches(p))
              .sort(sortFn);
            const active = projects
              .filter((p) => !p.pinned_at && !p.archived_at && matches(p))
              .sort(sortFn);
            const archived = projects.filter((p) => p.archived_at && matches(p)).sort(sortFn);
            const noMatches = q && pinned.length + active.length + archived.length === 0;

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
                  try {
                    await fnMoveChat({ data: { chat_id: chatId, project_id: p.id } });
                    setProjects((current) =>
                      current.map((item) =>
                        item.id === p.id
                          ? {
                              ...item,
                              chat_count: (item.chat_count ?? 0) + 1,
                              updated_at: new Date().toISOString(),
                            }
                          : item,
                      ),
                    );
                    toast.success(`Chat moved to ${p.name}`);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not move chat");
                  }
                }}
                className={`${dropProjectId === p.id ? "ring-2 ring-primary bg-primary/5" : ""} ${
                  p.deletion_requested_at ? "border-destructive/40" : ""
                } ${
                  view === "list"
                    ? "relative kova-row items-center gap-3 group"
                    : "relative kova-card block p-4 group"
                }`}
              >
                <Link to="/projects/$projectId" params={{ projectId: p.id }} className="block">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClass(p.color)}`}
                      >
                        <FolderKanban className="w-5 h-5" />
                      </div>
                      {p.pinned_at && (
                        <Pin className="w-3.5 h-3.5 text-muted-foreground fill-current" />
                      )}
                    </div>
                    <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {p.role}
                    </span>
                  </div>
                  <div className="font-semibold truncate pr-8">{p.name}</div>
                  {(p.deletion_requested_at || deletingProjectIds.has(p.id)) && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="mt-1 flex items-center gap-1.5 text-xs font-medium text-destructive"
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
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {p.description || p.instructions_preview}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-3">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {p.member_count} member{p.member_count === 1 ? "" : "s"}
                    </span>
                    <span>
                      {p.chat_count ?? 0} chat{(p.chat_count ?? 0) === 1 ? "" : "s"}
                    </span>
                    <span>
                      {p.file_count ?? 0} file{(p.file_count ?? 0) === 1 ? "" : "s"}
                    </span>
                    <span>Updated {new Date(p.updated_at).toLocaleDateString()}</span>
                  </div>
                </Link>
                <div className="absolute top-3 right-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
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
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {p.deletion_requested_at ? "Retry deletion" : "Delete"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );

            const Section = ({ title, items }: { title: string; items: ProjectSummary[] }) =>
              items.length === 0 ? null : (
                <section className="mb-6">
                  {title && (
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 px-1">
                      {title}
                    </div>
                  )}
                  <div className={view === "list" ? "kova-list" : "kova-grid"}>
                    {items.map((p) => (
                      <Card key={p.id} p={p} />
                    ))}
                  </div>
                </section>
              );

            return (
              <div>
                <div className="kova-toolbar">
                  <div className="relative flex-1">
                    <SearchIcon className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      value={query}
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
                  >
                    <option value="recent">Recent</option>
                    <option value="name">Name</option>
                    <option value="created">Created</option>
                    <option value="members">Members</option>
                  </select>
                  <div
                    className="flex rounded-[var(--kova-radius-input)] border border-border p-1"
                    role="group"
                    aria-label="Projects view"
                  >
                    <button
                      type="button"
                      className={`kova-icon-button min-h-11 ${view === "grid" ? "bg-[var(--surface-selected)]" : ""}`}
                      onClick={() => setView("grid")}
                      aria-label="Grid view"
                      aria-pressed={view === "grid"}
                    >
                      Grid
                    </button>
                    <button
                      type="button"
                      className={`kova-icon-button min-h-11 ${view === "list" ? "bg-[var(--surface-selected)]" : ""}`}
                      onClick={() => setView("list")}
                      aria-label="List view"
                      aria-pressed={view === "list"}
                    >
                      List
                    </button>
                  </div>
                </div>

                {noMatches ? (
                  <EmptyState
                    icon={SearchIcon}
                    title="No matches"
                    description={`Nothing matches "${query}". Try a different search.`}
                    action={
                      <Button className="min-h-11" variant="outline" onClick={() => setQuery("")}>
                        Clear search
                      </Button>
                    }
                  />
                ) : (
                  <>
                    <Section title="Pinned" items={pinned} />
                    <Section title={pinned.length ? "All projects" : ""} items={active} />
                    {archived.length > 0 && (
                      <section className="mb-6">
                        <button
                          type="button"
                          onClick={() => setShowArchived((v) => !v)}
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
                              view === "list" ? "kova-list opacity-80" : "kova-grid opacity-80"
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

      {/* Mobile floating new-project button */}
      {!isLoading && isSignedIn ? (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="lg:hidden fixed bottom-24 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center transition-colors"
          aria-label="New project"
        >
          <Plus className="w-6 h-6" />
        </button>
      ) : null}

      <Dialog open={!!renameFor} onOpenChange={(o) => !o && setRenameFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!renameBusy) saveRename();
            }}
            className="space-y-4"
          >
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description</label>
              <Textarea
                value={renameDesc}
                onChange={(e) => setRenameDesc(e.target.value)}
                rows={3}
                maxLength={1000}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenameFor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={renameBusy || !renameName.trim()}>
                {renameBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isSignedIn && userKey && (
        <ProjectTemplatesDialog
          key={userKey}
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          userId={userKey}
          onCopied={(projectId) => {
            setTemplatesOpen(false);
            void refresh();
            void navigate({ to: "/projects/$projectId", params: { projectId } });
          }}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && name.trim()) handleCreate();
            }}
            className="space-y-4"
          >
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Name</label>
                <button
                  type="button"
                  onClick={generateWithKova}
                  disabled={aiBusy}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-60"
                >
                  {aiBusy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Wand2 className="w-3 h-3" />
                  )}
                  Generate with Kova
                </button>
              </div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Marketing campaign"
                maxLength={100}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description (optional)</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this project about?"
                rows={3}
                maxLength={1000}
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Sparkles className="w-3 h-3" /> Suggestions
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setName(s.name);
                      setDescription(s.description);
                    }}
                    className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-accent transition"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
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
            ? `Cleanup for “${deletingProject.name}” did not finish. Retry the bounded stored-file cleanup, then permanently delete its chats, tasks, notes, and memberships.`
            : deletingProject
              ? `“${deletingProject.name}”, its stored file copies, chats, tasks, notes, and memberships will be permanently deleted.`
              : "This project and its stored file copies will be permanently deleted."
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
