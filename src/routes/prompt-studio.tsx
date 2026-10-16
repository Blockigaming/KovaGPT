import { promptEvaluationIdentity } from "@/lib/prompt-evaluation-identity.mjs";
import { useCollectionPager } from "@/lib/use-collection-pager";
import { CollectionPageControls } from "@/components/CollectionPageControls";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, FlaskConical, Heart, History, Play, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { useUser } from "@/components/auth/ClerkSafe";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import { listContextPacks, readContextPack, type ContextPack } from "@/lib/workspace.functions";
import {
  deletePromptTemplate,
  evaluatePrompt,
  listPromptHistory,
  listPromptTemplates,
  readPromptTemplate,
  savePromptTemplate,
  updatePromptTemplate,
  type PromptTemplate,
  type PromptEvaluation,
  type PromptVersion,
} from "@/lib/professional.functions";
import { toast } from "sonner";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
  writePrincipalHandoff,
} from "@/lib/principal-browser-storage.mjs";
import { loadPrincipalStoredRecord, WORKSPACE_DEFAULTS_KEY_BASE } from "@/lib/settings-storage";
export const Route = createFileRoute("/prompt-studio")({
  component: PromptStudio,
  head: () => ({
    meta: [{ title: "KovaGPT Prompts" }, { name: "robots", content: "noindex" }],
  }),
});
const variables = (body: string) => [
  ...new Set([...body.matchAll(/{{\s*([\w -]{1,60})\s*}}/g)].map((match) => match[1].trim())),
];
const PROMPT_DRAFT_KEY_BASE = "kova-prompt-studio-draft";
function PromptStudio() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? browserStoragePrincipal(userKey) : null;
  const draftKey = isLoaded ? principalScopedStorageKey(PROMPT_DRAFT_KEY_BASE, userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const generationRef = useRef(0);
  const launchEpoch = useRef(0);
  const launchAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const cancelLaunch = () => {
    launchEpoch.current++;
    launchAbort.current?.abort();
  };
  useEffect(() => {
    mounted.current = true;
    const endingLaunchEpoch = launchEpoch;
    return () => {
      mounted.current = false;
      historyAbort.current?.abort();
      generationRef.current++;
      endingLaunchEpoch.current++;
      launchAbort.current?.abort();
    };
  }, []);
  const [dataPrincipal, setDataPrincipal] = useState<string | null>(null);
  const [dataGeneration, setDataGeneration] = useState(0);
  const dataReady =
    principal !== null && dataPrincipal === principal && dataGeneration === generationRef.current;
  const navigate = useNavigate();
  const listPage = useServerFn(listPromptTemplates),
    savePrompt = useServerFn(savePromptTemplate),
    updatePrompt = useServerFn(updatePromptTemplate),
    removePrompt = useServerFn(deletePromptTemplate),
    getProjects = useServerFn(listProjects),
    getPacksPage = useServerFn(listContextPacks),
    getPack = useServerFn(readContextPack);
  const getSavedPrompt = useServerFn(readPromptTemplate);
  const getHistory = useServerFn(listPromptHistory),
    evaluate = useServerFn(evaluatePrompt);
  const [items, setItems] = useState<PromptTemplate[]>([]),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [packs, setPacks] = useState<ContextPack[]>([]),
    [loading, setLoading] = useState(true),
    [projectError, setProjectError] = useState<string | null>(null),
    [projectsLoading, setProjectsLoading] = useState(false),
    [query, setQuery] = useState(""),
    [favorites, setFavorites] = useState(false),
    [folderFilter, setFolderFilter] = useState("all"),
    [name, setName] = useState(""),
    [category, setCategory] = useState("General"),
    [folder, setFolder] = useState("Unfiled"),
    [body, setBody] = useState(""),
    [projectId, setProjectId] = useState(""),
    [packId, setPackId] = useState(""),
    [creating, setCreating] = useState(false),
    [testing, setTesting] = useState<PromptTemplate | null>(null),
    [values, setValues] = useState<Record<string, string>>({}),
    [inspecting, setInspecting] = useState<PromptTemplate | null>(null),
    [versions, setVersions] = useState<PromptVersion[]>([]),
    [evaluations, setEvaluations] = useState<PromptEvaluation[]>([]),
    [historyLoading, setHistoryLoading] = useState(false),
    [editBody, setEditBody] = useState(""),
    [rating, setRating] = useState(5),
    [notes, setNotes] = useState("");
  const inspectionEpoch = useRef(0);
  const historySequence = useRef(0);
  const historyAbort = useRef<AbortController | null>(null);
  const evaluationPending = useRef(false);
  const separateEvaluation = useRef(false);
  const [savingEvaluation, setSavingEvaluation] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [versionsKnown, setVersionsKnown] = useState(false);
  const [evaluationsKnown, setEvaluationsKnown] = useState(false);
  const [versionCursor, setVersionCursor] = useState<string | null>(null);
  const [evaluationCursor, setEvaluationCursor] = useState<string | null>(null);
  const loadHistoryPage = async (
    source: "versions" | "evaluations" | "both",
    cursor: string | null,
    promptId = inspecting?.id,
    epoch = inspectionEpoch.current,
  ) => {
    if (!promptId || evaluationPending.current) return;
    const sequence = ++historySequence.current,
      generation = generationRef.current;
    historyAbort.current?.abort();
    const controller = new AbortController();
    historyAbort.current = controller;
    setHistoryLoading(true);
    setHistoryError(null);
    if (source === "both") {
      setVersionsKnown(false);
      setEvaluationsKnown(false);
      setVersions([]);
      setEvaluations([]);
      setVersionCursor(null);
      setEvaluationCursor(null);
    }
    const current = () =>
      mounted.current &&
      sequence === historySequence.current &&
      epoch === inspectionEpoch.current &&
      generation === generationRef.current &&
      principalRef.current === principal &&
      !controller.signal.aborted;
    try {
      const history = await getHistory({
        data: { prompt_id: promptId, source, cursor },
        signal: controller.signal,
      });
      if (!current()) return;
      if (source !== "evaluations") {
        setVersionsKnown(true);
        setVersions(history.versions);
        setVersionCursor(history.versionCursor);
      }
      if (source !== "versions") {
        setEvaluationsKnown(true);
        setEvaluations(history.evaluations);
        setEvaluationCursor(history.evaluationCursor);
      }
    } catch (reason) {
      if (current())
        setHistoryError(
          reason instanceof Error
            ? reason.message
            : "History page is unavailable. The last loaded page is retained.",
        );
    } finally {
      if (current()) {
        setHistoryLoading(false);
        historyAbort.current = null;
      }
    }
  };

  const editRevision = useRef(0);
  const createDraft = useRef("");
  createDraft.current = JSON.stringify({ name, body, category, folder, projectId, packId });
  const [reviewingPrompt, setReviewingPrompt] = useState(false);
  const reviewSavedPrompt = async () => {
    if (!inspecting || mutationScope.current.pending || reviewingPrompt) return;
    const generation = generationRef.current,
      epoch = inspectionEpoch.current;
    setReviewingPrompt(true);
    try {
      const latest = await getSavedPrompt({ data: { id: inspecting.id } });
      if (
        generation !== generationRef.current ||
        principalRef.current !== principal ||
        epoch !== inspectionEpoch.current
      )
        return;
      setInspecting(latest);
      setItems((all) => all.map((item) => (item.id === latest.id ? latest : item)));
      toast.success("Saved prompt loaded. Your draft is preserved; review before saving.");
    } catch (reason) {
      if (generation === generationRef.current && epoch === inspectionEpoch.current)
        toast.error(reason instanceof Error ? reason.message : "Saved prompt unavailable.");
    } finally {
      if (generation === generationRef.current && epoch === inspectionEpoch.current)
        setReviewingPrompt(false);
    }
  };
  const promptsPager = useCollectionPager(listPage, principal, setItems);
  const packsPager = useCollectionPager(getPacksPage, principal, setPacks);
  const list = promptsPager.read,
    getPacks = packsPager.read;
  const mutationScope = useRef({ principal, pending: false });
  if (mutationScope.current.principal !== principal)
    mutationScope.current = { principal, pending: false };
  const [promptMutating, setPromptMutating] = useState(false);
  const mutatePrompt = async <T,>(operation: () => Promise<T>): Promise<T> => {
    const owner = mutationScope.current;
    if (owner.pending) throw new Error("Wait for the current prompt change to finish.");
    owner.pending = true;
    setPromptMutating(true);
    promptsPager.invalidate();
    try {
      return await operation();
    } finally {
      owner.pending = false;
      if (mutationScope.current === owner) setPromptMutating(false);
    }
  };
  const save = (options: Parameters<typeof savePrompt>[0]) =>
    mutatePrompt(() => savePrompt(options));
  const update = (options: Parameters<typeof updatePrompt>[0]) =>
    mutatePrompt(() => updatePrompt(options));
  const remove = (options: Parameters<typeof removePrompt>[0]) =>
    mutatePrompt(() => removePrompt(options));

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setDataPrincipal(null);
    launchEpoch.current++;
    launchAbort.current?.abort();
    inspectionEpoch.current++;
    separateEvaluation.current = false;
    historyAbort.current?.abort();
    historyAbort.current = null;
    historySequence.current++;
    setHistoryError(null);
    setReviewingPrompt(false);
    setPromptMutating(false);
    setDataGeneration(generation);
    setItems([]);
    setProjects([]);
    setPacks([]);
    setLoading(true);
    setProjectError(null);
    setProjectsLoading(false);
    setQuery("");
    setFavorites(false);
    setFolderFilter("all");
    setName("");
    setCategory("General");
    setFolder("Unfiled");
    setBody("");
    setProjectId("");
    setPackId("");
    setTesting(null);
    setValues({});
    setInspecting(null);
    setVersions([]);
    setEvaluations([]);
    setHistoryLoading(false);
    setEditBody("");
    setRating(5);
    setNotes("");
    setSavingEvaluation(false);
    evaluationPending.current = false;
    separateEvaluation.current = false;
    setVersionsKnown(false);
    setEvaluationsKnown(false);
    setVersionCursor(null);
    setEvaluationCursor(null);
    if (!principal || !draftKey) return;

    const defaults = loadPrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, userKey, {
      migrateLegacyGuest: userKey === null,
    });
    if (typeof defaults?.prompt === "string") setCategory(defaults.prompt);
    try {
      const saved = JSON.parse(safeBrowserStorage("localStorage")?.getItem(draftKey) ?? "null") as {
        name?: string;
        folder?: string;
        category?: string;
        body?: string;
        projectId?: string;
        packId?: string;
      } | null;
      if (saved) {
        setName(saved.name ?? "");
        setFolder(saved.folder ?? "Unfiled");
        setCategory(saved.category ?? "General");
        setBody(saved.body ?? "");
        setProjectId(saved.projectId ?? "");
        setPackId(saved.packId ?? "");
      }
    } catch {
      safeBrowserStorage("localStorage")?.removeItem(draftKey);
    }
    if (generationRef.current !== generation || principalRef.current !== principal) return;
    setDataPrincipal(principal);
    setDataGeneration(generation);

    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    Promise.allSettled([list(), getProjects({}), getPacks()])
      .then(([, result]) => {
        if (generationRef.current !== generation || principalRef.current !== principal) return;
        if (result.status === "fulfilled") setProjects(result.value);
        else
          setProjectError(
            result.reason instanceof Error ? result.reason.message : "Projects unavailable.",
          );
      })
      .finally(() => {
        if (generationRef.current === generation && principalRef.current === principal) {
          setLoading(false);
        }
      });
  }, [draftKey, getPacks, getProjects, isSignedIn, list, principal, userKey]);

  useEffect(() => {
    if (!isLoaded || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      inspectionEpoch.current++;
      historySequence.current++;
      historyAbort.current?.abort();
      historyAbort.current = null;
      setHistoryError(null);
      setReviewingPrompt(false);
      setDataPrincipal(principal);
      setDataGeneration(generation);
      setItems([]);
      setProjects([]);
      setPacks([]);
      setLoading(false);
      setProjectError(null);
      setProjectsLoading(false);
      setQuery("");
      setFavorites(false);
      setFolderFilter("all");
      setName("");
      setCategory("General");
      setFolder("Unfiled");
      setBody("");
      setProjectId("");
      setPackId("");
      setCreating(false);
      setTesting(null);
      setValues({});
      setInspecting(null);
      setVersions([]);
      setEvaluations([]);
      setHistoryLoading(false);
      setEditBody("");
      setRating(5);
      setNotes("");
      setSavingEvaluation(false);
      evaluationPending.current = false;
      separateEvaluation.current = false;
      setVersionsKnown(false);
      setEvaluationsKnown(false);
      setVersionCursor(null);
      setEvaluationCursor(null);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);

  useEffect(() => {
    if (!dataReady || !draftKey) return;
    const generation = generationRef.current;
    const handle = window.setTimeout(() => {
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      const storage = safeBrowserStorage("localStorage");
      if (name || body)
        storage?.setItem(
          draftKey,
          JSON.stringify({ name, folder, category, body, projectId, packId }),
        );
      else storage?.removeItem(draftKey);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [body, category, dataReady, draftKey, folder, name, packId, principal, projectId]);
  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (!favorites || item.favorite) &&
            (folderFilter === "all" || item.folder === folderFilter) &&
            `${item.name} ${item.category} ${item.body}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(b.favorite) - Number(a.favorite) ||
            Date.parse(b.last_used_at ?? b.updated_at) - Date.parse(a.last_used_at ?? a.updated_at),
        ),
    [items, favorites, folderFilter, query],
  );
  const create = async () => {
    if (
      !dataReady ||
      mutationScope.current.pending ||
      dataGeneration !== generationRef.current ||
      !name.trim() ||
      !body.trim()
    )
      return;
    const generation = generationRef.current;
    const snapshot = createDraft.current;
    setCreating(true);
    try {
      const item = await save({
        data: {
          name,
          category,
          body,
          variables: variables(body),
          project_id: projectId || null,
          context_pack_id: packId || null,
          favorite: false,
          folder,
        },
      });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setItems((all) => [item, ...all]);
      if (createDraft.current === snapshot) {
        setName("");
        setBody("");
        safeBrowserStorage("localStorage")?.removeItem(draftKey!);
      }
      toast.success("Prompt saved");
    } catch (e) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(e instanceof Error ? e.message : "Prompt could not be saved");
      }
    } finally {
      if (generation === generationRef.current && principalRef.current === principal) {
        setCreating(false);
      }
    }
  };
  const launch = async (item: PromptTemplate) => {
    if (!mounted.current || !dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    const epoch = ++launchEpoch.current;
    launchAbort.current?.abort();
    const controller = new AbortController();
    launchAbort.current = controller;
    const current = () =>
      mounted.current &&
      epoch === launchEpoch.current &&
      !controller.signal.aborted &&
      generation === generationRef.current &&
      principalRef.current === principal;
    let prompt = item.body;
    for (const variable of item.variables)
      prompt = prompt.replaceAll(
        new RegExp(`{{\\s*${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*}}`, "g"),
        values[variable] ?? "",
      );
    let pack: ContextPack | undefined;
    try {
      if (item.context_pack_id)
        pack = await getPack({ data: { id: item.context_pack_id }, signal: controller.signal });
    } catch (reason) {
      if (current())
        toast.error(
          reason instanceof Error ? reason.message : "The linked context pack is unavailable.",
        );
      return;
    }
    if (!current()) return;
    try {
      await update({
        data: { id: item.id, increment_use: true },
        signal: controller.signal,
      });
    } catch {
      if (current()) {
        toast.warning("Prompt prepared, but usage analytics could not be updated.");
      }
    }
    if (!current()) return;
    const handoff = writePrincipalHandoff(
      safeBrowserStorage("sessionStorage"),
      "kova-prompt-launch",
      isLoaded ? userKey : undefined,
      { prompt, pack },
    );
    if (!handoff.ok) {
      toast.error("Prompt could not be prepared. Reload and try again.");
      return;
    }
    navigate({ to: "/" });
  };
  const retryProjects = async () => {
    if (projectsLoading) return;
    const generation = generationRef.current;
    const owner = principal;
    setProjectsLoading(true);
    try {
      const result = await getProjects({});
      if (generationRef.current !== generation || principalRef.current !== owner) return;
      setProjects(result);
      setProjectError(null);
    } catch (reason) {
      if (generationRef.current !== generation || principalRef.current !== owner) return;
      setProjectError(reason instanceof Error ? reason.message : "Projects unavailable.");
    } finally {
      if (generationRef.current === generation && principalRef.current === owner)
        setProjectsLoading(false);
    }
  };
  return (
    <AppShell utilitiesInHeader>
      <main
        id="main-content"
        tabIndex={-1}
        className="kova-workspace-controls mx-auto w-full max-w-6xl px-4 py-7 sm:px-6"
      >
        <WorkspacePageHeader
          icon={FlaskConical}
          title="Prompt Studio"
          titleId="prompt-studio-title"
          description="Build reusable prompts with variables, Projects, and Context Packs, then test them in chat."
        />
        {!isSignedIn && !loading ? (
          <div className="mt-6 rounded-2xl border p-8 text-center">
            Sign in to save reusable prompts.
          </div>
        ) : loading || !dataReady ? (
          <div className="mt-6 h-48 animate-pulse rounded-2xl bg-muted" />
        ) : (
          <>
            {projectError && (
              <div role="alert" className="mt-6 rounded-xl border border-destructive/40 p-4">
                <p>Project choices unavailable: {projectError}</p>
                <button
                  onClick={retryProjects}
                  disabled={projectsLoading}
                  className="mt-3 min-h-11 rounded-lg border px-3 text-sm hover:bg-accent disabled:opacity-50"
                >
                  {projectsLoading ? "Loading Projects…" : "Retry Projects"}
                </button>
              </div>
            )}
            <CollectionPageControls
              label="Prompts"
              pager={promptsPager}
              disabled={promptMutating || creating || inspecting !== null || testing !== null}
            />
            <CollectionPageControls
              label="Context pack choices"
              pager={packsPager}
              disabled={creating}
            />
            <section
              className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
              aria-label="Loaded page prompt analytics"
            >
              {[
                ["Prompts on page", items.length],
                ["Folders on page", new Set(items.map((item) => item.folder)).size],
                ["Page launch attempts", items.reduce((sum, item) => sum + item.use_count, 0)],
                ["Page evaluated", items.filter((item) => item.use_count > 0).length],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border bg-card/40 p-4">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-semibold">{value}</div>
                </div>
              ))}
            </section>
            <div className="mt-6 grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
              <section className="rounded-2xl border p-4">
                <h2 className="font-semibold">New prompt</h2>
                <div className="mt-3 grid gap-3">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 rounded-xl border bg-background px-3"
                    placeholder="Prompt name"
                    aria-label="Prompt name"
                  />
                  <input
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    className="h-11 rounded-xl border bg-background px-3"
                    placeholder="Folder"
                    aria-label="Prompt folder"
                  />
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-11 rounded-xl border bg-background px-3"
                    placeholder="Category"
                    aria-label="Prompt category"
                  />
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="min-h-40 rounded-xl border bg-background p-3"
                    placeholder="Draft a brief for {{audience}} about {{topic}}"
                    aria-label="Prompt template"
                  />
                  <div className="text-xs text-muted-foreground">
                    Variables found:{" "}
                    {variables(body).join(", ") || "None. Use {{variable}} syntax."}
                  </div>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="h-11 rounded-xl border bg-background px-3"
                    aria-label="Associate Project"
                  >
                    <option value="">No Project</option>
                    {projectId && !projects.some((project) => project.id === projectId) && (
                      <option value={projectId}>Selected Project (not in loaded choices)</option>
                    )}
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={packId}
                    onChange={(e) => setPackId(e.target.value)}
                    className="h-11 rounded-xl border bg-background px-3"
                    aria-label="Attach Context Pack"
                  >
                    <option value="">No Context Pack</option>
                    {packId && !packs.some((pack) => pack.id === packId) && (
                      <option value={packId}>Selected context pack (not on this page)</option>
                    )}
                    {packs.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={creating || !name.trim() || !body.trim()}
                    onClick={create}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-background disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    {creating ? "Saving…" : "Save prompt"}
                  </button>
                  <select
                    value={folderFilter}
                    onChange={(event) => setFolderFilter(event.target.value)}
                    className="h-10 rounded-xl border bg-background px-3 text-sm"
                    aria-label="Filter prompt folder"
                  >
                    <option value="all">All folders</option>
                    {[...new Set(items.map((item) => item.folder))].sort().map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
              <section>
                <div className="flex gap-2">
                  <label className="relative flex-1">
                    <span className="sr-only">Search prompts</span>
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-background pl-9"
                      placeholder="Search prompts"
                    />
                  </label>
                  <button
                    aria-pressed={favorites}
                    onClick={() => setFavorites((v) => !v)}
                    className={`min-h-10 rounded-xl border px-3 ${favorites ? "bg-foreground text-background" : ""}`}
                  >
                    <Heart className="h-4 w-4" />
                    <span className="sr-only">Favorites only</span>
                  </button>
                </div>
                {visible.length === 0 ? (
                  <div className="mt-3 rounded-2xl border p-10 text-center text-sm text-muted-foreground">
                    <p>
                      No prompts on this page match. Browse another page or create a reusable
                      prompt.
                    </p>
                    {query || favorites || folderFilter !== "all" ? (
                      <button
                        onClick={() => {
                          setQuery("");
                          setFavorites(false);
                          setFolderFilter("all");
                        }}
                        className="mt-3 min-h-10 rounded-lg border px-3 text-sm text-foreground hover:bg-accent"
                      >
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {visible.map((item) => (
                      <li key={item.id} className="rounded-2xl border bg-card/40 p-4">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium">{item.name}</h3>
                            <p className="text-xs text-muted-foreground">
                              {item.folder} · {item.category} · {item.use_count} launch attempts
                              {item.last_used_at
                                ? ` · Attempted ${new Date(item.last_used_at).toLocaleDateString()}`
                                : ""}
                            </p>
                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">
                              {item.body}
                            </p>
                          </div>
                          <button
                            aria-label={`${item.favorite ? "Unfavorite" : "Favorite"} ${item.name}`}
                            onClick={async () => {
                              const generation = generationRef.current;
                              try {
                                const saved = await update({
                                  data: {
                                    id: item.id,
                                    favorite: !item.favorite,
                                    expectedUpdatedAt: item.updated_at,
                                  },
                                });
                                if (
                                  generation !== generationRef.current ||
                                  principalRef.current !== principal
                                )
                                  return;
                                setItems((all) =>
                                  all.map((value) => (value.id === item.id ? saved : value)),
                                );
                              } catch (reason) {
                                if (
                                  generation !== generationRef.current ||
                                  principalRef.current !== principal
                                )
                                  return;
                                toast.error(
                                  reason instanceof Error
                                    ? reason.message
                                    : "Favorite could not be updated",
                                );
                              }
                            }}
                            className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-accent"
                          >
                            <Heart className={`h-4 w-4 ${item.favorite ? "fill-current" : ""}`} />
                          </button>
                          <button
                            aria-label={`Delete ${item.name}`}
                            onClick={async () => {
                              if (!confirm("Delete this prompt?")) return;
                              const generation = generationRef.current;
                              try {
                                await remove({
                                  data: { id: item.id, expectedUpdatedAt: item.updated_at },
                                });
                                if (
                                  generation !== generationRef.current ||
                                  principalRef.current !== principal
                                )
                                  return;
                                setItems((all) => all.filter((value) => value.id !== item.id));
                              } catch (reason) {
                                if (
                                  generation !== generationRef.current ||
                                  principalRef.current !== principal
                                )
                                  return;
                                toast.error(
                                  reason instanceof Error
                                    ? reason.message
                                    : "Prompt could not be deleted",
                                );
                              }
                            }}
                            className="grid min-h-10 min-w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            cancelLaunch();
                            setTesting(item);
                            setValues({});
                          }}
                          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-foreground px-3 text-sm text-background"
                        >
                          <Play className="h-4 w-4" />
                          Test in chat
                        </button>
                        <button
                          onClick={() => {
                            if (evaluationPending.current) return;
                            const epoch = ++inspectionEpoch.current;
                            separateEvaluation.current = false;
                            setReviewingPrompt(false);
                            editRevision.current++;
                            setRating(5);
                            setNotes("");
                            setSavingEvaluation(false);
                            setInspecting(item);
                            setEditBody(item.body);
                            void loadHistoryPage("both", null, item.id, epoch);
                          }}
                          className="mt-3 ml-2 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm hover:bg-accent"
                        >
                          <History className="h-4 w-4" /> Versions & evaluation
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
        {dataReady && testing && (
          <div
            className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center"
            role="dialog"
            aria-modal="true"
            aria-label={`Test ${testing.name}`}
          >
            <div className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 sm:max-w-lg sm:rounded-2xl">
              <h2 className="font-semibold">Test {testing.name}</h2>
              {testing.variables.length ? (
                <div className="mt-4 space-y-3">
                  {testing.variables.map((variable) => (
                    <label key={variable} className="block text-sm font-medium">
                      {variable}
                      <input
                        value={values[variable] ?? ""}
                        onChange={(e) =>
                          setValues((all) => ({ ...all, [variable]: e.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-xl border bg-background px-3"
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">This prompt has no variables.</p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => {
                    cancelLaunch();
                    setTesting(null);
                  }}
                  className="min-h-11 rounded-xl px-4 hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={() => launch(testing)}
                  className="min-h-11 rounded-xl bg-foreground px-4 text-background"
                >
                  Launch new chat
                </button>
              </div>
            </div>
          </div>
        )}
        {dataReady && inspecting ? (
          <div
            className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center"
            role="dialog"
            aria-modal="true"
            aria-label={`Inspect ${inspecting.name}`}
          >
            <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 sm:max-w-3xl sm:rounded-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{inspecting.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    Edit with automatic revision capture and evaluate actual prompt use.
                  </p>
                </div>
                <button
                  onClick={() => {
                    inspectionEpoch.current++;
                    separateEvaluation.current = false;
                    historyAbort.current?.abort();
                    evaluationPending.current = false;
                    setSavingEvaluation(false);
                    setRating(5);
                    setNotes("");
                    setInspecting(null);
                  }}
                  className="min-h-10 rounded-lg px-3 hover:bg-accent"
                >
                  Close
                </button>
              </div>
              {historyError && (
                <p role="alert" className="mt-3 text-sm">
                  {historyError}
                </p>
              )}
              {historyLoading ? (
                <div className="mt-4 h-32 animate-pulse rounded-xl bg-muted" />
              ) : (
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <section>
                    <h3 className="text-sm font-semibold">Current prompt</h3>
                    <textarea
                      value={editBody}
                      onChange={(e) => {
                        editRevision.current++;
                        setEditBody(e.target.value);
                      }}
                      className="mt-2 min-h-56 w-full rounded-xl border bg-background p-3"
                    />
                    <button
                      disabled={
                        promptMutating ||
                        reviewingPrompt ||
                        !editBody.trim() ||
                        editBody === inspecting.body
                      }
                      onClick={async () => {
                        const generation = generationRef.current;
                        const epoch = inspectionEpoch.current,
                          revision = editRevision.current;
                        try {
                          const saved = await update({
                            data: {
                              id: inspecting.id,
                              expectedUpdatedAt: inspecting.updated_at,
                              body: editBody,
                              variables: variables(editBody),
                            },
                          });
                          if (
                            generation !== generationRef.current ||
                            principalRef.current !== principal
                          )
                            return;
                          setItems((all) =>
                            all.map((item) => (item.id === inspecting.id ? saved : item)),
                          );
                          toast.success("Prompt revision saved");
                          if (epoch === inspectionEpoch.current) {
                            if (revision === editRevision.current) {
                              inspectionEpoch.current++;
                              setInspecting(null);
                            } else setInspecting(saved);
                          }
                        } catch (reason) {
                          if (
                            generation !== generationRef.current ||
                            principalRef.current !== principal
                          )
                            return;
                          toast.error(
                            reason instanceof Error
                              ? reason.message
                              : "Revision could not be saved",
                          );
                        }
                      }}
                      className="mt-2 min-h-10 rounded-lg bg-foreground px-3 text-sm text-background disabled:opacity-50"
                    >
                      Save revision
                    </button>
                    <button
                      type="button"
                      disabled={promptMutating || reviewingPrompt}
                      onClick={() => void reviewSavedPrompt()}
                      className="mt-2 min-h-11 rounded-lg border px-3 text-sm"
                    >
                      Review saved prompt
                    </button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Saved content for comparison:
                    </p>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                      {inspecting.body}
                    </pre>
                    <h3 className="mt-5 text-sm font-semibold">Previous versions</h3>
                    <p className="text-xs text-muted-foreground">
                      Only this history page is shown. More revisions may be on another page.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={savingEvaluation}
                        className="min-h-11 rounded-lg border px-3 text-sm"
                        onClick={() => void loadHistoryPage("versions", null)}
                      >
                        First versions page
                      </button>
                      <button
                        type="button"
                        disabled={savingEvaluation || !versionCursor}
                        className="min-h-11 rounded-lg border px-3 text-sm"
                        onClick={() => void loadHistoryPage("versions", versionCursor)}
                      >
                        Next versions page
                      </button>
                    </div>
                    {versions.length ? (
                      <ul className="mt-2 space-y-2">
                        {versions.map((version) => (
                          <li key={version.id} className="rounded-xl border p-3">
                            <div className="text-xs font-medium">
                              Version {version.version} ·{" "}
                              {new Date(version.created_at).toLocaleString()}
                            </div>
                            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                              {version.body}
                            </p>
                            <button
                              onClick={() => {
                                editRevision.current++;
                                setEditBody(version.body);
                              }}
                              className="mt-2 text-xs font-medium hover:underline"
                            >
                              Restore into editor
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {versionsKnown
                          ? "No revisions on this loaded page."
                          : "Revisions have not loaded. Use First versions page to retry."}
                      </p>
                    )}
                  </section>
                  <section>
                    <h3 className="text-sm font-semibold">Evaluate this prompt</h3>
                    <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Prompt rating">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          role="radio"
                          aria-checked={rating === value}
                          onClick={() => setRating(value)}
                          className={`grid h-10 w-10 place-items-center rounded-lg border ${rating === value ? "bg-foreground text-background" : ""}`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      maxLength={2000}
                      placeholder="What worked? What should change?"
                      className="mt-2 min-h-24 w-full rounded-xl border bg-background p-3"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Retries of the same rating and notes reuse a saved request in this tab (up to
                      64 retained requests). Clearing local recovery removes these retry references.
                      Review saved evaluations before recording a separate one.
                    </p>
                    <button
                      className="mt-2 min-h-11 rounded-lg border px-3 text-sm"
                      disabled={savingEvaluation}
                      onClick={() => {
                        separateEvaluation.current = true;
                        toast.success("The next save will start a separate evaluation.");
                      }}
                    >
                      Start separate evaluation
                    </button>
                    <button
                      disabled={savingEvaluation}
                      onClick={async () => {
                        if (evaluationPending.current || historyAbort.current) return;
                        evaluationPending.current = true;
                        setSavingEvaluation(true);
                        const epoch = inspectionEpoch.current;
                        const generation = generationRef.current;
                        try {
                          const payload = { prompt_id: inspecting.id, rating, notes: notes.trim() };
                          const current = () =>
                            epoch === inspectionEpoch.current &&
                            generation === generationRef.current &&
                            principalRef.current === principal;
                          const requestId = await promptEvaluationIdentity(
                            safeBrowserStorage("sessionStorage"),
                            userKey!,
                            payload,
                            current,
                            separateEvaluation.current,
                          );
                          if (!current()) return;
                          separateEvaluation.current = false;
                          const result = await evaluate({ data: { ...payload, requestId } });
                          if (
                            epoch !== inspectionEpoch.current ||
                            generation !== generationRef.current ||
                            principalRef.current !== principal
                          )
                            return;
                          setEvaluations((all) => [
                            result,
                            ...all.filter((item) => item.id !== result.id),
                          ]);
                          setNotes((current) => (current === notes ? "" : current));
                          toast.success("Evaluation saved");
                        } catch (reason) {
                          if (
                            epoch !== inspectionEpoch.current ||
                            generation !== generationRef.current ||
                            principalRef.current !== principal
                          )
                            return;
                          toast.error(
                            reason instanceof Error
                              ? reason.message
                              : "Evaluation could not be saved",
                          );
                        } finally {
                          if (
                            generation === generationRef.current &&
                            epoch === inspectionEpoch.current &&
                            principalRef.current === principal
                          ) {
                            evaluationPending.current = false;
                            setSavingEvaluation(false);
                          }
                        }
                      }}
                      className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"
                    >
                      <BarChart3 className="h-4 w-4" />
                      Save evaluation
                    </button>
                    <h3 className="mt-5 text-sm font-semibold">Evaluation history</h3>
                    <p className="text-xs text-muted-foreground">
                      Only this history page is shown.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={savingEvaluation}
                        className="min-h-11 rounded-lg border px-3 text-sm"
                        onClick={() => void loadHistoryPage("evaluations", null)}
                      >
                        First evaluations page
                      </button>
                      <button
                        type="button"
                        disabled={savingEvaluation || !evaluationCursor}
                        className="min-h-11 rounded-lg border px-3 text-sm"
                        onClick={() => void loadHistoryPage("evaluations", evaluationCursor)}
                      >
                        Next evaluations page
                      </button>
                    </div>
                    {evaluations.length ? (
                      <ul className="mt-2 space-y-2">
                        {evaluations.map((evaluation) => (
                          <li key={evaluation.id} className="rounded-xl border p-3 text-sm">
                            <div className="font-medium">{evaluation.rating}/5</div>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                              {evaluation.notes || "No notes"}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No evaluations on this loaded page.
                      </p>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
