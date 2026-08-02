import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, FlaskConical, Heart, History, Play, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { useUser } from "@/components/auth/ClerkSafe";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import { listContextPacks, type ContextPack } from "@/lib/workspace.functions";
import {
  deletePromptTemplate,
  evaluatePrompt,
  listPromptHistory,
  listPromptTemplates,
  savePromptTemplate,
  updatePromptTemplate,
  type PromptTemplate,
  type PromptEvaluation,
  type PromptVersion,
} from "@/lib/professional.functions";
import { toast } from "sonner";
export const Route = createFileRoute("/prompt-studio")({
  component: PromptStudio,
  head: () => ({
    meta: [{ title: "Prompt Studio | KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});
const variables = (body: string) => [
  ...new Set([...body.matchAll(/{{\s*([\w -]{1,60})\s*}}/g)].map((match) => match[1].trim())),
];
const PROMPT_DRAFT_KEY = "kova-prompt-studio-draft-v1";
function PromptStudio() {
  const { isLoaded, isSignedIn } = useUser();
  const navigate = useNavigate();
  const list = useServerFn(listPromptTemplates),
    save = useServerFn(savePromptTemplate),
    update = useServerFn(updatePromptTemplate),
    remove = useServerFn(deletePromptTemplate),
    getProjects = useServerFn(listProjects),
    getPacks = useServerFn(listContextPacks);
  const getHistory = useServerFn(listPromptHistory),
    evaluate = useServerFn(evaluatePrompt);
  const [items, setItems] = useState<PromptTemplate[]>([]),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [packs, setPacks] = useState<ContextPack[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [favorites, setFavorites] = useState(false),
    [folderFilter, setFolderFilter] = useState("all"),
    [name, setName] = useState(""),
    [category, setCategory] = useState(() => {
      try {
        return (
          JSON.parse(localStorage.getItem("kova-workspace-defaults-v1") ?? "{}").prompt ?? "General"
        );
      } catch {
        return "General";
      }
    }),
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
    [notes, setNotes] = useState(""),
    [deletingPrompt, setDeletingPrompt] = useState<PromptTemplate | null>(null),
    [deletePending, setDeletePending] = useState(false);
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    Promise.all([list({}), getProjects({}), getPacks({})])
      .then(([prompts, p, context]) => {
        setItems(prompts);
        setProjects(p);
        setPacks(context);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Prompt Studio could not be loaded"))
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, list, getProjects, getPacks]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PROMPT_DRAFT_KEY) ?? "null") as {
        name?: string;
        folder?: string;
        category?: string;
        body?: string;
        projectId?: string;
        packId?: string;
      } | null;
      if (!saved) return;
      setName(saved.name ?? "");
      setFolder(saved.folder ?? "Unfiled");
      setCategory(saved.category ?? "General");
      setBody(saved.body ?? "");
      setProjectId(saved.projectId ?? "");
      setPackId(saved.packId ?? "");
    } catch {
      localStorage.removeItem(PROMPT_DRAFT_KEY);
    }
  }, []);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (name || body)
        localStorage.setItem(
          PROMPT_DRAFT_KEY,
          JSON.stringify({ name, folder, category, body, projectId, packId }),
        );
      else localStorage.removeItem(PROMPT_DRAFT_KEY);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [name, folder, category, body, projectId, packId]);
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
    if (!name.trim() || !body.trim()) return;
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
      setItems((all) => [item, ...all]);
      setName("");
      setBody("");
      localStorage.removeItem(PROMPT_DRAFT_KEY);
      toast.success("Prompt saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Prompt could not be saved");
    } finally {
      setCreating(false);
    }
  };
  const launch = async (item: PromptTemplate) => {
    let prompt = item.body;
    for (const variable of item.variables)
      prompt = prompt.replaceAll(
        new RegExp(`{{\\s*${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*}}`, "g"),
        values[variable] ?? "",
      );
    const pack = packs.find((value) => value.id === item.context_pack_id);
    sessionStorage.setItem("kova-prompt-launch", JSON.stringify({ prompt, pack }));
    try {
      await update({
        data: { id: item.id, last_used_at: new Date().toISOString(), increment_use: true },
      });
    } catch {
      toast.warning("Prompt prepared, but usage analytics could not be updated.");
    }
    navigate({ to: "/" });
  };
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
        <WorkspacePageHeader
          icon={FlaskConical}
          title="Prompt Studio"
          description="Build reusable prompts with variables, Projects, and Context Packs, then test them in chat."
        />
        {!isSignedIn && !loading ? (
          <div className="mt-6 rounded-2xl border p-8 text-center">
            Sign in to save reusable prompts.
          </div>
        ) : loading ? (
          <div className="mt-6 h-48 animate-pulse rounded-2xl bg-muted" />
        ) : error ? (
          <div role="alert" className="mt-6 rounded-xl border border-destructive/40 p-4">
            <p>{error}</p>
            <button
              onClick={() => location.reload()}
              className="mt-3 min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <section
              className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
              aria-label="Prompt analytics"
            >
              {[
                ["Prompts", items.length],
                ["Folders", new Set(items.map((item) => item.folder)).size],
                ["Total launches", items.reduce((sum, item) => sum + item.use_count, 0)],
                ["Evaluated", items.filter((item) => item.use_count > 0).length],
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
                    <p>No prompts match. Create a reusable prompt to begin.</p>
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
                              {item.folder} · {item.category} · {item.use_count} launches
                              {item.last_used_at
                                ? ` · Used ${new Date(item.last_used_at).toLocaleDateString()}`
                                : ""}
                            </p>
                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">
                              {item.body}
                            </p>
                          </div>
                          <button
                            aria-label={`${item.favorite ? "Unfavorite" : "Favorite"} ${item.name}`}
                            onClick={async () => {
                              try {
                                await update({ data: { id: item.id, favorite: !item.favorite } });
                                setItems((all) =>
                                  all.map((value) =>
                                    value.id === item.id
                                      ? { ...value, favorite: !value.favorite }
                                      : value,
                                  ),
                                );
                              } catch (reason) {
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
                            onClick={() => setDeletingPrompt(item)}
                            className="grid min-h-10 min-w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            setTesting(item);
                            setValues({});
                          }}
                          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-foreground px-3 text-sm text-background"
                        >
                          <Play className="h-4 w-4" />
                          Test in chat
                        </button>
                        <button
                          onClick={async () => {
                            setInspecting(item);
                            setEditBody(item.body);
                            setHistoryLoading(true);
                            try {
                              const history = await getHistory({ data: { prompt_id: item.id } });
                              setVersions(history.versions);
                              setEvaluations(history.evaluations);
                            } catch (reason) {
                              toast.error(
                                reason instanceof Error
                                  ? reason.message
                                  : "History could not be loaded",
                              );
                            } finally {
                              setHistoryLoading(false);
                            }
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
        {testing && (
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
                  onClick={() => setTesting(null)}
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
        {inspecting ? (
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
                  onClick={() => setInspecting(null)}
                  className="min-h-10 rounded-lg px-3 hover:bg-accent"
                >
                  Close
                </button>
              </div>
              {historyLoading ? (
                <div className="mt-4 h-32 animate-pulse rounded-xl bg-muted" />
              ) : (
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <section>
                    <h3 className="text-sm font-semibold">Current prompt</h3>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="mt-2 min-h-56 w-full rounded-xl border bg-background p-3"
                    />
                    <button
                      disabled={!editBody.trim() || editBody === inspecting.body}
                      onClick={async () => {
                        try {
                          await update({
                            data: {
                              id: inspecting.id,
                              body: editBody,
                              variables: variables(editBody),
                            },
                          });
                          setItems((all) =>
                            all.map((item) =>
                              item.id === inspecting.id
                                ? {
                                    ...item,
                                    body: editBody,
                                    variables: variables(editBody),
                                    updated_at: new Date().toISOString(),
                                  }
                                : item,
                            ),
                          );
                          toast.success("Prompt revision saved");
                          setInspecting(null);
                        } catch (reason) {
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
                    <h3 className="mt-5 text-sm font-semibold">Previous versions</h3>
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
                              onClick={() => setEditBody(version.body)}
                              className="mt-2 text-xs font-medium hover:underline"
                            >
                              Restore into editor
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No earlier revisions yet.
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
                    <button
                      onClick={async () => {
                        try {
                          const result = await evaluate({
                            data: { prompt_id: inspecting.id, rating, notes },
                          });
                          setEvaluations((all) => [result, ...all]);
                          setNotes("");
                          toast.success("Evaluation saved");
                        } catch (reason) {
                          toast.error(
                            reason instanceof Error
                              ? reason.message
                              : "Evaluation could not be saved",
                          );
                        }
                      }}
                      className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"
                    >
                      <BarChart3 className="h-4 w-4" />
                      Save evaluation
                    </button>
                    <h3 className="mt-5 text-sm font-semibold">Evaluation history</h3>
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
                      <p className="mt-2 text-sm text-muted-foreground">No evaluations yet.</p>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
      <ConfirmActionDialog
        open={Boolean(deletingPrompt)}
        onOpenChange={(open) => !open && !deletePending && setDeletingPrompt(null)}
        title="Delete prompt?"
        description={`“${deletingPrompt?.name ?? "This prompt"}” and its saved versions will be permanently removed.`}
        confirmLabel={deletePending ? "Deleting…" : "Delete prompt"}
        destructive
        disabled={deletePending}
        onConfirm={async () => {
          if (!deletingPrompt || deletePending) return;
          setDeletePending(true);
          try {
            await remove({ data: { id: deletingPrompt.id } });
            setItems((all) => all.filter((value) => value.id !== deletingPrompt.id));
            setDeletingPrompt(null);
            toast.success("Prompt deleted");
          } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : "Prompt could not be deleted");
          } finally {
            setDeletePending(false);
          }
        }}
      />
    </AppShell>
  );
}
