import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useServerFn } from "@tanstack/react-start";
import { FolderKanban, Plus, Users, Check, X as XIcon, Loader2, Sparkles, Wand2, MoreHorizontal, Pin, PinOff, Copy as CopyIcon, Archive, ArchiveRestore, Pencil, Trash2, Search as SearchIcon, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
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
import { setProjectArchived } from "@/lib/project-workspace.functions";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
  head: () => ({
    meta: [
      { title: "Projects | KovaGPT" },
      { name: "description", content: "Shared collaboration workspaces in KovaGPT." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ProjectsPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "members">("recent");
  const [showArchived, setShowArchived] = useState(false);

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

  const [renameFor, setRenameFor] = useState<ProjectSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDesc, setRenameDesc] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  async function togglePin(p: ProjectSummary) {
    const next = !p.pinned_at;
    setProjects((prev) => prev.map((x) => x.id === p.id ? { ...x, pinned_at: next ? new Date().toISOString() : null } : x));
    try { await fnPin({ data: { id: p.id, pinned: next } }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed to pin"); void refresh(); }
  }
  async function toggleArchive(p: ProjectSummary) {
    const archive = !p.archived_at;
    setProjects((prev) => prev.map((x) => x.id === p.id ? { ...x, archived_at: archive ? new Date().toISOString() : null } : x));
    try {
      await fnArchive({ data: { id: p.id, archived: archive } });
      toast.success(archive ? "Project archived" : "Project restored");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); void refresh(); }
  }
  async function handleDuplicate(p: ProjectSummary) {
    try {
      const { id } = await fnDuplicate({ data: { id: p.id } });
      toast.success("Project duplicated");
      void refresh();
      await navigate({ to: "/projects/$projectId", params: { projectId: id } });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to duplicate"); }
  }
  async function handleDelete(p: ProjectSummary) {
    if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    const prev = projects;
    setProjects((cur) => cur.filter((x) => x.id !== p.id));
    try { await fnDelete({ data: { id: p.id } }); toast.success("Project deleted"); }
    catch (e) { setProjects(prev); toast.error(e instanceof Error ? e.message : "Failed to delete"); }
  }
  function openRename(p: ProjectSummary) {
    setRenameFor(p);
    setRenameName(p.name);
    setRenameDesc(p.description ?? "");
  }
  async function saveRename() {
    if (!renameFor || !renameName.trim()) return;
    setRenameBusy(true);
    const target = renameFor;
    const nextName = renameName.trim();
    const nextDesc = renameDesc.trim();
    setProjects((prev) => prev.map((x) => x.id === target.id ? { ...x, name: nextName, description: nextDesc || null } : x));
    try {
      await fnUpdate({ data: { id: target.id, name: nextName, description: nextDesc || null } });
      setRenameFor(null);
      toast.success("Project updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
      void refresh();
    } finally { setRenameBusy(false); }
  }

  async function refresh() {
    if (!isSignedIn) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [p, i] = await Promise.all([fnList(), fnInvites()]);
      setProjects(p);
      setInvites(i);
    } catch (e) {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : "Could not load your projects.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (isLoaded && isSignedIn) refresh(); /* eslint-disable-next-line */ }, [isLoaded, isSignedIn]);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { id } = await fnCreate({ data: { name: name.trim(), description: description.trim() || null } });
      setCreateOpen(false);
      setName(""); setDescription("");
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
          updated_at: new Date().toISOString(),
          pinned_at: null,
          archived_at: null,
        },
        ...prev.filter((p) => p.id !== id),
      ]);
      toast.success("Project created");
      // Fire-and-forget authoritative refresh; navigation happens immediately.
      void refresh();
      await navigate({ to: "/projects/$projectId", params: { projectId: id } });
    } catch (e) {
      console.error("[createProject]", e);
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  const suggestions: { name: string; description: string }[] = [
    { name: "Marketing Campaign", description: "Plan, draft, and coordinate launch content across channels." },
    { name: "Product Research", description: "User interviews, competitive notes, and opportunity briefs." },
    { name: "Content Calendar", description: "Track posts, deadlines, and drafts for the upcoming quarter." },
    { name: "Team Onboarding", description: "Docs, checklists, and resources for new hires." },
  ];
  const [aiBusy, setAiBusy] = useState(false);
  async function generateWithKova() {
    setAiBusy(true);
    try {
      const res = await fetch("/api/project-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hint: name || description || "" }),
      });
      if (!res.ok) throw new Error("Suggestion service unavailable");
      const data = (await res.json()) as { name?: string; description?: string };
      if (data.name) setName(data.name);
      if (data.description) setDescription(data.description);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate suggestion");
    } finally {
      setAiBusy(false);
    }
  }

  async function handleAccept(id: string) {
    try {
      const { project_id } = await fnAccept({ data: { invite_id: id } });
      toast.success("Joined project");
      navigate({ to: "/projects/$projectId", params: { projectId: project_id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }
  async function handleDecline(id: string) {
    try {
      await fnDecline({ data: { invite_id: id } });
      setInvites((prev) => prev.filter((i) => i.invite_id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  if (!isLoaded) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto p-6 md:p-8 w-full space-y-6">
          <div className="h-8 w-40 rounded bg-muted animate-pulse" />
          <SkeletonGrid count={6} minWidth={240} />
        </div>
      </AppShell>
    );
  }
  if (!isSignedIn) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto p-8 text-center">
          <FolderKanban className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-semibold mb-2">Sign in to use Projects</h1>
          <p className="text-muted-foreground mb-6">Create shared workspaces, invite teammates, and collaborate on chats.</p>
          <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-4 sm:p-6 md:p-8 w-full pb-24 lg:pb-8">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-sm text-muted-foreground">Shared workspaces for you and your team.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="hidden lg:inline-flex"><Plus className="w-4 h-4 mr-1.5" />New project</Button>
        </div>

        {invites.length > 0 && (
          <div className="mb-6 border rounded-xl p-4 bg-accent/30">
            <div className="text-sm font-medium mb-3">Pending invitations</div>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.invite_id} className="flex items-center justify-between gap-2 bg-background rounded-lg px-3 py-2">
                  <div>
                    <div className="font-medium">{inv.project_name}</div>
                    <div className="text-xs text-muted-foreground">Role: {inv.role}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleAccept(inv.invite_id)}><Check className="w-3.5 h-3.5 mr-1" />Accept</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDecline(inv.invite_id)}><XIcon className="w-3.5 h-3.5 mr-1" />Decline</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <SkeletonGrid count={6} minWidth={240} />
        ) : loadError ? (
          <ErrorState
            title="Couldn't load your projects"
            description={loadError}
            onRetry={refresh}
          />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project to collaborate on chats, files, notes, and tasks with your team."
            tip="Press N to start a new chat, or click New project to begin."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" />Create project
              </Button>
            }
          />
        ) : (
          (() => {
            const q = query.trim().toLowerCase();
            const matches = (p: ProjectSummary) =>
              !q || p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q);
            const sortFn = (a: ProjectSummary, b: ProjectSummary) => {
              if (sortBy === "name") return a.name.localeCompare(b.name);
              if (sortBy === "members") return b.member_count - a.member_count;
              return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
            };
            const pinned = projects.filter((p) => p.pinned_at && !p.archived_at && matches(p)).sort(sortFn);
            const active = projects.filter((p) => !p.pinned_at && !p.archived_at && matches(p)).sort(sortFn);
            const archived = projects.filter((p) => p.archived_at && matches(p)).sort(sortFn);
            const noMatches = q && pinned.length + active.length + archived.length === 0;

            const Card = ({ p }: { p: ProjectSummary }) => (
              <div className="relative block border rounded-xl p-4 hover:bg-accent/50 transition group">
                <Link to="/projects/$projectId" params={{ projectId: p.id }} className="block">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClass(p.color)}`}>
                        <FolderKanban className="w-5 h-5" />
                      </div>
                      {p.pinned_at && <Pin className="w-3.5 h-3.5 text-muted-foreground fill-current" />}
                    </div>
                    <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">{p.role}</span>
                  </div>
                  <div className="font-semibold truncate pr-8">{p.name}</div>
                  {p.description && <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{p.description}</p>}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
                    <Users className="w-3.5 h-3.5" />{p.member_count} member{p.member_count === 1 ? "" : "s"}
                  </div>
                </Link>
                <div className="absolute top-3 right-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-md hover:bg-background/70 opacity-70 hover:opacity-100 data-[state=open]:opacity-100 transition"
                        aria-label="Project options"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => togglePin(p)} disabled={p.role === "viewer"}>
                        {p.pinned_at ? <><PinOff className="w-4 h-4 mr-2" />Unpin</> : <><Pin className="w-4 h-4 mr-2" />Pin to top</>}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openRename(p)} disabled={p.role === "viewer"}>
                        <Pencil className="w-4 h-4 mr-2" />Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(p)}>
                        <CopyIcon className="w-4 h-4 mr-2" />Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleArchive(p)} disabled={p.role !== "owner"}>
                        {p.archived_at ? <><ArchiveRestore className="w-4 h-4 mr-2" />Restore</> : <><Archive className="w-4 h-4 mr-2" />Archive</>}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDelete(p)}
                        disabled={p.role !== "owner"}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );

            const Section = ({ title, items }: { title: string; items: ProjectSummary[] }) => (
              items.length === 0 ? null : (
                <section className="mb-6">
                  {title && <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 px-1">{title}</div>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((p) => <Card key={p.id} p={p} />)}
                  </div>
                </section>
              )
            );

            return (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="relative flex-1">
                    <SearchIcon className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search projects"
                      className="pl-9"
                    />
                  </div>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="h-9 px-3 rounded-md border border-input bg-background text-sm"
                    aria-label="Sort projects"
                  >
                    <option value="recent">Recent</option>
                    <option value="name">Name</option>
                    <option value="members">Members</option>
                  </select>
                </div>

                {noMatches ? (
                  <EmptyState
                    icon={SearchIcon}
                    title="No matches"
                    description={`Nothing matches "${query}". Try a different search.`}
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
                          className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground mb-2 px-1"
                        >
                          {showArchived ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          Archived ({archived.length})
                        </button>
                        {showArchived && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 opacity-80">
                            {archived.map((p) => <Card key={p.id} p={p} />)}
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
      </div>

      {/* Mobile floating new-project button */}
      <button
        onClick={() => setCreateOpen(true)}
        className="lg:hidden fixed bottom-24 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition"
        aria-label="New project"
      >
        <Plus className="w-6 h-6" />
      </button>


      <Dialog open={!!renameFor} onOpenChange={(o) => !o && setRenameFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename project</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!renameBusy) saveRename(); }} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} maxLength={100} autoFocus />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description</label>
              <Textarea value={renameDesc} onChange={(e) => setRenameDesc(e.target.value)} rows={3} maxLength={1000} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenameFor(null)}>Cancel</Button>
              <Button type="submit" disabled={renameBusy || !renameName.trim()}>
                {renameBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (!busy && name.trim()) handleCreate(); }}
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
                  {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  Generate with Kova
                </button>
              </div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing campaign" maxLength={100} autoFocus />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description (optional)</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this project about?" rows={3} maxLength={1000} />
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
                    onClick={() => { setName(s.name); setDescription(s.description); }}
                    className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-accent transition"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
