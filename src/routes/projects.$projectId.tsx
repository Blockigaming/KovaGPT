import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, Loader2, Users, Mail, Plus, Trash2, Send, MessageCircle, Settings as SettingsIcon, LogOut, Crown, Save,
} from "lucide-react";
import { toast } from "sonner";
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
  getProjectChat,
  saveProjectChat,
  deleteProjectChat,
  type ProjectDetail,
  type ProjectMember,
  type ProjectInvite,
  type ProjectChatSummary,
  type ProjectChatMessage,
} from "@/lib/projects.functions";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectDetailPage,
  head: () => ({
    meta: [
      { title: "Project | KovaGPT" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const { isSignedIn, isLoaded } = useUser();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [chats, setChats] = useState<ProjectChatSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fnGet = useServerFn(getProject);
  const fnUpdate = useServerFn(updateProject);
  const fnDelete = useServerFn(deleteProject);
  const fnListMembers = useServerFn(listMembers);
  const fnRemoveMember = useServerFn(removeMember);
  const fnUpdateRole = useServerFn(updateMemberRole);
  const fnListInvites = useServerFn(listInvites);
  const fnInvite = useServerFn(inviteMember);
  const fnRevoke = useServerFn(revokeInvite);
  const fnListChats = useServerFn(listProjectChats);
  const fnCreateChat = useServerFn(createProjectChat);
  const fnDeleteChat = useServerFn(deleteProjectChat);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m, i, c] = await Promise.all([
        fnGet({ data: { id: projectId } }),
        fnListMembers({ data: { project_id: projectId } }),
        fnListInvites({ data: { project_id: projectId } }),
        fnListChats({ data: { project_id: projectId } }),
      ]);
      setProject(p);
      setMembers(m);
      setInvites(i);
      setChats(c);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [projectId, fnGet, fnListMembers, fnListInvites, fnListChats]);

  useEffect(() => { if (isSignedIn) refresh(); }, [isSignedIn, refresh]);

  if (!isLoaded) return <AppShell><div className="p-8 text-muted-foreground">Loading…</div></AppShell>;
  if (!isSignedIn) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto p-8 text-center">
          <h1 className="text-2xl font-semibold mb-2">Sign in required</h1>
          <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
        </div>
      </AppShell>
    );
  }
  if (loading) {
    return <AppShell><div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading project…</div></AppShell>;
  }
  if (!project) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto p-8 text-center">
          <h1 className="text-xl font-semibold mb-2">Project not found</h1>
          <p className="text-muted-foreground mb-4">You may not have access, or it was deleted.</p>
          <Link to="/projects"><Button variant="outline"><ArrowLeft className="w-4 h-4 mr-1.5" />Back to Projects</Button></Link>
        </div>
      </AppShell>
    );
  }

  const canEdit = project.role === "owner" || project.role === "editor";
  const isOwner = project.role === "owner";

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-6 md:p-8 w-full">
        <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-4">
          <ArrowLeft className="w-4 h-4" />All projects
        </Link>
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            {project.description && <p className="text-muted-foreground mt-1">{project.description}</p>}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="uppercase tracking-wider px-2 py-0.5 rounded bg-muted">{project.role}</span>
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{members.length} member{members.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </div>

        <Tabs defaultValue="chats">
          <TabsList>
            <TabsTrigger value="chats"><MessageCircle className="w-4 h-4 mr-1.5" />Chats</TabsTrigger>
            <TabsTrigger value="members"><Users className="w-4 h-4 mr-1.5" />Members</TabsTrigger>
            {isOwner && <TabsTrigger value="settings"><SettingsIcon className="w-4 h-4 mr-1.5" />Settings</TabsTrigger>}
          </TabsList>

          <TabsContent value="chats" className="mt-4">
            <ChatsTab
              projectId={projectId}
              chats={chats}
              canEdit={canEdit}
              onCreate={async (title) => {
                const { id } = await fnCreateChat({ data: { project_id: projectId, title, messages: [] } });
                await refresh();
                navigate({ to: "/projects/$projectId/chat/$chatId", params: { projectId, chatId: id } });
              }}
              onDelete={async (id) => {
                await fnDeleteChat({ data: { id } });
                setChats((prev) => prev.filter((c) => c.id !== id));
              }}
            />
          </TabsContent>

          <TabsContent value="members" className="mt-4">
            <MembersTab
              members={members}
              invites={invites}
              currentUserId={project.owner_id}
              isOwner={isOwner}
              onInvite={async (email, role) => {
                const res = await fnInvite({ data: { project_id: projectId, email, role } });
                toast.success(res.auto_accepted ? "Member added" : "Invitation sent");
                await refresh();
              }}
              onRevoke={async (id) => { await fnRevoke({ data: { id } }); await refresh(); }}
              onRemove={async (userId) => { await fnRemoveMember({ data: { project_id: projectId, user_id: userId } }); await refresh(); }}
              onChangeRole={async (userId, role) => { await fnUpdateRole({ data: { project_id: projectId, user_id: userId, role } }); await refresh(); }}
              onLeave={async () => {
                await fnRemoveMember({ data: { project_id: projectId, user_id: (members.find(m => m.role !== "owner")?.user_id) ?? "" } }).catch(() => {});
                navigate({ to: "/projects" });
              }}
            />
          </TabsContent>

          {isOwner && (
            <TabsContent value="settings" className="mt-4">
              <SettingsTab
                project={project}
                onSave={async (patch) => { await fnUpdate({ data: { id: projectId, ...patch } }); await refresh(); toast.success("Saved"); }}
                onDelete={async () => {
                  await fnDelete({ data: { id: projectId } });
                  toast.success("Project deleted");
                  navigate({ to: "/projects" });
                }}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}

function ChatsTab({ projectId, chats, canEdit, onCreate, onDelete }: {
  projectId: string;
  chats: ProjectChatSummary[];
  canEdit: boolean;
  onCreate: (title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("New chat");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-muted-foreground">{chats.length} chat{chats.length === 1 ? "" : "s"}</div>
        {canEdit && <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1.5" />New chat</Button>}
      </div>
      {chats.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-2xl">
          <MessageCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <div className="font-medium mb-1">No chats yet</div>
          <p className="text-sm text-muted-foreground">Chats you create here are visible to everyone in this project.</p>
        </div>
      ) : (
        <div className="border rounded-xl divide-y">
          {chats.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-3 hover:bg-accent/50 transition">
              <Link to="/projects/$projectId/chat/$chatId" params={{ projectId, chatId: c.id }} className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.title}</div>
                <div className="text-xs text-muted-foreground">Updated {new Date(c.updated_at).toLocaleString()}</div>
              </Link>
              {canEdit && (
                <Button variant="ghost" size="icon" onClick={() => onDelete(c.id)} aria-label="Delete chat">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New chat</DialogTitle></DialogHeader>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button disabled={busy || !title.trim()} onClick={async () => {
              setBusy(true);
              try { await onCreate(title.trim()); setCreating(false); }
              catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
              finally { setBusy(false); }
            }}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MembersTab({ members, invites, isOwner, onInvite, onRevoke, onRemove, onChangeRole }: {
  members: ProjectMember[];
  invites: ProjectInvite[];
  currentUserId: string;
  isOwner: boolean;
  onInvite: (email: string, role: "editor" | "viewer") => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  onChangeRole: (userId: string, role: "editor" | "viewer") => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const pending = invites.filter((i) => i.status === "pending");

  async function handleInvite() {
    if (!email.trim()) return;
    setBusy(true);
    try { await onInvite(email.trim(), role); setEmail(""); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {isOwner && (
        <div className="border rounded-xl p-4">
          <div className="text-sm font-medium mb-2 flex items-center gap-1.5"><Mail className="w-4 h-4" />Invite by email</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input type="email" placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
            <Select value={role} onValueChange={(v) => setRole(v as "editor" | "viewer")}>
              <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleInvite} disabled={busy || !email.trim()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-1.5" />Invite</>}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            If they already have a KovaGPT account, they'll be added immediately. Otherwise the invite waits on their Projects page.
          </p>
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
                  <Select value={m.role} onValueChange={(v) => onChangeRole(m.user_id, v as "editor" | "viewer")}>
                    <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" onClick={() => onRemove(m.user_id)} aria-label="Remove"><Trash2 className="w-4 h-4" /></Button>
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
                <Button variant="ghost" size="sm" onClick={() => onRevoke(i.id)}>Revoke</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ project, onSave, onDelete }: {
  project: ProjectDetail;
  onSave: (patch: { name?: string; description?: string | null; system_prompt?: string | null }) => Promise<void>;
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
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Project instructions</label>
          <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={5} maxLength={4000}
            placeholder="Persistent context added to every chat in this project (e.g. brand voice, product details)." />
        </div>
        <div>
          <Button disabled={saving} onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                name: name.trim(),
                description: description.trim() || null,
                system_prompt: systemPrompt.trim() || null,
              });
            } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
            finally { setSaving(false); }
          }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-1.5" />Save changes</>}
          </Button>
        </div>
      </div>

      <div className="border border-destructive/40 rounded-xl p-4">
        <div className="text-sm font-medium text-destructive mb-1">Danger zone</div>
        <p className="text-xs text-muted-foreground mb-3">Deleting a project removes it for every member and permanently deletes all its chats.</p>
        <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}><Trash2 className="w-4 h-4 mr-1.5" />Delete project</Button>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete "{project.name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This can't be undone. All project chats and memberships will be removed.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => { setConfirming(false); await onDelete(); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
