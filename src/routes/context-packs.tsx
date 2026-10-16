import { useCollectionPager } from "@/lib/use-collection-pager";
import { CollectionPageControls } from "@/components/CollectionPageControls";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/components/auth/ClerkSafe";
import { chatStoragePrincipal, loadConversations } from "@/lib/chat-store";
import type { LibraryItem } from "@/lib/library.functions";
import { listLibraryPage, readLibraryItem } from "@/lib/library-items-client";
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
  libraryItem?: LibraryItem;
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
  const { isLoaded, user } = useUser();
  return <ContextPacksForAccount key={isLoaded ? (user?.id ?? "guest") : "loading"} />;
}
function ContextPacksForAccount() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const workRevision = useWorkStoreRevision(userKey);
  const principal = isLoaded ? chatStoragePrincipal(userKey) : null;
  const navigate = useNavigate();
  const listPacksPage = useServerFn(listContextPacks),
    create = useServerFn(createContextPack),
    remove = useServerFn(deleteContextPack),
    getProjects = useServerFn(listProjects),
    getMemoriesPage = useServerFn(listMemoryCenter),
    getPromptsPage = useServerFn(listPromptTemplates),
    getResearchPage = useServerFn(listResearchTemplates);
  const [packs, setPacks] = useState<ContextPack[]>([]),
    [library, setLibrary] = useState<LibraryItem[]>([]),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [memories, setMemories] = useState<MemoryRecord[]>([]),
    [prompts, setPrompts] = useState<PromptTemplate[]>([]),
    [research, setResearch] = useState<ResearchTemplate[]>([]),
    [pending, setPending] = useState<WorkspaceHandoff[]>([]),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Candidate[]>([]);
  const packsPager = useCollectionPager(listPacksPage, principal, setPacks);
  const memoryPager = useCollectionPager(getMemoriesPage, principal, setMemories);
  const promptsPager = useCollectionPager(getPromptsPage, principal, setPrompts);
  const researchPager = useCollectionPager(getResearchPage, principal, setResearch);
  const listPacks = packsPager.read,
    getMemories = memoryPager.read,
    getPrompts = promptsPager.read,
    getResearch = researchPager.read;
  const active = useRef(true);
  const createPending = useRef(false);
  const draftRevision = useRef(0);
  const deletePending = useRef(new Set<string>());
  const bodyAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      bodyAbort.current?.abort();
    };
  }, []);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryCursor, setLibraryCursor] = useState<Record<string, unknown> | null>(null);
  const librarySequence = useRef(0);
  const libraryAbort = useRef<AbortController | null>(null);
  const loadLibrary = useCallback(
    async (cursor: Record<string, unknown> | null = null) => {
      if (!isLoaded || !isSignedIn || !userKey) return;
      const sequence = ++librarySequence.current;
      libraryAbort.current?.abort();
      const controller = new AbortController();
      libraryAbort.current = controller;
      setLibraryLoading(true);
      setLibraryError(null);
      if (!cursor) {
        setLibrary([]);
        setLibraryCursor(null);
      }
      try {
        const page = await listLibraryPage(
          userKey,
          { query, sort: "newest", filter: "all", folder: "all", favorites: "", cursor },
          controller.signal,
        );
        if (!active.current || sequence !== librarySequence.current) return;
        setLibrary((previous) =>
          cursor
            ? [
                ...previous,
                ...page.items.filter((item) => !previous.some((old) => old.id === item.id)),
              ]
            : page.items,
        );
        setLibraryCursor(page.cursor);
      } catch (error) {
        if (active.current && sequence === librarySequence.current)
          setLibraryError(
            error instanceof Error ? error.message : "Library choices are unavailable.",
          );
      } finally {
        if (active.current && sequence === librarySequence.current) setLibraryLoading(false);
      }
    },
    [isLoaded, isSignedIn, userKey, query],
  );
  useEffect(() => {
    void loadLibrary();
    const sequence = librarySequence,
      abort = libraryAbort;
    return () => {
      sequence.current++;
      abort.current?.abort();
    };
  }, [loadLibrary]);
  const [dataPrincipal, setDataPrincipal] = useState<string | null>(null);
  const dataReady = principal !== null && dataPrincipal === principal;
  useEffect(() => {
    if (!isLoaded || principal === null) {
      setDataPrincipal(null);
      setLoading(true);
      return;
    }
    setDataPrincipal(null);
    setPacks([]);
    setProjects([]);
    setMemories([]);
    setPrompts([]);
    setResearch([]);
    setPending([]);
    setSourceErrors([]);
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
      setSelected(
        candidates
          .slice(0, 30)
          .map((candidate) => ({ ...candidate, key: `${candidate.type}:${candidate.id}` })),
      );
    } else if (handoff.reason !== "missing") {
      toast.error("Saved context candidates could not be attached.");
    }
    Promise.allSettled([listPacks(), getProjects({}), getMemories(), getPrompts(), getResearch()])
      .then(([, pr]) => {
        if (cancelled) return;
        const unavailable: string[] = [];
        function adopt<T>(
          result: PromiseSettledResult<T>,
          label: string,
          setter: (value: T) => void,
        ) {
          if (result.status === "fulfilled") setter(result.value);
          else unavailable.push(label);
        }
        adopt(pr, "Projects", setProjects);
        setSourceErrors(unavailable);
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
    getProjects,
    getMemories,
    getPrompts,
    getResearch,
    principal,
    userKey,
    refreshVersion,
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
        content: "",
        libraryItem: item,
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
    ]
      .filter((item, index, all) => all.findIndex((other) => other.key === item.key) === index)
      .filter(
        (item) =>
          "libraryItem" in item ||
          `${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase()),
      );
  }, [
    dataReady,
    library,
    memories,
    pending,
    projects,
    prompts,
    query,
    research,
    userKey,
    workRevision,
  ]);
  const submit = async () => {
    if (!active.current || createPending.current || !userKey || !name.trim() || !selected.length)
      return;
    createPending.current = true;
    packsPager.invalidate();
    const revision = draftRevision.current;
    const controller = new AbortController();
    bodyAbort.current = controller;
    setCreating(true);
    try {
      const items = [];
      for (const candidate of selected) {
        let content = candidate.content;
        if (candidate.libraryItem) {
          const loaded = await readLibraryItem(userKey, candidate.libraryItem, controller.signal);
          if (!active.current) return;
          if (!loaded.content_text?.trim())
            throw new Error(
              `${candidate.title} has no readable text. Remove it from this text context pack.`,
            );
          content = loaded.content_text;
        }
        items.push({
          type: candidate.type,
          id: candidate.id,
          title: candidate.title,
          content: content.slice(0, 12000),
        });
      }
      if (!active.current) return;
      const pack = await create({ data: { name, description, items } });
      if (!active.current) return;
      setPacks((all) => [pack, ...all]);
      if (draftRevision.current === revision) {
        setName("");
        setDescription("");
        setSelected([]);
      }
      toast.success("Context pack saved");
    } catch (e) {
      if (active.current)
        toast.error(e instanceof Error ? e.message : "Context pack could not be saved");
    } finally {
      if (active.current) {
        createPending.current = false;
        setCreating(false);
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
        id="main-content"
        tabIndex={-1}
        className="kova-workspace-controls mx-auto min-w-0 w-full max-w-5xl px-4 py-7 sm:px-6"
      >
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
        ) : !dataReady || loading ? (
          <div className="mt-6 h-40 animate-pulse rounded-2xl bg-muted" />
        ) : (
          <div className="mt-6 grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
            <section className="min-w-0 rounded-2xl border p-4">
              <h2 className="font-semibold">Build a pack</h2>
              <div className="mt-3 grid gap-3">
                <input
                  value={name}
                  onChange={(e) => {
                    draftRevision.current++;
                    setName(e.target.value);
                  }}
                  maxLength={120}
                  className="min-w-0 w-full h-11 rounded-xl border bg-background px-3"
                  placeholder="Pack name"
                  aria-label="Pack name"
                />
                <textarea
                  value={description}
                  onChange={(e) => {
                    draftRevision.current++;
                    setDescription(e.target.value);
                  }}
                  maxLength={500}
                  className="min-w-0 w-full min-h-20 rounded-xl border bg-background p-3"
                  placeholder="What is this context for?"
                  aria-label="Pack description"
                />
                <label className="relative">
                  <span className="sr-only">Search available context</span>
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    maxLength={200}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-10 w-full rounded-xl border bg-background pl-9"
                    placeholder="Search chats, files, Library, projects"
                  />
                </label>
              </div>
              {sourceErrors.length > 0 && (
                <div role="alert" className="mt-3 text-sm">
                  Unavailable sources: {sourceErrors.join(", ")}.
                  <button
                    disabled={creating}
                    onClick={() => {
                      if (!createPending.current) setRefreshVersion((value) => value + 1);
                    }}
                    className="ml-2 underline"
                  >
                    Retry sources
                  </button>
                </div>
              )}
              <CollectionPageControls label="Memory choices" pager={memoryPager} />
              <CollectionPageControls label="Prompt choices" pager={promptsPager} />
              <CollectionPageControls label="Research choices" pager={researchPager} />
              {libraryError && (
                <div role="alert" className="mt-3 text-sm">
                  Library choices unavailable. {libraryError}
                  <button onClick={() => void loadLibrary()} className="ml-2 underline">
                    Retry Library
                  </button>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Text context only. Library items without extracted text cannot be selected. Each
                selected source contributes up to 12,000 characters.
              </p>
              <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border">
                <ul className="divide-y">
                  {candidates.length ? (
                    candidates.map((item) => (
                      <li key={item.key}>
                        <label className="flex min-h-12 cursor-pointer items-center gap-3 p-3 hover:bg-accent">
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={selected.some((value) => value.key === item.key)}
                            disabled={
                              Boolean(item.libraryItem && !item.libraryItem.text_available) ||
                              (selected.length >= 30 &&
                                !selected.some((value) => value.key === item.key))
                            }
                            onChange={() => {
                              draftRevision.current++;
                              setSelected((all) =>
                                all.some((value) => value.key === item.key)
                                  ? all.filter((value) => value.key !== item.key)
                                  : all.length < 30
                                    ? [...all, item]
                                    : all,
                              );
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block whitespace-normal [overflow-wrap:anywhere] text-sm font-medium">
                              {item.title}
                            </span>
                            <span className="text-xs capitalize text-muted-foreground">
                              {item.type}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))
                  ) : (
                    <li className="p-6 text-center text-sm text-muted-foreground">
                      {libraryLoading
                        ? "Loading Library choices…"
                        : "No matching context in available sources."}
                    </li>
                  )}
                </ul>
              </div>
              {libraryCursor && (
                <button
                  disabled={libraryLoading}
                  onClick={() => void loadLibrary(libraryCursor)}
                  className="mt-3 min-h-10 rounded-lg border px-3"
                >
                  {libraryLoading ? "Loading…" : "Load more Library items"}
                </button>
              )}
              <div className="mt-3 text-sm">
                Selected {selected.length}/30
                {selected.map((item) => (
                  <button
                    key={item.key}
                    aria-label={`Remove ${item.title} from selection`}
                    className="ml-2 max-w-full whitespace-normal [overflow-wrap:anywhere] rounded border px-2 py-1"
                    onClick={() => {
                      draftRevision.current++;
                      setSelected((all) => all.filter((value) => value.key !== item.key));
                    }}
                  >
                    {item.title} ×
                  </button>
                ))}
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
            <section className="min-w-0">
              <h2 className="font-semibold">Saved packs</h2>
              <CollectionPageControls label="Saved packs" pager={packsPager} disabled={creating} />
              {packsPager.error && packs.length === 0 ? (
                <p role="alert" className="mt-3 text-sm">
                  {packsPager.error}
                </p>
              ) : packs.length === 0 ? (
                <div className="mt-3 rounded-2xl border p-8 text-center text-sm text-muted-foreground">
                  No saved packs on this page. Browse another page or create a pack from workspace
                  context.
                </div>
              ) : (
                <ul className="mt-3 space-y-3">
                  {packs.map((pack) => (
                    <li key={pack.id} className="rounded-2xl border bg-card/40 p-4">
                      <h3 className="[overflow-wrap:anywhere] font-medium">{pack.name}</h3>
                      <p className="mt-1 [overflow-wrap:anywhere] text-sm text-muted-foreground">
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
                            navigate({ to: "/work" });
                          }}
                          className="min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
                        >
                          Use in Work
                        </button>
                        <button
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
                          className="min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
                        >
                          Use in Search
                        </button>
                        <button
                          aria-label={`Delete ${pack.name}`}
                          onClick={async () => {
                            if (
                              !active.current ||
                              deletePending.current.has(pack.id) ||
                              !confirm("Delete this context pack?")
                            )
                              return;
                            deletePending.current.add(pack.id);
                            packsPager.invalidate();
                            try {
                              await remove({ data: { id: pack.id } });
                              if (!active.current) return;
                              setPacks((all) => all.filter((p) => p.id !== pack.id));
                            } catch (e) {
                              if (active.current)
                                toast.error(e instanceof Error ? e.message : "Could not delete");
                            } finally {
                              deletePending.current.delete(pack.id);
                            }
                          }}
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
    </AppShell>
  );
}
