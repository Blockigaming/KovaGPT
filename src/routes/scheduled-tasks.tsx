import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import {
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  isScheduledTasksEligible,
  type ScheduledTask,
} from "@/lib/scheduled-tasks.functions";
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Pause,
  Play,
  ArrowLeft,
  Lock,
  RefreshCw,
  Search,
  RotateCcw,
  WandSparkles,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AutomationBuilder, type AutomationDraft } from "@/components/AutomationBuilder";
import { RelatedWorkspaceItems } from "@/components/WorkspaceIntelligence";
import {
  browserStoragePrincipal,
  consumePrincipalHandoff,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export const Route = createFileRoute("/scheduled-tasks")({
  component: ScheduledTasksPage,
  head: () => ({
    meta: [
      { title: "KovaGPT Tasks" },
      {
        name: "description",
        content:
          "Review historical scheduled-task status. Background execution is unavailable in this deployment.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type PlanState = "loading" | "free" | "paid" | "signed-out" | "error";
type TaskFilter = "all" | "active" | "paused" | "history" | "failed";

function ScheduledTasksPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = isLoaded ? browserStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const generationRef = useRef(0);
  const [dataPrincipal, setDataPrincipal] = useState<string | null>(null);
  const [dataGeneration, setDataGeneration] = useState(0);
  const [lifecycleVersion, setLifecycleVersion] = useState(0);
  const dataReady =
    principal !== null && dataPrincipal === principal && dataGeneration === generationRef.current;
  const [plan, setPlan] = useState<PlanState>("loading");
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [executionAvailable, setExecutionAvailable] = useState(false);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [when, setWhen] = useState("");
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly" | "monthly">("none");

  const list = useServerFn(listScheduledTasks);
  const create = useServerFn(createScheduledTask);
  const update = useServerFn(updateScheduledTask);
  const remove = useServerFn(deleteScheduledTask);
  const checkEligible = useServerFn(isScheduledTasksEligible);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setDataPrincipal(null);
    setDataGeneration(generation);
    setPlan("loading");
    setTasks([]);
    setLoading(false);
    setCreating(false);
    setLoadError(null);
    setQuery("");
    setFilter("all");
    setBuilderOpen(false);
    setExecutionAvailable(false);
    setTitle("");
    setPrompt("");
    setWhen("");
    setRepeat("none");
    if (!principal) return;
    if (!isSignedIn) {
      setDataPrincipal(principal);
      setDataGeneration(generation);
      setPlan("signed-out");
      return;
    }
    let cancel = false;
    checkEligible({})
      .then((r) => {
        if (cancel || generationRef.current !== generation || principalRef.current !== principal)
          return;
        setExecutionAvailable(r.executionAvailable);
        setDataPrincipal(principal);
        setDataGeneration(generation);
        setPlan(r.eligible ? "paid" : "free");
      })
      .catch(() => {
        if (!cancel && generationRef.current === generation && principalRef.current === principal) {
          setDataPrincipal(principal);
          setDataGeneration(generation);
          setPlan("error");
        }
      });
    return () => {
      cancel = true;
    };
  }, [checkEligible, isSignedIn, lifecycleVersion, principal]);

  const loadTasks = useCallback(async () => {
    if (!dataReady || dataGeneration !== generationRef.current || plan !== "paid") return;
    const generation = generationRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await list({});
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTasks(next);
    } catch (error) {
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      const message = error instanceof Error ? error.message : "Failed to load tasks";
      setLoadError(message);
      toast.error(message);
    } finally {
      if (generation === generationRef.current && principalRef.current === principal) {
        setLoading(false);
      }
    }
  }, [dataGeneration, dataReady, list, plan, principal]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const handoff = consumePrincipalHandoff<{
      title: string;
      prompt: string;
      repeat: ScheduledTask["repeat"];
    }>(safeBrowserStorage("sessionStorage"), "kova-automation-draft", userKey);
    if (!handoff.ok) {
      if (handoff.reason !== "missing") {
        toast.error("The saved scheduling draft could not be loaded.");
      }
      return;
    }
    try {
      const draft = handoff.value;
      if (typeof draft.title !== "string" || typeof draft.prompt !== "string") {
        throw new Error("invalid_automation_handoff");
      }
      setTitle(draft.title);
      setPrompt(draft.prompt);
      setRepeat(draft.repeat);
      toast.message("Work follow-up loaded. Choose when it should run.");
    } catch {
      toast.error("The saved scheduling draft could not be loaded.");
    }
  }, [dataGeneration, dataReady, userKey]);

  useEffect(() => {
    if (!isLoaded || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      generationRef.current += 1;
      setDataPrincipal(null);
      setTasks([]);
      setTitle("");
      setPrompt("");
      setWhen("");
      setRepeat("none");
      setBuilderOpen(false);
      setLifecycleVersion((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);

  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (dataReady ? tasks : []).filter((task) => {
      const statusMatch =
        filter === "all" ||
        (filter === "active" && ["scheduled", "running"].includes(task.status)) ||
        (filter === "paused" && task.status === "paused") ||
        (filter === "history" && task.status === "completed") ||
        (filter === "failed" && task.status === "failed");
      return (
        statusMatch &&
        (!normalized || `${task.title} ${task.prompt}`.toLowerCase().includes(normalized))
      );
    });
  }, [dataReady, filter, query, tasks]);

  const visiblePlan: PlanState = dataReady ? plan : "loading";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !dataReady ||
      dataGeneration !== generationRef.current ||
      !title.trim() ||
      !prompt.trim() ||
      !when
    )
      return;
    const generation = generationRef.current;
    setCreating(true);
    try {
      const iso = new Date(when).toISOString();
      const row = await create({
        data: { title: title.trim(), prompt: prompt.trim(), run_at: iso, repeat },
      });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTasks((t) => [...t, row].sort((a, b) => a.run_at.localeCompare(b.run_at)));
      setTitle("");
      setPrompt("");
      setWhen("");
      setRepeat("none");
      toast.success("Task scheduled");
    } catch (err) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(err instanceof Error ? err.message : "Failed to schedule task");
      }
    } finally {
      if (generation === generationRef.current && principalRef.current === principal) {
        setCreating(false);
      }
    }
  };

  const createAutomation = async (draft: AutomationDraft) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    const row = await create({
      data: { title: draft.title, prompt: draft.prompt, run_at: draft.runAt, repeat: draft.repeat },
    });
    if (generation !== generationRef.current || principalRef.current !== principal) return;
    setTasks((current) => [...current, row].sort((a, b) => a.run_at.localeCompare(b.run_at)));
    toast.success("Automation scheduled");
  };

  const togglePause = async (t: ScheduledTask) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    const next = t.status === "paused" ? "scheduled" : "paused";
    try {
      const updated = await update({ data: { id: t.id, status: next } });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTasks((arr) => arr.map((x) => (x.id === t.id ? updated : x)));
    } catch (e) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(e instanceof Error ? e.message : "Failed to update");
      }
    }
  };

  const del = async (t: ScheduledTask) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    try {
      await remove({ data: { id: t.id } });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTasks((arr) => arr.filter((x) => x.id !== t.id));
    } catch (e) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(e instanceof Error ? e.message : "Failed to delete");
      }
    }
  };

  const retry = async (task: ScheduledTask) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    try {
      const updated = await update({ data: { id: task.id, status: "scheduled" } });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTasks((current) => current.map((item) => (item.id === task.id ? updated : item)));
      toast.success("Task queued to retry");
    } catch (error) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(error instanceof Error ? error.message : "Could not retry task");
      }
    }
  };

  return (
    <AppShell>
      <div className="min-h-screen bg-background text-foreground">
        <div className="kova-page kova-secondary-page max-w-3xl">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="w-4 h-4" /> Back to chat
          </Link>

          <div className="flex items-center gap-3 mb-2">
            <Calendar className="w-6 h-6" />
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Scheduled Tasks Status
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mb-8">
            Review scheduled work and its real execution status. New tasks are available only when a
            background runner is configured.
          </p>

          {visiblePlan === "loading" && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}

          {visiblePlan === "signed-out" && (
            <div className="kova-empty-state">
              <Lock className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium mb-1">Sign in to review task history</div>
              <p className="text-sm text-muted-foreground mb-4">
                Background execution is unavailable in this deployment.
              </p>
              <Link
                to="/"
                className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium"
              >
                Go to sign in
              </Link>
            </div>
          )}

          {visiblePlan === "free" && (
            <div className="kova-empty-state">
              <Lock className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium mb-1">Scheduled execution is unavailable</div>
              <p className="text-sm text-muted-foreground mb-4">
                This deployment has no background runner. Upgrading will not enable scheduled
                execution.
              </p>
              <Link
                to="/"
                className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium"
              >
                Back to chat
              </Link>
            </div>
          )}

          {visiblePlan === "error" && (
            <div className="kova-empty-state" role="alert">
              <AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" />
              <div className="font-medium mb-1">Plan status is unavailable</div>
              <p className="text-sm text-muted-foreground mb-4">
                KovaGPT could not safely verify access to Scheduled Tasks. No plan restriction was
                inferred.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium"
              >
                Try again
              </button>
            </div>
          )}

          {visiblePlan === "paid" && (
            <>
              {!executionAvailable ? (
                <div
                  className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
                  role="status"
                >
                  <div className="font-medium">Scheduled execution is not available yet</div>
                  <p className="mt-1 text-muted-foreground">
                    This deployment does not have a background task runner. KovaGPT will not accept
                    new tasks or claim that saved tasks will run. You can still review, pause, or
                    delete previously saved tasks below.
                  </p>
                </div>
              ) : null}
              {executionAvailable ? (
                <div className="mb-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setBuilderOpen(true)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-medium shadow-sm hover:bg-accent"
                  >
                    <WandSparkles className="h-4 w-4" /> Build an automation
                  </button>
                </div>
              ) : null}
              <AutomationBuilder
                open={executionAvailable && builderOpen}
                onOpenChange={setBuilderOpen}
                onCreate={createAutomation}
              />
              {executionAvailable ? (
                <form
                  onSubmit={submit}
                  className="kova-card kova-form-surface p-4 sm:p-5 mb-8 space-y-3"
                >
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Title</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Morning market summary"
                      className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition"
                      maxLength={200}
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      What should Kova do?
                    </label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Summarize the top 5 AI news stories from the last 24 hours."
                      className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition min-h-[90px]"
                      maxLength={4000}
                      required
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">When</label>
                      <input
                        type="datetime-local"
                        value={when}
                        onChange={(e) => setWhen(e.target.value)}
                        className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Repeat</label>
                      <select
                        value={repeat}
                        onChange={(e) => setRepeat(e.target.value as ScheduledTask["repeat"])}
                        className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition"
                      >
                        <option value="none">Once</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={creating}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 disabled:opacity-50 transition active:scale-[0.98]"
                    >
                      <Plus className="w-4 h-4" />
                      {creating ? "Scheduling…" : "Schedule"}
                    </button>
                  </div>
                </form>
              ) : null}

              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold">Your scheduled tasks</h2>
                  <p className="text-xs text-muted-foreground">
                    Times are shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadTasks}
                  disabled={loading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
                </button>
              </div>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Search scheduled tasks</span>
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search tasks"
                    className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm"
                  />
                </label>
                <div
                  className="flex gap-1 overflow-x-auto"
                  role="tablist"
                  aria-label="Task filters"
                >
                  {(["all", "active", "paused", "history", "failed"] as TaskFilter[]).map(
                    (value) => (
                      <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={filter === value}
                        onClick={() => setFilter(value)}
                        className={`min-h-10 shrink-0 rounded-lg px-3 text-sm capitalize ${filter === value ? "bg-foreground text-background" : "bg-accent/50 hover:bg-accent"}`}
                      >
                        {value}
                      </button>
                    ),
                  )}
                </div>
              </div>
              {loadError ? (
                <div
                  className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
                  role="alert"
                >
                  <div className="font-medium">Could not load scheduled tasks</div>
                  <p className="mt-1 text-muted-foreground">{loadError}</p>
                  <button
                    className="mt-3 rounded-lg border border-border px-3 py-2 font-medium"
                    onClick={loadTasks}
                  >
                    Try again
                  </button>
                </div>
              ) : null}
              {loading ? (
                <ul className="flex flex-col gap-2" aria-hidden>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="rounded-xl border border-border p-4">
                      <div className="h-4 w-1/3 rounded bg-muted animate-pulse mb-2" />
                      <div className="h-3 w-2/3 rounded bg-muted animate-pulse mb-3" />
                      <div className="h-3 w-full rounded bg-muted animate-pulse" />
                    </li>
                  ))}
                </ul>
              ) : tasks.length === 0 ? (
                <div className="kova-empty-state">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Calendar className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="text-base font-medium mb-1">Nothing scheduled yet</div>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {executionAvailable
                      ? "Use the form above to schedule a one-time or repeating prompt."
                      : "No historical task records are available for this account."}
                  </p>
                </div>
              ) : visibleTasks.length === 0 ? (
                <div className="kova-empty-state">
                  <div className="font-medium">No matching tasks</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try another search or filter.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {visibleTasks.map((t) => (
                    <li
                      key={t.id}
                      className="kova-row flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{t.title}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                          <Clock className="w-3.5 h-3.5" />
                          {t.next_run_at
                            ? `Next ${new Date(t.next_run_at).toLocaleString()}`
                            : `Originally ${new Date(t.run_at).toLocaleString()}`}{" "}
                          · {t.repeat === "none" ? "Once" : t.repeat}
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-accent/60">
                            {t.status}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {t.prompt}
                        </p>
                        {t.last_run_at ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Last run {new Date(t.last_run_at).toLocaleString()}
                            {t.last_result ? ` · ${t.last_result}` : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        {t.status === "failed" ? (
                          <button
                            onClick={() => retry(t)}
                            disabled={!executionAvailable}
                            className="p-2 rounded-md hover:bg-accent transition"
                            aria-label="Retry failed task"
                            title="Retry"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        ) : null}
                        {["scheduled", "running", "paused"].includes(t.status) ? (
                          <button
                            onClick={() => togglePause(t)}
                            disabled={t.status === "paused" && !executionAvailable}
                            className="p-2 rounded-md hover:bg-accent transition"
                            aria-label={t.status === "paused" ? "Resume" : "Pause"}
                            title={t.status === "paused" ? "Resume" : "Pause"}
                          >
                            {t.status === "paused" ? (
                              <Play className="w-4 h-4" />
                            ) : (
                              <Pause className="w-4 h-4" />
                            )}
                          </button>
                        ) : null}
                        <button
                          onClick={() => del(t)}
                          className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition"
                          aria-label="Delete"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <RelatedWorkspaceItems
          kinds={["project", "research", "context_pack", "file", "memory"]}
          title="Context for automations"
        />
      </div>
    </AppShell>
  );
}
