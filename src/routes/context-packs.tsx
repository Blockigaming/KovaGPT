import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Boxes, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { useUser } from "@/components/auth/ClerkSafe";
import { loadConversations } from "@/lib/chat-store";
import { listMyLibrary, type LibraryItem } from "@/lib/library.functions";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import {
  listPromptTemplates,
  listResearchTemplates,
  type PromptTemplate,
  type ResearchTemplate,
} from "@/lib/professional.functions";
import { loadWorkTasks } from "@/lib/work-store";
import type { WorkspaceHandoff } from "@/lib/workspace-handoffs";
import {
  createContextPack,
  deleteContextPack,
  listContextPacks,
  listMemoryCenter,
  type ContextPack,
  type MemoryRecord,
} from "@/lib/workspace.functions";
import { toast } from "sonner";
export const Route = createFileRoute("/context-packs")({
  component: ContextPacksPage,
  head: () => ({
    meta: [{ title: "Context Packs | KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});
type Candidate = {
  key: string;
  type: WorkspaceHandoff["type"];
  id: string;
  title: string;
  content: string;
};
function ContextPacksPage() {
  const { isLoaded, isSignedIn } = useUser();
  const navigate = useNavigate();
  const listPacks = useServerFn(listContextPacks),
    create = useServerFn(createContextPack),
    remove = useServerFn(deleteContextPack),
    getLibrary = useServerFn(listMyLibrary),
    getProjects = useServerFn(listProjects),
    getMemories = useServerFn(listMemoryCenter),
    getPrompts = useServerFn(listPromptTemplates),
    getResearch = useServerFn(listResearchTemplates);
  const [packs, setPacks] = useState<ContextPack[]>([]),
    [library, setLibrary] = useState<LibraryItem[]>([]),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [memories, setMemories] = useState<MemoryRecord[]>([]),
    [prompts, setPrompts] = useState<PromptTemplate[]>([]),
    [research, setResearch] = useState<ResearchTemplate[]>([]),
    [pending, setPending] = useState<WorkspaceHandoff[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [deletingPack, setDeletingPack] = useState<ContextPack | null>(null),
    [deletePending, setDeletePending] = useState(false);
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    try {
      const raw =
        sessionStorage.getItem("kova-context-candidates") ??
        localStorage.getItem("kova-context-candidates") ??
        localStorage.getItem("kova-context-candidate");
      if (raw) {
        const parsed = JSON.parse(raw) as WorkspaceHandoff | WorkspaceHandoff[];
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        setPending(candidates);
        setSelected(candidates.map((candidate) => `${candidate.type}:${candidate.id}`));
        sessionStorage.removeItem("kova-context-candidates");
        localStorage.removeItem("kova-context-candidates");
        localStorage.removeItem("kova-context-candidate");
      }
    } catch {
      sessionStorage.removeItem("kova-context-candidates");
      localStorage.removeItem("kova-context-candidates");
      localStorage.removeItem("kova-context-candidate");
    }
    Promise.all([
      listPacks({}),
      getLibrary({}),
      getProjects({}),
      getMemories({}),
      getPrompts({}),
      getResearch({}),
    ])
      .then(([p, l, pr, memory, promptItems, researchItems]) => {
        setPacks(p);
        setLibrary(l);
        setProjects(pr);
        setMemories(memory);
        setPrompts(promptItems);
        setResearch(researchItems);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Context could not be loaded"))
      .finally(() => setLoading(false));
  }, [
    isLoaded,
    isSignedIn,
    listPacks,
    getLibrary,
    getProjects,
    getMemories,
    getPrompts,
    getResearch,
  ]);
  const candidates = useMemo<Candidate[]>(
    () =>
      [
        ...loadConversations().map((c) => ({
          key: `chat:${c.id}`,
          type: "chat" as const,
          id: c.id,
          title: c.title,
          content: c.messages
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n")
            .slice(0, 12000),
        })),
        ...pending.map((candidate) => ({
          key: `${candidate.type}:${candidate.id}`,
          ...candidate,
          content: candidate.content.slice(0, 12000),
        })),
        ...library.map((item) => ({
          key: `library:${item.id}`,
          type: (item.item_type === "image"
            ? "image"
            : ["document", "code", "website_draft", "chat_artifact"].includes(item.item_type)
              ? "artifact"
              : item.item_type === "upload"
                ? "file"
                : "library") as Candidate["type"],
          id: item.id,
          title: item.title,
          content: (item.content_text ?? item.file_name ?? item.title).slice(0, 12000),
        })),
        ...memories.map((memory) => ({
          key: `memory:${memory.id}`,
          type: "memory" as const,
          id: memory.id,
          title: memory.title,
          content: memory.content.slice(0, 12000),
        })),
        ...projects.map((p) => ({
          key: `project:${p.id}`,
          type: "project" as const,
          id: p.id,
          title: p.name,
          content: [p.description, p.instructions_preview]
            .filter(Boolean)
            .join("\n")
            .slice(0, 12000),
        })),
        ...prompts.map((prompt) => ({
          key: `prompt:${prompt.id}`,
          type: "prompt" as const,
          id: prompt.id,
          title: prompt.name,
          content: prompt.body.slice(0, 12000),
        })),
        ...research.map((template) => ({
          key: `research:${template.id}`,
          type: "research" as const,
          id: template.id,
          title: template.name,
          content: template.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
        })),
        ...loadWorkTasks().map((task) => ({
          key: `work:${task.id}`,
          type: "work" as const,
          id: task.id,
          title: task.objective,
          content:
            `${task.context}\n${task.steps.map((step) => `- [${step.done ? "x" : " "}] ${step.text}`).join("\n")}`.slice(
              0,
              12000,
            ),
        })),
      ].filter((item) =>
        `${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [library, memories, pending, projects, prompts, query, research],
  );
  const submit = async () => {
    const items = candidates
      .filter((item) => selected.includes(item.key))
      .map(({ type, id, title, content }) => ({ type, id, title, content }));
    if (!name.trim() || !items.length) return;
    setCreating(true);
    try {
      const pack = await create({ data: { name, description, items } });
      setPacks((all) => [pack, ...all]);
      setName("");
      setDescription("");
      setSelected([]);
      toast.success("Context pack saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Context pack could not be saved");
    } finally {
      setCreating(false);
    }
  };
  const attachPack = (pack: ContextPack) => {
    sessionStorage.setItem("kova-active-context-pack", JSON.stringify(pack));
    toast.success("Context pack attached to a new chat");
    navigate({ to: "/" });
  };
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6">
        <header>
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            <h1 className="text-2xl font-semibold">Context Packs</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Save authorized chats, project details, files, and Library items as reusable context.
          </p>
        </header>
        {!isSignedIn && !loading ? (
          <div className="mt-6 rounded-2xl border p-8 text-center">
            Sign in to create reusable context packs.
          </div>
        ) : loading ? (
          <div className="mt-6 h-40 animate-pulse rounded-2xl bg-muted" />
        ) : error ? (
          <div role="alert" className="mt-6 rounded-xl border border-destructive/40 p-4">
            {error}
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
            <section className="rounded-2xl border p-4">
              <h2 className="font-semibold">Build a pack</h2>
              <div className="mt-3 grid gap-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  className="h-11 rounded-xl border bg-background px-3"
                  placeholder="Pack name"
                  aria-label="Pack name"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  className="min-h-20 rounded-xl border bg-background p-3"
                  placeholder="What is this context for?"
                  aria-label="Pack description"
                />
                <label className="relative">
                  <span className="sr-only">Search available context</span>
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-10 w-full rounded-xl border bg-background pl-9"
                    placeholder="Search chats, files, Library, projects"
                  />
                </label>
              </div>
              <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border">
                <ul className="divide-y">
                  {candidates.length ? (
                    candidates.map((item) => (
                      <li key={item.key}>
                        <label className="flex min-h-12 cursor-pointer items-center gap-3 p-3 hover:bg-accent">
                          <input
                            type="checkbox"
                            checked={selected.includes(item.key)}
                            onChange={() =>
                              setSelected((all) =>
                                all.includes(item.key)
                                  ? all.filter((key) => key !== item.key)
                                  : [...all, item.key],
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{item.title}</span>
                            <span className="text-xs capitalize text-muted-foreground">
                              {item.type}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))
                  ) : (
                    <li className="p-6 text-center text-sm text-muted-foreground">
                      No matching context found.
                    </li>
                  )}
                </ul>
              </div>
              <button
                disabled={creating || !name.trim() || !selected.length}
                onClick={submit}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-4 text-background disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {creating ? "Saving…" : "Save context pack"}
              </button>
            </section>
            <section>
              <h2 className="font-semibold">Saved packs</h2>
              {packs.length === 0 ? (
                <div className="mt-3 rounded-2xl border p-8 text-center text-sm text-muted-foreground">
                  Create your first pack from real workspace context.
                </div>
              ) : (
                <ul className="mt-3 space-y-3">
                  {packs.map((pack) => (
                    <li key={pack.id} className="rounded-2xl border bg-card/40 p-4">
                      <h3 className="font-medium">{pack.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {pack.description || `${pack.items.length} context items`}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => attachPack(pack)}
                          className="min-h-10 rounded-lg bg-foreground px-3 text-sm text-background"
                        >
                          Use in new chat
                        </button>
                        <button
                          onClick={() => {
                            localStorage.setItem(
                              "kova-work-draft",
                              JSON.stringify({
                                objective: `Work with ${pack.name}`,
                                context: pack.items
                                  .map((item) => `${item.title}: ${item.content}`)
                                  .join("\n\n"),
                                plan: [
                                  "Review the attached context",
                                  "Complete the objective",
                                  "Review and record deliverables",
                                ],
                              }),
                            );
                            navigate({ to: "/work" });
                          }}
                          className="min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
                        >
                          Use in Work
                        </button>
                        <button
                          onClick={() => {
                            localStorage.setItem(
                              "kova-research-draft",
                              JSON.stringify({
                                question: `Research with ${pack.name}`,
                                context: pack.items
                                  .map((item) => `${item.title}: ${item.content}`)
                                  .join("\n\n"),
                              }),
                            );
                            navigate({ to: "/research-planner" });
                          }}
                          className="min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
                        >
                          Use in Research
                        </button>
                        <button
                          aria-label={`Delete ${pack.name}`}
                          onClick={() => setDeletingPack(pack)}
                          className="grid min-h-10 min-w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
      <ConfirmActionDialog
        open={Boolean(deletingPack)}
        onOpenChange={(open) => !open && !deletePending && setDeletingPack(null)}
        title="Delete context pack?"
        description={`“${deletingPack?.name ?? "This context pack"}” will be permanently removed. Its source items are not deleted.`}
        confirmLabel={deletePending ? "Deleting…" : "Delete context pack"}
        destructive
        disabled={deletePending}
        onConfirm={async () => {
          if (!deletingPack || deletePending) return;
          setDeletePending(true);
          try {
            await remove({ data: { id: deletingPack.id } });
            setPacks((all) => all.filter((pack) => pack.id !== deletingPack.id));
            setDeletingPack(null);
            toast.success("Context pack deleted");
          } catch (cause) {
            toast.error(
              cause instanceof Error ? cause.message : "Context pack could not be deleted",
            );
          } finally {
            setDeletePending(false);
          }
        }}
      />
    </AppShell>
  );
}
