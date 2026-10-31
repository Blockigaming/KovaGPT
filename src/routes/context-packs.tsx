import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Boxes, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { useUser } from "@/components/auth/ClerkSafe";
import { chatStoragePrincipal, loadConversations } from "@/lib/chat-store";
import { listMyLibrary, type LibraryItem } from "@/lib/library.functions";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import {
  listPromptTemplates,
  listResearchTemplates,
  type PromptTemplate,
  type ResearchTemplate,
} from "@/lib/professional.functions";
import { loadWorkTasks } from "@/lib/work-store";
import { useWorkStoreRevision } from "@/hooks/use-work-store-revision";
import {
  consumePrincipalHandoff,
  safeBrowserStorage,
  writePrincipalHandoff,
} from "@/lib/principal-browser-storage.mjs";
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
    meta: [{ title: "KovaGPT Context" }, { name: "robots", content: "noindex" }],
  }),
});
type Candidate = {
  key: string;
  type: WorkspaceHandoff["type"];
  id: string;
  title: string;
  content: string;
};
const MAX_SEARCH_HANDOFF_BYTES = 30 * 1024;
const MAX_SEARCH_QUERY_CHARS = 240;
function searchHandoffQuery(pack: ContextPack) {
  return [pack.name, pack.description, ...pack.items.map((item) => item.title)]
    .filter(Boolean)
    .join(" — ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_QUERY_CHARS);
}
function searchHandoffPrompt(pack: ContextPack) {
  const query = searchHandoffQuery(pack);
  const prompt = `Search query: ${query}\n\nSearch the web using this context pack, cite current sources, and distinguish sourced facts from the supplied context.\n\nContext pack: ${pack.name}\n${pack.items
    .map((item) => `${item.title}: ${item.content}`)
    .join("\n\n")}`;
  const encoder = new TextEncoder();
  if (encoder.encode(prompt).byteLength <= MAX_SEARCH_HANDOFF_BYTES) return prompt;
  const notice = "\n\n[Additional context was omitted to fit the chat message limit.]";
  const contentBudget = MAX_SEARCH_HANDOFF_BYTES - encoder.encode(notice).byteLength;
  let low = 0;
  let high = prompt.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (encoder.encode(prompt.slice(0, midpoint)).byteLength <= contentBudget) low = midpoint;
    else high = midpoint - 1;
  }
  return `${prompt.slice(0, low)}${notice}`;
}
function ContextPacksPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const workRevision = useWorkStoreRevision(userKey);
  const principal = isLoaded ? chatStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const generationRef = useRef(0);
  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );
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
    [selected, setSelected] = useState<string[]>([]);
  const draftRef = useRef({ name, description, selected });
  draftRef.current = { name, description, selected };
  const creatingRef = useRef(false);
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const savedListHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const completedDeleteRef = useRef<{
    principal: string;
    generation: number;
    url: string;
  } | null>(null);
  const deleteTriggerRef = useRef<{
    element: HTMLButtonElement;
    principal: string;
    generation: number;
    url: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    pack: ContextPack;
    principal: string;
    generation: number;
    url: string;
  } | null>(null);
  const restoreDeleteFocus = useCallback((closingDialog?: EventTarget | null) => {
    const trigger = deleteTriggerRef.current;
    if (
      !trigger ||
      trigger.principal !== principalRef.current ||
      trigger.generation !== generationRef.current ||
      trigger.url !== window.location.href
    )
      return;
    const active = document.activeElement;
    const heading = savedListHeadingRef.current;
    const focusRemainsInClosingDialog =
      closingDialog instanceof HTMLElement &&
      closingDialog.matches('[role="alertdialog"]') &&
      closingDialog.contains(active);
    if (
      active &&
      active !== document.body &&
      active !== trigger.element &&
      active !== heading &&
      !focusRemainsInClosingDialog
    )
      return;
    const target =
      trigger.element.isConnected && !trigger.element.disabled ? trigger.element : heading;
    restoreDialogFocus(target, trigger.url);
  }, []);

  const [dataPrincipal, setDataPrincipal] = useState<string | null>(null);
  const dataReady = principal !== null && dataPrincipal === principal;
  useEffect(() => {
    generationRef.current += 1;
    creatingRef.current = false;
    deletingRef.current = false;
    setDeleting(false);
    completedDeleteRef.current = null;
    setDeleteTarget(null);
    setCreating(false);
    setName("");
    setDescription("");
    setQuery("");
    if (!isLoaded || principal === null) {
      setDataPrincipal(null);
      setLoading(true);
      return;
    }
    setDataPrincipal(null);
    setPacks([]);
    setLibrary([]);
    setProjects([]);
    setMemories([]);
    setPrompts([]);
    setResearch([]);
    setPending([]);
    setSelected([]);
    setError(null);
    if (!isSignedIn) {
      setDataPrincipal(principal);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handoff = consumePrincipalHandoff<WorkspaceHandoff | WorkspaceHandoff[]>(
      safeBrowserStorage("sessionStorage"),
      "kova-context-candidates",
      userKey,
    );
    if (handoff.ok) {
      const candidates = Array.isArray(handoff.value) ? handoff.value : [handoff.value];
      setPending(candidates);
      setSelected(candidates.map((candidate) => `${candidate.type}:${candidate.id}`));
    } else if (handoff.reason !== "missing") {
      toast.error("Saved context candidates could not be attached.");
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
        if (cancelled) return;
        setPacks(p);
        setLibrary(l);
        setProjects(pr);
        setMemories(memory);
        setPrompts(promptItems);
        setResearch(researchItems);
        setDataPrincipal(principal);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Context could not be loaded");
        setDataPrincipal(principal);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isLoaded,
    isSignedIn,
    listPacks,
    getLibrary,
    getProjects,
    getMemories,
    getPrompts,
    getResearch,
    principal,
    userKey,
  ]);
  const candidates = useMemo<Candidate[]>(() => {
    void workRevision; // Invalidate the storage snapshot after a durable sync update.
    if (!dataReady) return [];
    return [
      ...loadConversations(userKey).map((c) => ({
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
        content: [p.description, p.instructions_preview].filter(Boolean).join("\n").slice(0, 12000),
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
      ...loadWorkTasks(userKey).map((task) => ({
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
    ].filter(
      (item, index, all) => all.findIndex((candidate) => candidate.key === item.key) === index,
    );
  }, [dataReady, library, memories, pending, projects, prompts, research, userKey, workRevision]);
  const visibleCandidates = candidates.filter((item) =>
    `${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase()),
  );
  const submit = async () => {
    if (creatingRef.current || !dataReady || !isSignedIn) return;
    const generation = generationRef.current;
    const submittedDraft = draftRef.current;
    const isCurrent = () =>
      generation === generationRef.current && principalRef.current === principal;
    const items = candidates
      .filter((item) => selected.includes(item.key))
      .map(({ type, id, title, content }) => ({ type, id, title, content }));
    if (!name.trim() || !items.length) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const pack = await create({ data: { name, description, items } });
      if (!isCurrent()) return;
      setPacks((all) => [pack, ...all]);
      if (JSON.stringify(draftRef.current) === JSON.stringify(submittedDraft)) {
        setName("");
        setDescription("");
        setSelected([]);
      }
      toast.success("Context pack saved");
    } catch (e) {
      if (isCurrent())
        toast.error(e instanceof Error ? e.message : "Context pack could not be saved");
    } finally {
      if (isCurrent()) {
        creatingRef.current = false;
        setCreating(false);
      }
    }
  };
  useLayoutEffect(() => {
    const completed = completedDeleteRef.current;
    if (!completed) return;
    completedDeleteRef.current = null;
    if (
      completed.principal === principalRef.current &&
      completed.generation === generationRef.current &&
      completed.url === window.location.href &&
      !deleteTriggerRef.current?.element.isConnected
    )
      restoreDeleteFocus();
  }, [packs, restoreDeleteFocus]);
  const confirmDelete = async () => {
    if (
      !deleteTarget ||
      !dataReady ||
      !isSignedIn ||
      deletingRef.current ||
      deleteTarget.generation !== generationRef.current ||
      deleteTarget.principal !== principalRef.current
    )
      return;
    const { pack, principal: deletePrincipal, generation, url } = deleteTarget;
    const isCurrent = () =>
      generation === generationRef.current && principalRef.current === deletePrincipal;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteTarget(null);
    try {
      await remove({ data: { id: pack.id } });
      if (!isCurrent()) return;
      completedDeleteRef.current = { principal: deletePrincipal, generation, url };
      setPacks((all) => all.filter((p) => p.id !== pack.id));
    } catch (e) {
      if (!isCurrent()) return;
      toast.error(e instanceof Error ? e.message : "Could not delete");
    } finally {
      if (isCurrent()) {
        deletingRef.current = false;
        setDeleting(false);
      }
    }
  };
  const attachPack = (pack: ContextPack) => {
    const handoff = writePrincipalHandoff(
      safeBrowserStorage("sessionStorage"),
      "kova-active-context-pack",
      isLoaded ? userKey : undefined,
      pack,
    );
    if (!handoff.ok) {
      toast.error("Context pack could not be prepared. Reload and try again.");
      return;
    }
    toast.success("Context pack attached to a new chat");
    navigate({ to: "/" });
  };
  return (
    <AppShell>
      <main
        data-ui-reference="claude.project.knowledge"
        className={"kova-tool-page " + "mx-auto min-w-0 w-full max-w-5xl px-4 py-7 sm:px-6"}
      >
        <header className="kova-tool-heading">
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
        ) : !dataReady || loading ? (
          <div className="mt-6 h-40 animate-pulse rounded-2xl bg-muted" />
        ) : error ? (
          <div role="alert" className="mt-6 rounded-xl border border-destructive/40 p-4">
            {error}
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
            <section className={"kova-tool-panel " + "min-w-0 rounded-2xl border p-4"}>
              <h2 className="font-semibold">Build a pack</h2>
              <div className="mt-3 grid gap-3">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  className="min-w-0 w-full   border bg-background "
                  placeholder="Pack name"
                  aria-label="Pack name"
                />
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  className="min-w-0 w-full min-h-20  border bg-background "
                  placeholder="What is this context for?"
                  aria-label="Pack description"
                />
                <label className="relative min-w-0">
                  <span className="sr-only">Search available context</span>
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className=" w-full  border bg-background pl-9"
                    placeholder="Search chats, files, Library, projects"
                  />
                </label>
              </div>
              <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border">
                <ul className="divide-y">
                  {visibleCandidates.length ? (
                    visibleCandidates.map((item) => (
                      <li key={item.key}>
                        <label className="flex min-h-12 cursor-pointer items-center gap-3 p-3 hover:bg-accent">
                          <Checkbox
                            data-ui-reference="chatgpt.checkbox"
                            checked={selected.includes(item.key)}
                            onCheckedChange={() =>
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
              <p className="mt-3 text-sm text-muted-foreground" role="status">
                {selected.length} context items selected
              </p>
              <Button
                variant="default"
                disabled={creating || !name.trim() || !selected.length}
                onClick={submit}
                className="mt-4 inline-flex  items-center gap-2  bg-foreground  text-background disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {creating ? "Saving…" : "Save context pack"}
              </Button>
            </section>
            <section className="min-w-0 [overflow-wrap:anywhere]">
              <h2 ref={savedListHeadingRef} tabIndex={-1} className="font-semibold">
                Saved packs
              </h2>
              {deleting ? (
                <p role="status" className="mt-2 text-sm text-muted-foreground">
                  Deleting context pack…
                </p>
              ) : null}
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
                        <Button
                          variant="default"
                          onClick={() => attachPack(pack)}
                          className="  bg-foreground  text-sm text-background"
                        >
                          Use in new chat
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            const handoff = writePrincipalHandoff(
                              safeBrowserStorage("sessionStorage"),
                              "kova-work-draft",
                              isLoaded ? userKey : undefined,
                              {
                                objective: `Work with ${pack.name}`,
                                context: pack.items
                                  .map((item) => `${item.title}: ${item.content}`)
                                  .join("\n\n"),
                                plan: [
                                  "Review the attached context",
                                  "Complete the objective",
                                  "Review and record deliverables",
                                ],
                              },
                            );
                            if (!handoff.ok) {
                              toast.error(
                                "Work context could not be prepared. Reload and try again.",
                              );
                              return;
                            }
                            navigate({ to: "/" });
                          }}
                          className="  border  text-sm hover:bg-accent"
                        >
                          Use in Work
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            const handoff = writePrincipalHandoff(
                              safeBrowserStorage("sessionStorage"),
                              "kova-app-chat-context",
                              isLoaded ? userKey : undefined,
                              { prompt: searchHandoffPrompt(pack), tool: "web_search" },
                            );
                            if (!handoff.ok) {
                              toast.error(
                                "Research context could not be prepared. Reload and try again.",
                              );
                              return;
                            }
                            navigate({ to: "/" });
                          }}
                          className="  border  text-sm hover:bg-accent"
                        >
                          Use in Search
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          aria-label={`Delete ${pack.name}`}
                          disabled={deleting}
                          aria-busy={deleting || undefined}
                          onClick={(event) => {
                            if (!dataReady || !isSignedIn || !principal || deletingRef.current)
                              return;
                            deleteTriggerRef.current = {
                              element: event.currentTarget,
                              principal,
                              generation: generationRef.current,
                              url: window.location.href,
                            };
                            setDeleteTarget({
                              pack,
                              principal,
                              generation: generationRef.current,
                              url: window.location.href,
                            });
                          }}
                          className="grid   place-items-center  text-destructive hover:bg-destructive/10 disabled:cursor-wait disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
        <ConfirmActionDialog
          open={!!deleteTarget && dataReady && deleteTarget.principal === principal}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title="Delete context pack?"
          description={`Delete “${deleteTarget?.pack.name ?? "this context pack"}”? This cannot be undone.`}
          confirmLabel="Delete pack"
          destructive
          disabled={deleting}
          onConfirm={() => void confirmDelete()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreDeleteFocus(event.target);
          }}
        />
      </main>
    </AppShell>
  );
}
