import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import "@/styles/spec400-management.css";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { usePrincipalSessionPreferences } from "@/hooks/use-principal-session-preferences";
import {
  MAX_MANAGEMENT_QUERY_LENGTH,
  parseScheduledTaskListPreferences,
  SCHEDULED_TASK_LIST_STORAGE_BASE,
} from "@/lib/management-list-preferences.mjs";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import { useTimeFormatPreference } from "@/hooks/use-time-format-preference";
import { formatDisplayDateTime } from "@/lib/time-format";
import { AppShell } from "@/components/AppShell";
import {
  listScheduledTasks,
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
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { AutomationBuilder, type AutomationDraft } from "@/components/AutomationBuilder";
import { ScheduledTaskEditor } from "@/components/ScheduledTaskEditor";
import { ScheduledTaskCopies } from "@/components/ScheduledTaskCopies";
import { ScheduledTaskLastRun } from "@/components/ScheduledTaskLastRun";
import { RelatedWorkspaceItems } from "@/components/WorkspaceIntelligence";
import { useScheduledTaskRunPreviews } from "@/hooks/use-scheduled-task-run-previews";
import { TASK_RUN_PAGE_SIZE } from "@/lib/scheduled-task-run-page";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  browserStoragePrincipal,
  consumePrincipalHandoff,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export const Route = createFileRoute("/scheduled-tasks")({
  component: ScheduledTasksPage,
  validateSearch: (search: Record<string, unknown>): { taskId?: string } => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
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

type AccessState = "loading" | "eligible" | "unavailable" | "signed-out" | "error";
type TaskFilter = "active" | "paused" | "all";
type TaskAction = "paused" | "scheduled" | "retry" | "delete";
type TaskActionFeedback = {
  task: ScheduledTask;
  action: TaskAction;
  request: { expectedUserId: string; id: string; mutationId: string; expectedRevision: number };
  state: "pending" | "error" | "success";
  message: string;
};
type FocusOrigin = {
  trigger: HTMLElement | null;
  url: string;
  principal: string | null;
  generation: number;
};
const taskActionLabels: Record<TaskAction, string> = {
  paused: "pause",
  scheduled: "resume",
  retry: "retry failed run",
  delete: "delete",
};

function ScheduledTasksPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { taskId: requestedTaskId } = Route.useSearch();
  const openedTaskLink = useRef<string | null>(null);
  const taskListLoaded = useRef(false);
  const [taskLinkError, setTaskLinkError] = useState<string | null>(null);
  const userKey = user?.id ?? null;
  const timeFormat = useTimeFormatPreference(userKey, isLoaded);
  const principal = isLoaded ? browserStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const generationRef = useRef(0);
  const [dataPrincipal, setDataPrincipal] = useState<string | null>(null);
  const [dataGeneration, setDataGeneration] = useState(0);
  const [lifecycleVersion, setLifecycleVersion] = useState(0);
  const dataReady =
    principal !== null && dataPrincipal === principal && dataGeneration === generationRef.current;
  const [accessState, setAccessState] = useState<AccessState>("loading");
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<ScheduledTask | "new" | null>(null);
  const [createdTask, setCreatedTask] = useState<ScheduledTask | null>(null);
  const [editorSection, setEditorSection] = useState<"settings" | "history">("settings");
  const editorReturnRef = useRef<{
    trigger: HTMLElement | null;
    url: string;
    principal: string | null;
    generation: number;
  } | null>(null);
  const taskActionButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const mutations = useRef(new Map<string, { revision: number; mutationId: string }>());
  const pendingTaskIdsRef = useRef(new Set<string>());
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());
  const [taskFeedback, setTaskFeedback] = useState<Record<string, TaskActionFeedback>>({});
  const taskFeedbackRefs = useRef(new Map<string, HTMLElement>());
  const actionFocusRef = useRef(new Map<string, { handoff: () => void; cleanup: () => void }>());
  const taskMenuActionsRef = useRef(new Set<string>());
  const [deleteTask, setDeleteTask] = useState<ScheduledTask | null>(null);
  const deleteReturnRef = useRef<(FocusOrigin & { taskId: string }) | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteFeedbackRef = useRef<HTMLDivElement>(null);
  const listRequestRef = useRef(0);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const retryPendingRef = useRef<object | null>(null);
  useEffect(
    () => () => {
      generationRef.current += 1;
      editorReturnRef.current = null;
      deleteReturnRef.current = null;
      for (const focus of actionFocusRef.current.values()) focus.cleanup();
      actionFocusRef.current.clear();
      taskMenuActionsRef.current.clear();
    },
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [{ query, filter }, setListPreferences] = usePrincipalSessionPreferences(
    SCHEDULED_TASK_LIST_STORAGE_BASE,
    isLoaded ? userKey : undefined,
    parseScheduledTaskListPreferences,
  );
  const setQuery = (query: string) => setListPreferences({ query });
  const setFilter = (filter: TaskFilter) => setListPreferences({ filter });
  const [builderOpen, setBuilderOpen] = useState(false);
  const [executionAvailable, setExecutionAvailable] = useState(false);
  const [runRefreshVersion, setRunRefreshVersion] = useState(0);
  const [taskPage, setTaskPage] = useState({ scope: "", index: 0 });
  const [relatedWorkspaceOpen, setRelatedWorkspaceOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [when, setWhen] = useState("");
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly" | "monthly">("daily");

  const list = useServerFn(listScheduledTasks);
  const update = useServerFn(updateScheduledTask);
  const remove = useServerFn(deleteScheduledTask);
  const checkEligible = useServerFn(isScheduledTasksEligible);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setDataPrincipal(null);
    setDataGeneration(generation);
    setAccessState("loading");
    setTasks([]);
    taskListLoaded.current = false;
    openedTaskLink.current = null;
    setTaskLinkError(null);
    setCreatedTask(null);
    editorReturnRef.current = null;
    setEditor(null);
    setDeleteTask(null);
    deleteReturnRef.current = null;
    setTaskFeedback({});
    for (const focus of actionFocusRef.current.values()) focus.cleanup();
    actionFocusRef.current.clear();
    taskMenuActionsRef.current.clear();
    mutations.current.clear();
    pendingTaskIdsRef.current.clear();
    setPendingTaskIds(new Set());
    setLoading(false);
    setCreating(false);
    setLoadError(null);
    retryPendingRef.current = null;
    setBuilderOpen(false);
    setExecutionAvailable(false);
    setRelatedWorkspaceOpen(false);
    setTitle("");
    setPrompt("");
    setWhen("");
    setRepeat("daily");
    if (!principal) return;
    if (!isSignedIn) {
      setDataPrincipal(principal);
      setDataGeneration(generation);
      setAccessState("signed-out");
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
        setAccessState(r.eligible ? "eligible" : "unavailable");
      })
      .catch(() => {
        if (!cancel && generationRef.current === generation && principalRef.current === principal) {
          setDataPrincipal(principal);
          setDataGeneration(generation);
          setAccessState("error");
        }
      });
    return () => {
      cancel = true;
    };
  }, [checkEligible, isSignedIn, lifecycleVersion, principal, userKey]);

  const loadTasks = useCallback(async () => {
    if (pendingTaskIdsRef.current.size > 0) return;
    if (!dataReady || dataGeneration !== generationRef.current || accessState !== "eligible")
      return;
    const generation = generationRef.current;
    const request = ++listRequestRef.current;
    setLoading(true);
    try {
      const next = await list({ data: { expectedUserId: userKey! } });
      if (
        generation !== generationRef.current ||
        principalRef.current !== principal ||
        request !== listRequestRef.current
      )
        return;
      taskListLoaded.current = true;
      setTasks(next);
      setLoadError(null);
      setRunRefreshVersion((value) => value + 1);
    } catch (error) {
      if (
        generation !== generationRef.current ||
        principalRef.current !== principal ||
        request !== listRequestRef.current
      )
        return;
      const message = error instanceof Error ? error.message : "Failed to load tasks";
      setLoadError(message);
      toast.error(message);
    } finally {
      if (
        generation === generationRef.current &&
        principalRef.current === principal &&
        request === listRequestRef.current
      ) {
        setLoading(false);
      }
    }
  }, [accessState, dataGeneration, dataReady, list, principal, userKey]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const openTaskEditor = useCallback(
    (task: ScheduledTask | "new", section: "settings" | "history", trigger: HTMLElement | null) => {
      if (!dataReady || dataGeneration !== generationRef.current) return;
      // Capture the real page control before the portaled dialog or menu moves focus.
      editorReturnRef.current = {
        trigger,
        url: window.location.href,
        principal,
        generation: generationRef.current,
      };
      setEditorSection(section);
      setEditor(task);
    },
    [dataGeneration, dataReady, principal],
  );

  useEffect(() => {
    if (
      !requestedTaskId ||
      !dataReady ||
      loading ||
      !taskListLoaded.current ||
      openedTaskLink.current === requestedTaskId
    )
      return;
    openedTaskLink.current = requestedTaskId;
    const selected = tasks.find((task) => task.id === requestedTaskId);
    if (selected) {
      openTaskEditor(selected, "settings", null);
      setTaskLinkError(null);
    } else
      setTaskLinkError("This scheduled task is unavailable or is not accessible to this account.");
  }, [requestedTaskId, dataReady, loading, tasks, openTaskEditor]);

  const retryLoadTasks = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (loading || retryPendingRef.current || pendingTaskIdsRef.current.size > 0) return;
    const target = event.currentTarget;
    const hadFocus = document.activeElement === target;
    const openedUrl = window.location.href;
    const generation = generationRef.current;
    const attempt = {};
    retryPendingRef.current = attempt;
    try {
      await loadTasks();
    } finally {
      if (retryPendingRef.current === attempt) retryPendingRef.current = null;
      window.requestAnimationFrame(() => {
        // A failed retry keeps its button. Only replace focus after success removes it,
        // and never override a newer focus choice or a changed account/page.
        if (
          !hadFocus ||
          target.isConnected ||
          generationRef.current !== generation ||
          principalRef.current !== principal ||
          document.activeElement !== document.body
        )
          return;
        restoreDialogFocus(refreshButtonRef.current, openedUrl);
      });
    }
  };

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
      editorReturnRef.current = null;
      setDataPrincipal(null);
      setTasks([]);
      setTitle("");
      setPrompt("");
      setWhen("");
      setRepeat("daily");
      setBuilderOpen(false);
      setLifecycleVersion((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [isLoaded, principal, userKey]);

  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (dataReady ? tasks : []).filter((task) => {
      const statusMatch =
        filter === "all" ||
        (filter === "active" && ["scheduled", "running"].includes(task.status)) ||
        (filter === "paused" && task.status === "paused");
      return (
        statusMatch &&
        (!normalized || `${task.title} ${task.prompt}`.toLowerCase().includes(normalized))
      );
    });
  }, [dataReady, filter, query, tasks]);

  const pageScope = JSON.stringify([principal, lifecycleVersion, filter, query]);
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / TASK_RUN_PAGE_SIZE));
  const pageIndex = Math.min(taskPage.scope === pageScope ? taskPage.index : 0, pageCount - 1);
  const visibleTasks = useMemo(
    () => filteredTasks.slice(pageIndex * TASK_RUN_PAGE_SIZE, (pageIndex + 1) * TASK_RUN_PAGE_SIZE),
    [filteredTasks, pageIndex],
  );
  const runPreviews = useScheduledTaskRunPreviews(
    userKey,
    dataReady && accessState === "eligible",
    lifecycleVersion,
    runRefreshVersion,
    visibleTasks,
  );

  const visibleAccess: AccessState = dataReady ? accessState : "loading";

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
    openTaskEditor(
      "new",
      "settings",
      e.nativeEvent instanceof SubmitEvent ? e.nativeEvent.submitter : null,
    );
  };
  const createAutomation = async (draft: AutomationDraft) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    setTitle(draft.title);
    setPrompt(draft.prompt);
    setRepeat(draft.repeat);
    const date = new Date(draft.runAt);
    setWhen(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    openTaskEditor("new", "settings", null);
  };
  const editorFocusOrigin = editorReturnRef.current;
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

  const beginTaskMutation = (id: string) => {
    if (pendingTaskIdsRef.current.has(id)) return false;
    pendingTaskIdsRef.current.add(id);
    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
    // A list requested before this action must not restore an old task revision.
    listRequestRef.current += 1;
    setLoading(false);
    return true;
  };
  const finishTaskMutation = (id: string, generation: number) => {
    if (generation !== generationRef.current || principalRef.current !== principal) return;
    pendingTaskIdsRef.current.delete(id);
    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
  };

  const captureActionFocus = (taskId: string, action: TaskAction, trigger: HTMLElement | null) => {
    actionFocusRef.current.get(taskId)?.cleanup();
    const source = document.activeElement;
    const origin: FocusOrigin = {
      trigger,
      url: window.location.href,
      principal,
      generation: generationRef.current,
    };
    let moved = source === document.body;
    const destination = () =>
      action === "delete" && deleteFeedbackRef.current
        ? deleteFeedbackRef.current
        : taskFeedbackRefs.current.get(taskId);
    const onFocus = (event: FocusEvent) => {
      if (event.target !== source && event.target !== trigger && event.target !== destination())
        moved = true;
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !trigger?.contains(target) &&
        !(source instanceof HTMLElement && source.contains(target)) &&
        !destination()?.contains(target)
      )
        moved = true;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") moved = true;
    };
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    const focus = {
      handoff: () => {
        if (
          moved ||
          principalRef.current !== origin.principal ||
          generationRef.current !== origin.generation
        )
          return;
        const target = destination();
        restoreDialogFocus(target, origin.url);
        if (target && document.activeElement === target)
          target.scrollIntoView({ block: "nearest" });
      },
      cleanup: () => {
        document.removeEventListener("focusin", onFocus, true);
        document.removeEventListener("pointerdown", onPointer, true);
        document.removeEventListener("keydown", onKey, true);
      },
    };
    actionFocusRef.current.set(taskId, focus);
    window.requestAnimationFrame(focus.handoff);
    return focus;
  };

  const runTaskAction = async (
    task: ScheduledTask,
    action: TaskAction,
    trigger: HTMLElement | null,
    savedRequest?: TaskActionFeedback["request"],
  ) => {
    if (!dataReady || dataGeneration !== generationRef.current) return;
    const generation = generationRef.current;
    if (!beginTaskMutation(task.id)) return;
    // Preserve the complete original request after an uncertain response, even if
    // a later refresh changes the displayed revision. The server owns deduplication.
    const request = savedRequest ?? identity(task, action);
    const feedback: TaskActionFeedback = {
      task,
      action,
      request,
      state: "pending",
      message: `${action === "delete" ? "Deleting" : "Saving change for"} “${task.title}”…`,
    };
    setTaskFeedback((current) => ({ ...current, [task.id]: feedback }));
    const focus = captureActionFocus(task.id, action, trigger);
    try {
      const updated =
        action === "delete"
          ? await remove({ data: request })
          : await update({
              data: {
                ...request,
                status: action === "retry" ? "scheduled" : action,
                ...(action === "retry" ? { retry: true } : {}),
              },
            });
      if (generation !== generationRef.current || principalRef.current !== principal) return;
      if (action === "delete") {
        setTasks((current) => current.filter((item) => item.id !== task.id));
        setDeleteTask(null);
      } else {
        setTasks((current) =>
          current.map((item) => (item.id === task.id ? (updated as ScheduledTask) : item)),
        );
      }
      const message =
        action === "delete"
          ? `“${task.title}” deleted.`
          : action === "retry"
            ? `“${task.title}” queued to retry.`
            : `“${task.title}” ${action === "paused" ? "paused" : "resumed"}.`;
      setTaskFeedback((current) => {
        const next = { ...current };
        delete next[task.id];
        next[task.id] = { ...feedback, state: "success", message };
        const completed = Object.keys(next).filter((id) => next[id].state === "success");
        for (const id of completed.slice(0, -3)) {
          // Keep unresolved work and any result the user is currently reading.
          if (!taskFeedbackRefs.current.get(id)?.contains(document.activeElement)) delete next[id];
        }
        return next;
      });
    } catch (error) {
      if (generation === generationRef.current && principalRef.current === principal) {
        const detail = error instanceof Error ? error.message : "The response was interrupted.";
        const message = `Couldn’t confirm ${taskActionLabels[action]} for “${task.title}”. ${detail}`;
        setTaskFeedback((current) => ({
          ...current,
          [task.id]: { ...feedback, state: "error", message },
        }));
      }
    } finally {
      finishTaskMutation(task.id, generation);
      window.requestAnimationFrame(() => {
        if (actionFocusRef.current.get(task.id) !== focus) return;
        // The named status stays mounted even when a successful change removes
        // its source row from the active filter. Never reclaim a user's new focus.
        focus.handoff();
        focus.cleanup();
        actionFocusRef.current.delete(task.id);
      });
    }
  };

  const togglePause = (task: ScheduledTask) => {
    taskMenuActionsRef.current.add(task.id);
    return runTaskAction(
      task,
      task.status === "paused" ? "scheduled" : "paused",
      taskActionButtonsRef.current.get(task.id) ?? null,
    );
  };
  const retry = (task: ScheduledTask) => {
    taskMenuActionsRef.current.add(task.id);
    return runTaskAction(task, "retry", taskActionButtonsRef.current.get(task.id) ?? null);
  };
  const openDelete = (
    task: ScheduledTask,
    trigger: HTMLElement | null = taskActionButtonsRef.current.get(task.id) ?? null,
  ) => {
    if (
      !dataReady ||
      dataGeneration !== generationRef.current ||
      pendingTaskIdsRef.current.has(task.id)
    )
      return;
    deleteReturnRef.current = {
      trigger,
      taskId: task.id,
      url: window.location.href,
      principal,
      generation: generationRef.current,
    };
    setDeleteTask(task);
  };
  const deleteFocusOrigin = deleteReturnRef.current;
  const deleteFeedback = deleteTask ? taskFeedback[deleteTask.id] : undefined;
  const deletePending = !!deleteTask && pendingTaskIds.has(deleteTask.id);

  return (
    <AppShell hideUtilities>
      <div className="min-h-screen bg-background text-foreground">
        <main
          id="main-content"
          className="kova-page kova-secondary-page spec400-management spec400-schedules"
          data-ui-reference="chatgpt.tasks.manager"
          aria-labelledby="scheduled-tasks-title"
        >
          <header className="spec400-page-header">
            <div>
              <h1 id="scheduled-tasks-title" ref={pageHeadingRef} tabIndex={-1}>
                Scheduled tasks
              </h1>
              <p>Run a prompt automatically on a schedule</p>
            </div>
            {visibleAccess === "eligible" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  className="spec400-primary"
                  disabled={!executionAvailable}
                  onClick={(event) => openTaskEditor("new", "settings", event.currentTarget)}
                >
                  <Plus aria-hidden="true" /> New scheduled task
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  ref={refreshButtonRef}
                  onClick={() => {
                    if (!loading) void loadTasks();
                  }}
                  aria-disabled={loading}
                  aria-busy={loading}
                  className="inline-flex items-center gap-2 border border-border text-sm hover:bg-accent aria-disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
            )}
          </header>

          {createdTask && (
            <div role="status" className="mb-4">
              <Button
                variant="ghost"
                className="spec400-created-receipt"
                onClick={(event) => openTaskEditor(createdTask, "settings", event.currentTarget)}
              >
                <Check className="text-green-600" aria-hidden="true" />
                Scheduled task created
              </Button>
            </div>
          )}
          {taskLinkError && (
            <p role="alert" className="spec400-supporting">
              {taskLinkError}
            </p>
          )}
          {visibleAccess === "loading" && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}

          {visibleAccess === "signed-out" && (
            <div className="kova-empty-state">
              <Lock className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium mb-1">Sign in to use Scheduled tasks</div>
              <p className="text-sm text-muted-foreground mb-4">
                Sign in to review your saved tasks and background execution availability.
              </p>
              <Link
                to="/"
                className="kova-button inline-flex items-center justify-center px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium"
              >
                Go to sign in
              </Link>
            </div>
          )}

          {visibleAccess === "unavailable" && (
            <div className="kova-empty-state">
              <Lock className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium mb-1">Scheduled tasks are unavailable</div>
              <p className="text-sm text-muted-foreground mb-4">
                Tasks are included with every signed-in plan. Access could not be confirmed for this
                account. Sign in again or try later.
              </p>
              <Link
                to="/"
                className="kova-button inline-flex items-center justify-center px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium"
              >
                Back to chat
              </Link>
            </div>
          )}

          {visibleAccess === "error" && (
            <div className="kova-empty-state" role="alert">
              <AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" />
              <div className="font-medium mb-1">Scheduled tasks are unavailable</div>
              <p className="text-sm text-muted-foreground mb-4">
                KovaGPT could not safely verify account access to Scheduled Tasks. Try again to
                check availability.
              </p>
              <Button
                variant="outline"
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center border border-border text-sm font-medium"
              >
                Try again
              </Button>
            </div>
          )}

          {visibleAccess === "eligible" && (
            <Tabs value={filter} onValueChange={(value) => setFilter(value as TaskFilter)}>
              {!executionAvailable ? (
                <div
                  className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
                  role="status"
                  aria-label="Scheduled Tasks Status"
                >
                  <div className="font-medium">Scheduled execution is not available yet</div>
                  <p className="mt-1 text-muted-foreground">
                    Background execution is not ready in this deployment. KovaGPT will not accept
                    new tasks or claim that saved tasks will run. You can still review, pause, or
                    delete previously saved tasks below. Upgrading will not enable scheduled
                    execution until this deployment is ready.
                  </p>
                </div>
              ) : null}
              <AutomationBuilder
                timeFormat={timeFormat}
                open={executionAvailable && builderOpen}
                onOpenChange={setBuilderOpen}
                onCreate={createAutomation}
              />
              {userKey && (
                <ScheduledTaskCopies
                  key={principal ?? userKey}
                  tasks={tasks}
                  userKey={userKey}
                  eligible={visibleAccess === "eligible"}
                  onChanged={() => void loadTasks()}
                />
              )}
              {editor && userKey && (
                <ScheduledTaskEditor
                  key={`${principal}:${editor === "new" ? "new" : editor.id + ":" + editor.revision}`}
                  userKey={userKey}
                  initialSection={editorSection}
                  timeFormat={timeFormat}
                  task={editor === "new" ? undefined : editor}
                  draft={editor === "new" ? { title, prompt, localTime: when, repeat } : undefined}
                  executionAvailable={executionAvailable && visibleAccess === "eligible"}
                  onClose={() => setEditor(null)}
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    // A replaced editor must not consume the newer editor's return target.
                    if (!editorFocusOrigin || editorReturnRef.current !== editorFocusOrigin) return;
                    editorReturnRef.current = null;
                    const active = document.activeElement;
                    const focusMoved =
                      active !== null &&
                      active !== document.body &&
                      active !== editorFocusOrigin.trigger &&
                      !(event.target instanceof HTMLElement && event.target.contains(active));
                    const trigger = editorFocusOrigin.trigger;
                    const usableTrigger =
                      trigger?.isConnected &&
                      trigger.getClientRects().length > 0 &&
                      !trigger.closest('[hidden], [inert], [aria-hidden="true"]') &&
                      !trigger.matches(':disabled, [aria-disabled="true"]');
                    restoreDialogFocus(
                      usableTrigger
                        ? trigger
                        : (refreshButtonRef.current ?? pageHeadingRef.current),
                      editorFocusOrigin.url,
                      focusMoved ||
                        principalRef.current !== editorFocusOrigin.principal ||
                        generationRef.current !== editorFocusOrigin.generation,
                    );
                  }}
                  onSaved={() => void loadTasks()}
                  onCreated={(persistedTask) => setCreatedTask(persistedTask)}
                />
              )}
              <AlertDialog
                open={deleteTask !== null}
                onOpenChange={(open) => {
                  if (!open && !deletePending) setDeleteTask(null);
                }}
              >
                <AlertDialogContent
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    deleteCancelRef.current?.focus();
                  }}
                  onEscapeKeyDown={(event) => {
                    if (deletePending) event.preventDefault();
                  }}
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    if (!deleteFocusOrigin || deleteReturnRef.current !== deleteFocusOrigin) return;
                    deleteReturnRef.current = null;
                    const active = document.activeElement;
                    const focusMoved =
                      active !== null &&
                      active !== document.body &&
                      active !== deleteFocusOrigin.trigger &&
                      !(event.target instanceof HTMLElement && event.target.contains(active));
                    const trigger = deleteFocusOrigin.trigger;
                    const usableTrigger =
                      trigger?.isConnected &&
                      trigger.getClientRects().length > 0 &&
                      !trigger.closest('[hidden], [inert], [aria-hidden="true"]') &&
                      !trigger.matches(':disabled, [aria-disabled="true"]');
                    restoreDialogFocus(
                      usableTrigger
                        ? trigger
                        : (taskFeedbackRefs.current.get(deleteFocusOrigin.taskId) ??
                            refreshButtonRef.current ??
                            pageHeadingRef.current),
                      deleteFocusOrigin.url,
                      focusMoved ||
                        principalRef.current !== deleteFocusOrigin.principal ||
                        generationRef.current !== deleteFocusOrigin.generation,
                    );
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{deleteTask?.title}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This deletes the scheduled task and its run history. Pending copy offers will
                      be revoked.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div
                    ref={deleteFeedbackRef}
                    tabIndex={-1}
                    role="region"
                    aria-label={`Delete status for ${deleteTask?.title ?? "scheduled task"}`}
                    aria-busy={deletePending}
                  >
                    {deleteFeedback?.action === "delete" && (
                      <p role={deleteFeedback.state === "error" ? "alert" : "status"}>
                        {deleteFeedback.message}
                        {deleteFeedback.state === "error" &&
                          " Retry the same request to check the outcome."}
                      </p>
                    )}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      ref={deleteCancelRef}
                      aria-disabled={deletePending}
                      onClick={(event) => {
                        if (deletePending) event.preventDefault();
                      }}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      aria-disabled={deletePending}
                      aria-busy={deletePending}
                      onClick={(event) => {
                        // Keep confirmation and its error mounted until the server
                        // confirms success. Radix's default Action would close now.
                        event.preventDefault();
                        if (!deleteTask || deletePending) return;
                        void runTaskAction(
                          deleteFeedback?.action === "delete" ? deleteFeedback.task : deleteTask,
                          "delete",
                          event.currentTarget,
                          deleteFeedback?.action === "delete" ? deleteFeedback.request : undefined,
                        );
                      }}
                    >
                      {deletePending
                        ? "Deleting…"
                        : deleteFeedback?.action === "delete" && deleteFeedback.state === "error"
                          ? "Retry the same delete request"
                          : "Delete scheduled task"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="sr-only">Your scheduled tasks</h2>
                  <p className="text-xs text-muted-foreground">
                    Times are shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                  </p>
                </div>
              </div>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Search scheduled tasks</span>
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    maxLength={MAX_MANAGEMENT_QUERY_LENGTH}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search tasks"
                    className="w-full border border-border bg-background pl-9 pr-3 text-sm"
                  />
                </label>
                <TabsList aria-label="Task filters">
                  {(["active", "paused", "all"] as TaskFilter[]).map((value) => (
                    <TabsTrigger key={value} value={value} className="shrink-0 capitalize">
                      {value}{" "}
                      <span className="spec400-count">
                        {
                          tasks.filter(
                            (task) =>
                              value === "all" ||
                              (value === "active"
                                ? ["scheduled", "running"].includes(task.status)
                                : task.status === "paused"),
                          ).length
                        }
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <TabsContent value={filter} className="mt-0">
                {loadError ? (
                  <div
                    className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
                    role="alert"
                  >
                    <div className="font-medium">This page couldn’t load</div>
                    <p className="mt-1 text-muted-foreground">{loadError}</p>
                    <Button
                      variant="outline"
                      type="button"
                      className="mt-3 border border-border font-medium aria-disabled:opacity-50"
                      onClick={retryLoadTasks}
                      aria-disabled={loading}
                      aria-busy={loading}
                    >
                      {loading ? "Trying again…" : "Try again"}
                    </Button>
                  </div>
                ) : null}
                {Object.values(taskFeedback).map((feedback) => (
                  <section
                    key={feedback.task.id}
                    ref={(element) => {
                      if (element) taskFeedbackRefs.current.set(feedback.task.id, element);
                      else taskFeedbackRefs.current.delete(feedback.task.id);
                    }}
                    tabIndex={-1}
                    aria-label={`Action status for ${feedback.task.title}`}
                    aria-busy={feedback.state === "pending"}
                    className="mb-4 rounded-xl border border-border p-4 text-sm"
                  >
                    <p
                      role={feedback.state === "error" ? "alert" : "status"}
                      aria-live={deleteTask?.id === feedback.task.id ? "off" : undefined}
                    >
                      {feedback.message}
                    </p>
                    {feedback.state === "error" && (
                      <>
                        <p className="mt-1 text-muted-foreground">
                          Retry the same request to check the outcome.
                        </p>
                        <Button
                          variant="outline"
                          type="button"
                          className="mt-3 border border-border font-medium"
                          onClick={(event) => {
                            if (feedback.action === "delete")
                              openDelete(feedback.task, event.currentTarget);
                            else
                              void runTaskAction(
                                feedback.task,
                                feedback.action,
                                event.currentTarget,
                                feedback.request,
                              );
                          }}
                        >
                          Retry{" "}
                          {feedback.action === "retry"
                            ? "failed run"
                            : taskActionLabels[feedback.action]}{" "}
                          for “{feedback.task.title}”
                        </Button>
                      </>
                    )}
                    {feedback.state === "success" && (
                      <Button
                        variant="outline"
                        type="button"
                        className="mt-3 border border-border font-medium"
                        onClick={(event) => {
                          const trigger = event.currentTarget;
                          const hadFocus = document.activeElement === trigger;
                          const url = window.location.href;
                          const generation = generationRef.current;
                          setTaskFeedback((current) => {
                            const next = { ...current };
                            delete next[feedback.task.id];
                            return next;
                          });
                          window.requestAnimationFrame(() => {
                            restoreDialogFocus(
                              taskActionButtonsRef.current.get(feedback.task.id) ??
                                refreshButtonRef.current,
                              url,
                              !hadFocus ||
                                document.activeElement !== document.body ||
                                principalRef.current !== principal ||
                                generationRef.current !== generation,
                            );
                          });
                        }}
                      >
                        Dismiss result for “{feedback.task.title}”
                      </Button>
                    )}
                  </section>
                ))}
                {loading && tasks.length === 0 ? (
                  <ul className="flex flex-col gap-2" aria-hidden>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <li key={i} className="rounded-xl border border-border p-4">
                        <div className="h-4 w-1/3 rounded bg-muted animate-pulse mb-2" />
                        <div className="h-3 w-2/3 rounded bg-muted animate-pulse mb-3" />
                        <div className="h-3 w-full rounded bg-muted animate-pulse" />
                      </li>
                    ))}
                  </ul>
                ) : tasks.length === 0 && loadError ? null : tasks.length === 0 ? (
                  <div className="kova-empty-state">
                    <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                      <Calendar className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="text-base font-medium mb-1">Nothing scheduled yet</div>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      {executionAvailable
                        ? "Create a scheduled task to run a prompt once or on a repeating schedule."
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
                          <button
                            type="button"
                            className="spec400-task-title"
                            data-ui-reference="chatgpt.tasks.task-name"
                            onClick={(event) => openTaskEditor(t, "settings", event.currentTarget)}
                          >
                            {t.title}
                          </button>
                          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5 mt-1">
                            <Clock className="w-3.5 h-3.5" />
                            {t.next_run_at
                              ? `Next ${formatDisplayDateTime(t.next_run_at, timeFormat)}`
                              : `Originally ${formatDisplayDateTime(t.run_at, timeFormat)}`}{" "}
                            ·{" "}
                            {t.trigger_mode === "event"
                              ? "Matching connected events"
                              : t.repeat === "none"
                                ? "Once"
                                : t.repeat}{" "}
                            · Schedule zone: {t.timezone}
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-accent/60">
                              {t.status}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                            {t.prompt}
                          </p>
                          <ScheduledTaskLastRun
                            preview={runPreviews[t.id]}
                            timeFormat={timeFormat}
                            lastRunAt={t.last_run_at}
                            lastResult={t.last_result}
                          />
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              type="button"
                              ref={(element) => {
                                if (element) taskActionButtonsRef.current.set(t.id, element);
                                else taskActionButtonsRef.current.delete(t.id);
                              }}
                              className="spec400-icon-button"
                              aria-label={`More actions for ${t.title}`}
                              disabled={pendingTaskIds.has(t.id)}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onCloseAutoFocus={(event) => {
                              const origin = editorReturnRef.current;
                              // A fast response can finish before Radix closes its
                              // portal. Consume this intent separately from the request.
                              const actionClosed = taskMenuActionsRef.current.delete(t.id);
                              if (
                                (origin &&
                                  origin.trigger === taskActionButtonsRef.current.get(t.id)) ||
                                deleteReturnRef.current?.trigger ===
                                  taskActionButtonsRef.current.get(t.id) ||
                                actionClosed ||
                                actionFocusRef.current.has(t.id)
                              )
                                event.preventDefault();
                            }}
                          >
                            <DropdownMenuItem
                              onSelect={() => {
                                openTaskEditor(
                                  t,
                                  "settings",
                                  taskActionButtonsRef.current.get(t.id) ?? null,
                                );
                              }}
                            >
                              Open
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                openTaskEditor(
                                  t,
                                  "settings",
                                  taskActionButtonsRef.current.get(t.id) ?? null,
                                );
                              }}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                openTaskEditor(
                                  t,
                                  "history",
                                  taskActionButtonsRef.current.get(t.id) ?? null,
                                );
                              }}
                            >
                              View runs
                            </DropdownMenuItem>
                            {["scheduled", "running", "paused"].includes(t.status) && (
                              <DropdownMenuItem
                                disabled={
                                  (t.status === "paused" && !executionAvailable) ||
                                  taskFeedback[t.id]?.state === "error"
                                }
                                onSelect={() => void togglePause(t)}
                              >
                                {t.status === "paused" ? "Resume" : "Pause"}
                              </DropdownMenuItem>
                            )}
                            {t.status === "failed" && (
                              <DropdownMenuItem
                                disabled={
                                  !executionAvailable || taskFeedback[t.id]?.state === "error"
                                }
                                onSelect={() => void retry(t)}
                              >
                                Retry failed run
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              disabled={
                                taskFeedback[t.id]?.state === "error" &&
                                taskFeedback[t.id]?.action !== "delete"
                              }
                              onSelect={() => openDelete(t)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    ))}
                  </ul>
                )}
                {filteredTasks.length > 0 && (
                  <nav
                    aria-label="Scheduled task pages"
                    className="mt-4 flex flex-wrap items-center justify-between gap-2"
                  >
                    <p className="text-xs text-muted-foreground" role="status">
                      Page {pageIndex + 1} of {pageCount} · {filteredTasks.length} matching tasks
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        type="button"
                        className="border border-border text-sm aria-disabled:opacity-50"
                        aria-disabled={pageIndex === 0}
                        onClick={() => {
                          if (pageIndex > 0)
                            setTaskPage({ scope: pageScope, index: pageIndex - 1 });
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        type="button"
                        className="border border-border text-sm aria-disabled:opacity-50"
                        aria-disabled={pageIndex + 1 >= pageCount}
                        onClick={() => {
                          if (pageIndex + 1 < pageCount)
                            setTaskPage({ scope: pageScope, index: pageIndex + 1 });
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </nav>
                )}
              </TabsContent>
              <details
                className="mt-6 rounded-xl border border-border"
                open={relatedWorkspaceOpen}
                onToggle={(event) => setRelatedWorkspaceOpen(event.currentTarget.open)}
              >
                <summary className="min-h-11 cursor-pointer content-center px-3 py-3 text-sm font-medium">
                  Related workspace
                </summary>
                {relatedWorkspaceOpen && (
                  <div className="px-3 pb-3">
                    <p className="text-xs text-muted-foreground">
                      Browse projects, context packs, files, and memories. Browsing does not attach
                      them to a task. Choose context in the task editor to attach it.
                    </p>
                    <RelatedWorkspaceItems
                      kinds={["project", "context_pack", "file", "memory"]}
                      title="Context for automations"
                    />
                  </div>
                )}
              </details>
            </Tabs>
          )}
        </main>
      </div>
    </AppShell>
  );
}
