import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { CORE_LAUNCH_ADVANCED_WORKFLOWS } from "@/lib/core-launch-policy.mjs";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import {
  listScheduledTasks,
  updateScheduledTask,
  deleteScheduledTask,
  isScheduledTasksEligible,
  type ScheduledTask,
} from "@/lib/scheduled-tasks.functions";
import {
  CalendarClock,
  Clock,
  Plus,
  Trash2,
  Pause,
  Play,
  Lock,
  RefreshCw,
  Search,
  RotateCcw,
  WandSparkles,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AutomationBuilder, type AutomationDraft } from "@/components/AutomationBuilder";
import { ScheduledTaskEditor } from "@/components/ScheduledTaskEditor";
import { ScheduledTaskCopies } from "@/components/ScheduledTaskCopies";
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
  validateSearch: (search: Record<string, unknown>): { task?: string } => ({
    task: typeof search.task === "string" && search.task.length <= 100 ? search.task : undefined,
  }),
  head: () => ({
    meta: [
      { title: "KovaGPT Tasks" },
      {
        name: "description",
        content: "Manage saved tasks, schedules, connected event filters, and run history.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type PlanState = "loading" | "free" | "paid" | "signed-out" | "error";
type TaskFilter = "all" | "active" | "paused" | "history" | "failed";

function ScheduledTasksPage() {
  const { task: requestedTask } = Route.useSearch();
  const handledTaskRef = useRef<string | null>(null);
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
  const [pendingDelete, setPendingDelete] = useState<ScheduledTask | null>(null);
  const [editor, setEditor] = useState<ScheduledTask | "new" | null>(null);
  const mutations = useRef(new Map<string, { revision: number; mutationId: string }>());
  const listRequest = useRef(0);
  const activeRead = useRef<number | null>(null);
  const pendingMutations = useRef(new Set<symbol>());
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
    setEditor(null);
    setPendingDelete(null);
    handledTaskRef.current = null;
    mutations.current.clear();
    listRequest.current += 1;
    activeRead.current = null;
    pendingMutations.current.clear();
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
    checkEligible({ data: { expectedUserId: userKey! } })
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
  }, [checkEligible, isSignedIn, lifecycleVersion, principal, userKey]);

  const loadTasks = useCallback(
    async (background = false) => {
      if (
        !dataReady ||
        dataGeneration !== generationRef.current ||
        (plan !== "paid" && plan !== "free") ||
        pendingMutations.current.size > 0 ||
        (background && activeRead.current !== null)
      )
        return;
      const generation = generationRef.current;
      const request = ++listRequest.current;
      activeRead.current = request;
      if (!background) setLoading(true);
      setLoadError(null);
      try {
        const next = await list({ data: { expectedUserId: userKey! } });
        if (
          generation !== generationRef.current ||
          principalRef.current !== principal ||
          request !== listRequest.current
        )
          return;
        setTasks(next);
      } catch (error) {
        if (
          generation !== generationRef.current ||
          principalRef.current !== principal ||
          request !== listRequest.current
        )
          return;
        const message = error instanceof Error ? error.message : "Failed to load tasks";
        setLoadError(message);
        if (!background) toast.error(message);
      } finally {
        if (activeRead.current === request) activeRead.current = null;
        if (
          generation === generationRef.current &&
          principalRef.current === principal &&
          request === listRequest.current
        ) {
          setLoading(false);
        }
      }
    },
    [dataGeneration, dataReady, list, plan, principal, userKey],
  );

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const hasPendingExecution = tasks.some((task) => ["scheduled", "running"].includes(task.status));
  useEffect(() => {
    if (!dataReady || (plan !== "paid" && plan !== "free")) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadTasks(true);
    };
    // Read persisted worker results; this never starts or retries an execution.
    const timer =
      executionAvailable && hasPendingExecution ? window.setInterval(refresh, 15_000) : undefined;
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [dataReady, executionAvailable, hasPendingExecution, loadTasks, plan]);

  useEffect(
    () => () => {
      listRequest.current += 1;
    },
    [],
  );

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
  useEffect(() => {
    if (!dataReady || !requestedTask || loading) return;
    const target = tasks.find((task) => task.id === requestedTask);
    const key = `${principal}:${requestedTask}`;
    if (target && handledTaskRef.current !== key) {
      handledTaskRef.current = key;
      setEditor(target);
    }
  }, [dataReady, loading, principal, requestedTask, tasks]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !dataReady ||
      dataGeneration !== generationRef.current ||
      !title.trim() ||
      !prompt.trim() ||
      !when
    )
      return;
    setEditor("new");
  };
  const createAutomation = async (draft: AutomationDraft) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    setTitle(draft.title);
    setPrompt(draft.prompt);
    setRepeat(draft.repeat);
    const date = new Date(draft.runAt);
    setWhen(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setEditor("new");
  };
  const identity = (task: ScheduledTask, action: string) => {
    const key = task.id + ":" + action;
    const saved = mutations.current.get(key);
    const operation =
      saved?.revision === task.revision
        ? saved
        : { revision: task.revision, mutationId: crypto.randomUUID() };
    mutations.current.set(key, operation);
    return {
      expectedUserId: userKey!,
      id: task.id,
      mutationId: operation.mutationId,
      expectedRevision: operation.revision,
    };
  };

  const beginMutation = () => {
    const pending = Symbol();
    pendingMutations.current.add(pending);
    // A read begun before an edit must not restore an old status or deleted task.
    listRequest.current += 1;
    activeRead.current = null;
    setLoading(false);
    return pending;
  };

  const togglePause = async (t: ScheduledTask) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    const next = t.status === "paused" ? "scheduled" : "paused";
    const pending = beginMutation();
    try {
      const updated = await update({ data: { ...identity(t, next), status: next } });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTasks((arr) => arr.map((x) => (x.id === t.id ? updated : x)));
    } catch (e) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(e instanceof Error ? e.message : "Failed to update");
      }
    } finally {
      pendingMutations.current.delete(pending);
    }
  };

  const del = async (t: ScheduledTask) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    const pending = beginMutation();
    try {
      await remove({ data: identity(t, "delete") });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTasks((arr) => arr.filter((x) => x.id !== t.id));
    } catch (e) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(e instanceof Error ? e.message : "Failed to delete");
      }
    } finally {
      pendingMutations.current.delete(pending);
    }
  };

  const retry = async (task: ScheduledTask) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    const pending = beginMutation();
    try {
      const updated = await update({
        data: { ...identity(task, "retry"), status: "scheduled", retry: true },
      });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      setTasks((current) => current.map((item) => (item.id === task.id ? updated : item)));
      toast.success("Task queued to retry");
    } catch (error) {
      if (generation === generationRef.current && principalRef.current === principal) {
        toast.error(error instanceof Error ? error.message : "Could not retry task");
      }
    } finally {
      pendingMutations.current.delete(pending);
    }
  };

  return (
    <AppShell>
      <div className="min-h-screen bg-background text-foreground">
        <main
          id="main-content"
          tabIndex={-1}
          aria-labelledby="scheduled-tasks-title"
          className="kova-page kova-secondary-page kova-core-page max-w-3xl"
        >
          <WorkspacePageHeader
            title="Scheduled tasks"
            titleId="scheduled-tasks-title"
            description="Let KovaGPT follow up at the right time. Manage schedules and review completed results."
          />
          {visiblePlan === "loading" && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}

          {visiblePlan === "signed-out" && (
            <div className="kova-empty-state">
              <Lock className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium mb-1">Sign in to review task history</div>
              <p className="text-sm text-muted-foreground mb-4">
                Log in to view your tasks and saved results.
              </p>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background"
                >
                  Log in
                </button>
              </SignInButton>
            </div>
          )}

          {visiblePlan === "free" && (
            <div className="kova-empty-state">
              <Lock className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium mb-1">
                Running tasks requires an active Plus or Pro plan
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                You can still review past results and pause or delete existing tasks.
              </p>
              <Link
                to="/pricing"
                className="inline-flex min-h-11 items-center justify-center px-5 py-2 rounded-full bg-foreground text-background text-sm font-medium"
              >
                View plans
              </Link>
            </div>
          )}

          {visiblePlan === "error" && (
            <div className="kova-empty-state" role="alert">
              <AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" />
              <div className="font-medium mb-1">Plan status is unavailable</div>
              <p className="text-sm text-muted-foreground mb-4">
                We couldn’t load your plan details. Try again to check task availability.
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

          {(visiblePlan === "paid" || visiblePlan === "free") && (
            <>
              {!executionAvailable ? (
                <div
                  className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
                  role="status"
                  aria-label="Scheduled Tasks Status"
                >
                  <div className="font-medium">Scheduled tasks are temporarily unavailable</div>
                  <p className="mt-1 text-muted-foreground">
                    New tasks and retries are unavailable right now. You can still review, pause, or
                    delete saved tasks. Upgrading your plan won’t change this availability.
                  </p>
                </div>
              ) : null}
              {CORE_LAUNCH_ADVANCED_WORKFLOWS && executionAvailable && visiblePlan === "paid" ? (
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
              {executionAvailable && visiblePlan === "paid" ? (
                <form
                  onSubmit={submit}
                  className="kova-card kova-task-form kova-form-surface p-4 sm:p-5 mb-8 space-y-3"
                >
                  <div>
                    <label htmlFor="task-title" className="text-sm font-medium">
                      Title
                    </label>
                    <input
                      id="task-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Morning market summary"
                      className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition"
                      maxLength={200}
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="task-prompt" className="text-sm font-medium">
                      What should Kova do?
                    </label>
                    <textarea
                      id="task-prompt"
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
                      <label htmlFor="task-when" className="text-sm font-medium">
                        When
                      </label>
                      <input
                        id="task-when"
                        type="datetime-local"
                        value={when}
                        onChange={(e) => setWhen(e.target.value)}
                        className="mt-1 w-full rounded-lg bg-accent/40 px-3 py-2 text-sm outline-none focus:bg-accent transition"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="task-repeat" className="text-sm font-medium">
                        Repeat
                      </label>
                      <select
                        id="task-repeat"
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

              {userKey && (
                <ScheduledTaskCopies
                  key={principal ?? userKey}
                  tasks={tasks}
                  userKey={userKey}
                  eligible={visiblePlan === "paid"}
                  onChanged={() => void loadTasks()}
                />
              )}
              {editor && userKey && (
                <ScheduledTaskEditor
                  key={`${principal}:${editor === "new" ? "new" : editor.id + ":" + editor.revision}`}
                  userKey={userKey}
                  task={editor === "new" ? undefined : editor}
                  draft={editor === "new" ? { title, prompt, localTime: when, repeat } : undefined}
                  executionAvailable={executionAvailable && visiblePlan === "paid"}
                  onClose={() => setEditor(null)}
                  onSaved={() => void loadTasks()}
                />
              )}
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold">Your scheduled tasks</h2>
                  <p className="text-xs text-muted-foreground">
                    Times are shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadTasks()}
                  disabled={loading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
                </button>
              </div>
              <div className="mb-4 flex min-w-0 flex-col gap-2">
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
                  className="kova-task-filters flex gap-1 overflow-x-auto"
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
                        className={`min-h-10 shrink-0 rounded-lg px-3 text-sm capitalize ${filter === value ? "bg-foreground text-background" : "bg-transparent hover:bg-accent"}`}
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
                    onClick={() => void loadTasks()}
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
                    <CalendarClock className="w-5 h-5 text-muted-foreground" />
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
                        <div className="kova-task-meta text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                          <Clock className="w-3.5 h-3.5" />
                          {t.next_run_at
                            ? `Next ${new Date(t.next_run_at).toLocaleString()}`
                            : `Originally ${new Date(t.run_at).toLocaleString()}`}{" "}
                          ·{" "}
                          {t.trigger_mode === "event"
                            ? "Matching connected events"
                            : t.repeat === "none"
                              ? "Once"
                              : t.repeat}{" "}
                          · {t.timezone}
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
                      <div className="kova-task-actions flex items-center gap-1">
                        <button
                          className="rounded border border-border px-3 py-2 text-sm"
                          onClick={() => setEditor(t)}
                        >
                          Settings and history
                        </button>
                        {t.status === "failed" ? (
                          <button
                            onClick={() => retry(t)}
                            disabled={visiblePlan !== "paid" || !executionAvailable}
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
                            disabled={
                              t.status === "paused" &&
                              (visiblePlan !== "paid" || !executionAvailable)
                            }
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
                          onClick={() => setPendingDelete(t)}
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
        </main>
        <ConfirmActionDialog
          open={Boolean(pendingDelete)}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          title="Delete scheduled task?"
          description={`Delete “${pendingDelete?.title ?? "this task"}” and its run history? Pending copy offers will be revoked.`}
          confirmLabel="Delete task"
          destructive
          onConfirm={() => {
            if (pendingDelete) void del(pendingDelete);
            setPendingDelete(null);
          }}
        />
        {CORE_LAUNCH_ADVANCED_WORKFLOWS && (
          <RelatedWorkspaceItems
            kinds={["project", "context_pack", "file", "memory"]}
            title="Context for automations"
          />
        )}
      </div>
    </AppShell>
  );
}
