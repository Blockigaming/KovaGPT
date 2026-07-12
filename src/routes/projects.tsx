import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { FolderKanban, Plus, Users, Check, X as XIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  listProjects,
  createProject,
  listMyPendingInvites,
  acceptInvite,
  declineInvite,
  type ProjectSummary,
  type PendingInvite,
} from "@/lib/projects.functions";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const fnList = useServerFn(listProjects);
  const fnInvites = useServerFn(listMyPendingInvites);
  const fnCreate = useServerFn(createProject);
  const fnAccept = useServerFn(acceptInvite);
  const fnDecline = useServerFn(declineInvite);

  async function refresh() {
    if (!isSignedIn) return;
    setLoading(true);
    try {
      const [p, i] = await Promise.all([fnList(), fnInvites()]);
      setProjects(p);
      setInvites(i);
    } catch (e) {
      console.error(e);
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
      toast.success("Project created");
      navigate({ to: "/projects/$projectId", params: { projectId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(false);
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
    return <AppShell><div className="p-8 text-muted-foreground">Loading…</div></AppShell>;
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
      <div className="max-w-5xl mx-auto p-6 md:p-8 w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-sm text-muted-foreground">Shared workspaces for you and your team.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" />New project</Button>
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
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed rounded-2xl">
            <FolderKanban className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <div className="text-lg font-medium mb-1">No projects yet</div>
            <p className="text-sm text-muted-foreground mb-4">Create a project to collaborate on chats with your team.</p>
            <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" />Create project</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }}
                className="block border rounded-xl p-4 hover:bg-accent transition group">
                <div className="flex items-start justify-between mb-2">
                  <FolderKanban className="w-6 h-6 text-primary" />
                  <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">{p.role}</span>
                </div>
                <div className="font-semibold truncate">{p.name}</div>
                {p.description && <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{p.description}</p>}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
                  <Users className="w-3.5 h-3.5" />{p.member_count} member{p.member_count === 1 ? "" : "s"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing campaign" maxLength={100} autoFocus />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description (optional)</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this project about?" rows={3} maxLength={1000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
