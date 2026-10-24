import "@/styles/spec400-management.css";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import { TaskGmailEventSource } from "@/components/TaskGmailEventSource";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { useEffect, useId, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { formatDisplayDateTime, type TimeFormatPreference } from "@/lib/time-format";
import {
  createScheduledTask,
  updateScheduledTask,
  offerScheduledTaskCopy,
  listScheduledTaskRuns,
  listScheduledTaskConnections,
  grantScheduledTaskConnection,
  revokeScheduledTaskConnection,
  listScheduledTaskContextOptions,
  listScheduledTaskResourceOptions,
  type ScheduledTask,
  type TaskConnectionOption,
  type TaskGrantView,
} from "@/lib/scheduled-tasks.functions";
import {
  taskRunStatusLabel,
  taskRunDeliveryLabel,
  taskRunFailureLabel,
} from "@/lib/scheduled-task-run-labels";
import type { TaskContextRef, TaskTrigger, TaskProvider } from "@/lib/scheduled-task-policy.mjs";
import {
  validateScheduledTaskDraft,
  type ScheduledTaskValidationField,
} from "@/lib/scheduled-task-draft-validation";

type Draft = {
  title: string;
  prompt: string;
  localTime?: string;
  run_at?: string;
  repeat: ScheduledTask["repeat"];
};
type Option = { id: string; label: string; projectId?: string };
const control = "min-h-11 w-full rounded-lg border border-border bg-background p-2 text-sm";
const button = "min-h-11 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50";
type ScheduledTaskEditorProps = {
  task?: ScheduledTask;
  draft?: Draft;
  userKey: string;
  executionAvailable: boolean;
  initialSection?: "settings" | "history";
  timeFormat?: TimeFormatPreference;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onSaved: () => void;
  onCreated?: (task: ScheduledTask) => void;
};
export function ScheduledTaskEditor(props: ScheduledTaskEditorProps) {
  return <ScheduledTaskEditorBody key={props.userKey} {...props} />;
}
function ScheduledTaskEditorBody({
  task,
  draft,
  userKey,
  executionAvailable,
  initialSection = "settings",
  timeFormat = "system",
  onClose,
  onCloseAutoFocus,
  onSaved,
  onCreated,
}: ScheduledTaskEditorProps) {
  const [title, setTitle] = useState(task?.title ?? draft?.title ?? ""),
    [prompt, setPrompt] = useState(task?.prompt ?? draft?.prompt ?? "");
  const [timezone, setTimezone] = useState(
    task?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [localTime, setLocalTime] = useState(
    task?.schedule_local?.slice(0, 16) ??
      (draft?.localTime || undefined) ??
      (draft?.run_at
        ? new Date(Date.parse(draft.run_at) - new Date().getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : (() => {
            const date = new Date();
            date.setHours(9, 0, 0, 0);
            if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
            return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16);
          })()),
  );
  const [repeat, setRepeat] = useState<ScheduledTask["repeat"]>(
    task?.repeat ?? draft?.repeat ?? "daily",
  );
  const dateSeparator = localTime.indexOf("T");
  const localDate = dateSeparator === -1 ? localTime : localTime.slice(0, dateSeparator);
  const localClock = dateSeparator === -1 ? "" : localTime.slice(dateSeparator + 1);
  const [mode, setMode] = useState<"time" | "event">(task?.trigger_mode ?? "time");
  const [refs, setRefs] = useState<TaskContextRef[]>(task?.context_refs ?? []),
    [triggers, setTriggers] = useState<TaskTrigger[]>(task?.event_triggers ?? []);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const validationId = useId();
  const [visited, setVisited] = useState<Partial<Record<ScheduledTaskValidationField, boolean>>>(
    {},
  );
  const [validationAttempt, setValidationAttempt] = useState(0);
  const validationSummaryRef = useRef<HTMLDivElement>(null);
  const mutationErrorRef = useRef<HTMLDivElement>(null);
  const mutationFocusRef = useRef<{ cleanup: () => void; reveal?: () => void } | null>(null);
  const saveAttemptRef = useRef(0);
  const [failureFocusAttempt, setFailureFocusAttempt] = useState(0);
  const validationFieldsRef = useRef(new Map<ScheduledTaskValidationField, HTMLElement>());
  const validationErrors = validateScheduledTaskDraft({
    title,
    prompt,
    localTime,
    timezone,
    mode,
    consent,
  });
  const validationError = (field: ScheduledTaskValidationField) =>
    validationAttempt > 0 || visited[field]
      ? validationErrors.find((issue) => issue.field === field)?.message
      : undefined;
  const validationProps = (field: ScheduledTaskValidationField) => ({
    id: `${validationId}-${field}`,
    ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (element) validationFieldsRef.current.set(field, element);
      else validationFieldsRef.current.delete(field);
    },
    "aria-required": true as const,
    "aria-invalid": validationError(field) ? (true as const) : undefined,
    "aria-describedby": validationError(field) ? `${validationId}-${field}-error` : undefined,
    onBlur: () => setVisited((current) => ({ ...current, [field]: true })),
  });
  const validationFeedback = (field: ScheduledTaskValidationField) =>
    validationError(field) ? (
      <span id={`${validationId}-${field}-error`} className="mt-1 block text-xs text-destructive">
        {validationError(field)}
      </span>
    ) : null;
  useEffect(() => {
    if (validationAttempt > 0) validationSummaryRef.current?.focus();
  }, [validationAttempt]);
  const [connections, setConnections] = useState<TaskConnectionOption[]>([]),
    [grants, setGrants] = useState<TaskGrantView[]>([]);
  const [connectionId, setConnectionId] = useState(""),
    [connectionConsent, setConnectionConsent] = useState(false);
  const [kind, setKind] = useState<"library" | "project_file">("library"),
    [options, setOptions] = useState<Option[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [grantId, setGrantId] = useState(""),
    [resources, setResources] = useState<Option[]>([]),
    [resource, setResource] = useState(""),
    [resourceCursor, setResourceCursor] = useState<string | null>(null);
  const [author, setAuthor] = useState(""),
    [contains, setContains] = useState(""),
    [label, setLabel] = useState(""),
    [includeReplies, setIncludeReplies] = useState(false),
    [activity, setActivity] = useState("opened");
  const [email, setEmail] = useState(""),
    [runs, setRuns] = useState<Array<Record<string, unknown>>>([]),
    [runCursor, setRunCursor] = useState<string | null>(null),
    [historyLoaded, setHistoryLoaded] = useState(false);
  const active = useRef(true),
    pending = useRef<{ kind: "create" | "update" | "share"; data: Record<string, unknown> } | null>(
      null,
    ),
    busyRef = useRef(false),
    operationIds = useRef(new Map<string, string>()),
    sourceRead = useRef(0),
    resourceRead = useRef(0),
    historyRead = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null),
    editorRef = useRef<HTMLFormElement | null>(null),
    headingRef = useRef<HTMLHeadingElement | null>(null),
    historySummaryRef = useRef<HTMLElement | null>(null),
    returnFocusRef = useRef<HTMLElement | null>(null),
    fallbackFocusRef = useRef<HTMLElement | null>(null);
  const opensHistory = initialSection === "history" && Boolean(task);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discardDecisionRef = useRef<"closed" | "pending" | "discard">("closed"),
    discardReturnRef = useRef<HTMLElement | null>(null),
    keepEditingRef = useRef<HTMLButtonElement | null>(null);
  const create = useServerFn(createScheduledTask),
    update = useServerFn(updateScheduledTask),
    share = useServerFn(offerScheduledTaskCopy),
    history = useServerFn(listScheduledTaskRuns);
  const listConnections = useServerFn(listScheduledTaskConnections),
    grantConnection = useServerFn(grantScheduledTaskConnection),
    revokeConnection = useServerFn(revokeScheduledTaskConnection),
    listOptions = useServerFn(listScheduledTaskContextOptions),
    listResources = useServerFn(listScheduledTaskResourceOptions);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      saveAttemptRef.current += 1;
      mutationFocusRef.current?.cleanup();
      mutationFocusRef.current = null;
    };
  }, [userKey]);
  useEffect(() => {
    const focus = mutationFocusRef.current;
    if (busy || !error || !focus?.reveal) return;
    // Wait for the error and recovery controls to be committed before revealing
    // them. A frame queued directly from the request can precede that commit.
    let canceled = false;
    window.requestAnimationFrame(() => {
      if (!canceled) focus.reveal?.();
    });
    return () => {
      canceled = true;
    };
  }, [busy, error, failureFocusAttempt]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const focused = editor.ownerDocument.activeElement;
    if (
      focused instanceof HTMLElement &&
      focused !== editor.ownerDocument.body &&
      !editor.contains(focused)
    ) {
      returnFocusRef.current = focused;
    }
    fallbackFocusRef.current =
      editor.nextElementSibling?.querySelector<HTMLElement>("h2") ??
      editor.closest("main")?.querySelector<HTMLElement>("h1") ??
      null;
    if (!opensHistory) headingRef.current?.focus();
  }, [userKey, opensHistory]);
  useEffect(() => {
    let canceled = false;
    listConnections({ data: { expectedUserId: userKey } })
      .then((value) => {
        if (!canceled && active.current) {
          setConnections(value.connections);
          setGrants(value.grants);
        }
      })
      .catch(() => {
        if (!canceled && active.current)
          setError("Connections could not be loaded. Refresh this task before selecting one.");
      });
    return () => {
      canceled = true;
    };
  }, [listConnections, userKey]);
  const fail = (reason: unknown) => {
    if (active.current)
      setError(reason instanceof Error ? reason.message : "The action could not be confirmed.");
  };
  const initialDraft = useRef(
    JSON.stringify({ title, prompt, timezone, localTime, repeat, mode, refs, triggers }),
  );
  const dirty =
    initialDraft.current !==
    JSON.stringify({ title, prompt, timezone, localTime, repeat, mode, refs, triggers });
  function closeEditor(force = false) {
    if (!force && (busyRef.current || discardDecisionRef.current !== "closed")) return;
    if (!force && dirty) {
      const editor = editorRef.current;
      const focused = editor?.ownerDocument.activeElement;
      discardReturnRef.current =
        focused instanceof HTMLElement && editor?.contains(focused) ? focused : headingRef.current;
      discardDecisionRef.current = "pending";
      setDiscardOpen(true);
      return;
    }
    const editor = editorRef.current;
    const page = editor?.closest("main") ?? editor?.parentElement;
    const trigger = returnFocusRef.current;
    const fallback = fallbackFocusRef.current;
    onClose();
    // The page's explicit opener is restored by Radix after the focus scope closes.
    if (onCloseAutoFocus) return;
    window.requestAnimationFrame(() => {
      if (!editor || !page?.isConnected) return;
      const document = editor.ownerDocument;
      const focused = document.activeElement;
      // Leave focus alone if navigation or another interaction already moved it.
      if (
        focused instanceof HTMLElement &&
        focused !== document.body &&
        focused !== trigger &&
        !editor.contains(focused)
      )
        return;
      const usable = (element: HTMLElement | null) =>
        element?.isConnected &&
        !element.matches(":disabled, [aria-disabled='true']") &&
        !element.closest("[hidden], [inert]") &&
        element.getClientRects().length > 0;
      // Saving reloads the task list, which may remove the original row entirely.
      const target = usable(trigger) ? trigger : usable(fallback) ? fallback : null;
      if (target) {
        if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1;
        target.focus();
      }
    });
  }
  const stableId = (key: string) => {
    const existing = operationIds.current.get(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    operationIds.current.set(key, id);
    return id;
  };
  async function send(
    operation: {
      kind: "create" | "update" | "share";
      data: Record<string, unknown>;
    },
    submitter?: HTMLElement | null,
  ) {
    if (busyRef.current) return;
    const attempt = ++saveAttemptRef.current;
    const source = submitter ?? document.activeElement;
    const openedUrl = window.location.href;
    let focusMoved = !(source instanceof HTMLElement) || !editorRef.current?.contains(source);
    const onFocus = (event: FocusEvent) => {
      // Disabling Save can blur it to body. Radix then focuses its scroll
      // surface when the loading label is removed; that is not user movement.
      if (
        event.target === dialogRef.current &&
        source instanceof HTMLElement &&
        (!source.isConnected || source.matches(":disabled"))
      )
        return;
      if (event.target !== source && event.target !== document.body) focusMoved = true;
    };
    const onPointer = (event: PointerEvent) => {
      if (!(
        source instanceof HTMLElement &&
        event.target instanceof Node &&
        source.contains(event.target)
      ))
        focusMoved = true;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") focusMoved = true;
    };
    mutationFocusRef.current?.cleanup();
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    const focus: { cleanup: () => void; reveal?: () => void } = {
      cleanup: () => {
        document.removeEventListener("focusin", onFocus, true);
        document.removeEventListener("pointerdown", onPointer, true);
        document.removeEventListener("keydown", onKey, true);
      },
    };
    mutationFocusRef.current = focus;
    let failed = false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    pending.current = operation;
    try {
      if (operation.kind === "create") {
        const persistedTask = await create({
          data: { ...operation.data, expectedUserId: userKey },
        });
        if (active.current) onCreated?.(persistedTask);
      } else if (operation.kind === "update")
        await update({ data: { ...operation.data, expectedUserId: userKey } });
      else await share({ data: { ...operation.data, expectedUserId: userKey } });
      if (!active.current) return;
      pending.current = null;
      onSaved();
      closeEditor(true);
    } catch (reason) {
      failed = true;
      fail(reason);
    } finally {
      busyRef.current = false;
      if (active.current) setBusy(false);
      if (!failed || !active.current) {
        focus.cleanup();
        if (mutationFocusRef.current === focus) mutationFocusRef.current = null;
      } else {
        focus.reveal = () => {
          if (mutationFocusRef.current !== focus) return;
          if (
            failed &&
            active.current &&
            saveAttemptRef.current === attempt &&
            pending.current === operation &&
            !focusMoved
          ) {
            const target = mutationErrorRef.current;
            restoreDialogFocus(target, openedUrl);
            // The footer can be well below the persistent recovery controls.
            // Reveal them only when this submission still owns the user's focus.
            if (target && document.activeElement === target) {
              // DialogContent owns scrolling on desktop and fullscreen phones.
              // The error follows the heading, so reveal the top directly rather
              // than relying on scrolling a non-scrollable form or the page.
              if (dialogRef.current?.contains(target)) dialogRef.current.scrollTop = 0;
              else target.scrollIntoView({ block: "nearest" });
            }
          }
          focus.cleanup();
          mutationFocusRef.current = null;
        };
        setFailureFocusAttempt(attempt);
      }
    }
  }
  function save(submitter?: HTMLElement | null) {
    if (pending.current) {
      void send(pending.current, submitter);
      return;
    }
    if (
      busyRef.current ||
      task?.status === "running" ||
      (!task && !executionAvailable) ||
      (mode === "event" && !triggers.length)
    )
      return;
    if (validationErrors.length > 0) {
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    setValidationAttempt(0);
    const payload = {
      title,
      prompt,
      timezone,
      repeat: mode === "event" ? "none" : repeat,
      triggerMode: mode,
      contextRefs: refs,
      eventTriggers: mode === "event" ? triggers : [],
      ...(mode === "time" ? { localTime } : {}),
    };
    void send(
      {
        kind: task ? "update" : "create",
        data: {
          expectedUserId: userKey,
          ...payload,
          id: task?.id ?? stableId("new-task"),
          mutationId: stableId("save"),
          ...(task ? { expectedRevision: task.revision } : {}),
        },
      },
      submitter,
    );
  }
  async function loadFiles(more = false) {
    const request = ++sourceRead.current;
    setError("");
    try {
      const result = await listOptions({
        data: { expectedUserId: userKey, kind, after: more ? cursor : null },
      });
      if (active.current && sourceRead.current === request) {
        setOptions((previous) => (more ? [...previous, ...result.items] : result.items));
        setCursor(result.nextCursor);
      }
    } catch (reason) {
      if (sourceRead.current === request) fail(reason);
    }
  }
  async function loadResources(more = false) {
    if (!grantId) return;
    const request = ++resourceRead.current;
    setError("");
    try {
      const result = await listResources({
        data: { expectedUserId: userKey, grantId, cursor: more ? resourceCursor : null },
      });
      if (active.current && resourceRead.current === request) {
        setResources((previous) => (more ? [...previous, ...result.items] : result.items));
        setResourceCursor(result.nextCursor);
      }
    } catch (reason) {
      if (resourceRead.current === request) fail(reason);
    }
  }
  async function authorizeConnection() {
    const connection = connections.find((value) => value.id === connectionId);
    if (!connection || !connectionConsent || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await grantConnection({
        data: {
          expectedUserId: userKey,
          id: stableId("grant:" + connection.id + ":" + connection.generation),
          connectionId: connection.id,
          provider: connection.provider,
          generation: connection.generation,
          account: connection.account,
          consent: true,
        },
      });
      const result = await listConnections({ data: { expectedUserId: userKey } });
      if (active.current) {
        setGrants(result.grants);
        setConnections(result.connections);
        setConnectionConsent(false);
      }
    } catch (reason) {
      fail(reason);
    } finally {
      busyRef.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function revoke(grant: TaskGrantView) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await revokeConnection({ data: { expectedUserId: userKey, id: grant.id } });
      if (active.current) {
        setGrants((current) => current.filter((item) => item.id !== grant.id));
        onSaved();
        closeEditor(true);
      }
    } catch (reason) {
      fail(reason);
    } finally {
      busyRef.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function loadHistory(more = false) {
    if (!task) return;
    const request = ++historyRead.current;
    setError("");
    try {
      const data = await history({
        data: {
          expectedUserId: userKey,
          taskId: task.id,
          ...(more && runCursor ? { before: runCursor } : {}),
        },
      });
      if (active.current && request === historyRead.current) {
        const rows = data as Array<Record<string, unknown>>;
        setRuns((previous) => (more ? [...previous, ...rows] : rows));
        setRunCursor(rows.length === 50 ? String(rows.at(-1)?.scheduled_for) : null);
        setHistoryLoaded(true);
      }
    } catch (reason) {
      if (request === historyRead.current) fail(reason);
    }
  }
  useEffect(() => {
    if (initialSection === "history" && task) void loadHistory();
    // A newly opened history view reads its own task once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection, task?.id]);
  const selectedGrant = grants.find((value) => value.id === grantId);
  const snapshot = refs.find((ref) => ref.kind === "snapshot");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) closeEditor();
      }}
    >
      <DialogContent
        ref={dialogRef}
        className="spec400-schedule-dialog"
        onOpenAutoFocus={(event) => {
          if (!opensHistory || !active.current) return;
          const summary = historySummaryRef.current;
          if (!summary?.isConnected || !dialogRef.current?.contains(summary)) return;
          const focused = summary.ownerDocument.activeElement;
          if (
            focused instanceof HTMLElement &&
            focused !== summary.ownerDocument.body &&
            !dialogRef.current.contains(focused)
          ) {
            returnFocusRef.current = focused;
          }
          restoreDialogFocus(summary, window.location.href);
          if (summary.ownerDocument.activeElement === summary) {
            event.preventDefault();
            summary.scrollIntoView({ block: "start" });
          }
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        onInteractOutside={(event) => {
          if (busy || dirty) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busyRef.current || discardDecisionRef.current !== "closed") event.preventDefault();
        }}
      >
        <form
          ref={editorRef}
          className="spec400-schedule-editor space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const submitter = (event.nativeEvent as SubmitEvent | undefined)?.submitter;
            save(submitter instanceof HTMLElement ? submitter : undefined);
          }}
        >
          <DialogDescription className="sr-only">
            Review the prompt, schedule, and context before saving.
          </DialogDescription>
          <div className="flex justify-between gap-3">
            <DialogTitle asChild>
              <h2 ref={headingRef} tabIndex={-1} className="font-semibold">
                {task ? task.title : "New scheduled task"}
              </h2>
            </DialogTitle>
          </div>
          {validationAttempt > 0 && validationErrors.length > 0 && (
            <div
              ref={validationSummaryRef}
              tabIndex={-1}
              role="alert"
              aria-labelledby={`${validationId}-summary`}
              className="rounded-lg border border-destructive p-3 text-sm"
            >
              <p id={`${validationId}-summary`} className="font-medium">
                Check these fields before saving
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validationErrors.map((issue) => (
                  <li key={issue.field}>
                    <a
                      href={`#${validationId}-${issue.field}`}
                      className="underline underline-offset-2"
                      onClick={(event) => {
                        event.preventDefault();
                        validationFieldsRef.current.get(issue.field)?.focus();
                      }}
                    >
                      {issue.label}: {issue.message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <div
              ref={mutationErrorRef}
              tabIndex={-1}
              role="alert"
              aria-label="Scheduled task action failed"
              className="rounded-lg border border-destructive p-3 text-sm"
            >
              {!task && pending.current?.kind === "create" && (
                <p className="font-medium">Couldn’t confirm task creation</p>
              )}
              {error}
              {pending.current && (
                <p className="mt-2">
                  The same request is kept for a safe retry. Refresh task history before starting a
                  different request.
                </p>
              )}
            </div>
          )}
          {pending.current && (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={(event) =>
                pending.current && void send(pending.current, event?.currentTarget)
              }
            >
              Retry the same request
            </button>
          )}
          <fieldset
            disabled={busy || Boolean(pending.current) || task?.status === "running"}
            className="space-y-3"
          >
            <h3 className="text-base font-semibold">What should Kova do?</h3>
            <label className="block text-sm">
              Title
              <input
                {...validationProps("title")}
                className={control}
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
              {validationFeedback("title")}
            </label>
            <label className="block text-sm">
              Prompt
              <textarea
                {...validationProps("prompt")}
                className={`${control} min-h-[120px]`}
                value={prompt}
                maxLength={4000}
                onChange={(event) => setPrompt(event.target.value)}
              />
              {validationFeedback("prompt")}
            </label>
            <h3 className="pt-3 text-base font-semibold">When should it run?</h3>
            <label className="block text-sm">
              Run when
              <select
                className={control}
                value={mode}
                onChange={(event) => setMode(event.target.value as "time" | "event")}
              >
                <option value="time">A scheduled time arrives</option>
                <option value="event">A connected event matches</option>
              </select>
            </label>
            {mode === "time" && (
              <>
                <label className="block text-sm">
                  Frequency
                  <select
                    className={control}
                    value={repeat}
                    onChange={(event) => setRepeat(event.target.value as ScheduledTask["repeat"])}
                  >
                    <option value="none">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                {repeat === "weekly" && (
                  <label className="block text-sm">
                    Weekday
                    <select
                      className={control}
                      value={
                        localTime ? new Date(`${localTime.slice(0, 10)}T12:00:00Z`).getUTCDay() : 1
                      }
                      onChange={(event) => {
                        const day = new Date(`${localTime.slice(0, 10)}T12:00:00Z`);
                        if (!Number.isFinite(day.getTime())) return;
                        day.setUTCDate(
                          day.getUTCDate() +
                            ((Number(event.target.value) - day.getUTCDay() + 7) % 7),
                        );
                        setLocalTime(
                          `${day.toISOString().slice(0, 10)}T${localTime.slice(11) || "09:00"}`,
                        );
                      }}
                    >
                      {[
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ].map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="spec400-form-row">
                  <label className="block text-sm">
                    {repeat === "none" ? "Date" : "Start date"}
                    <input
                      {...validationProps("date")}
                      className={control}
                      type="date"
                      value={localDate}
                      onChange={(event) => setLocalTime(`${event.target.value}T${localClock}`)}
                    />
                    {validationFeedback("date")}
                  </label>
                  <label className="block text-sm">
                    Time
                    <input
                      {...validationProps("time")}
                      className={control}
                      type="time"
                      value={localClock.slice(0, 5)}
                      onChange={(event) => setLocalTime(`${localDate}T${event.target.value}`)}
                    />
                    {validationFeedback("time")}
                  </label>
                </div>
                <details className="text-sm text-muted-foreground">
                  <summary className="min-h-11 cursor-pointer py-3">
                    Clock changes and month-end rules
                  </summary>
                  <p>
                    Recurrence keeps this local time. A missing spring clock time advances by the
                    clock gap; a repeated autumn clock time uses the later occurrence. Monthly tasks
                    use the original day, or the last day of a shorter month.
                  </p>
                </details>
              </>
            )}
            <label className="block text-sm">
              Timezone
              <input
                {...validationProps("timezone")}
                className={control}
                list={`${validationId}-timezones`}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="America/New_York"
              />
              {validationFeedback("timezone")}
              <datalist id={`${validationId}-timezones`}>
                {Array.from(
                  new Set([
                    timezone,
                    "UTC",
                    ...((
                      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
                    ).supportedValuesOf?.("timeZone") ?? []),
                  ]),
                ).map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </label>
            <p className="spec400-supporting">
              {timezone === "UTC"
                ? "Coordinated Universal Time"
                : timezone.replaceAll("_", " ").split("/").join(" / ")}
              {" · "}Selected zone: <span className="font-mono">{timezone || "Not selected"}</span>
            </p>
            {!task && (
              <p className="spec400-supporting">
                Defaults to this device’s timezone. Review it before saving; an account timezone is
                not available in this version.
              </p>
            )}
            <section className="spec400-schedule-preview" aria-label="Upcoming runs">
              <h3>Next confirmed run</h3>
              {task?.next_run_at && !dirty && (
                <p>
                  Next confirmed run:{" "}
                  {formatDisplayDateTime(task.next_run_at, timeFormat, {
                    timeZone: task.timezone,
                  })}{" "}
                  ({task.timezone})
                </p>
              )}
              <p className="spec400-supporting">
                The scheduler resolves run times when saving. A three-run preview is not available
                from the current scheduling service.
              </p>
            </section>
            <section aria-label="Notification preference">
              <h3>Notifications</h3>
              <p className="spec400-supporting">
                Results use the existing account delivery settings. A separate notification
                preference per task is not supported.
              </p>
            </section>
            <details className="rounded-lg border border-border p-3">
              <summary>Saved chat or uploaded context ({refs.length}/8)</summary>
              <p className="my-2 text-xs text-muted-foreground">
                Paste an explicit saved conversation excerpt, or select indexed text from your
                Library and Projects. A saved excerpt is not synchronized with future chat messages.
                Source access is checked again for every run.
              </p>
              <label className="block text-sm">
                Saved conversation excerpt
                <textarea
                  className={control}
                  maxLength={14000}
                  value={snapshot?.kind === "snapshot" ? snapshot.text : ""}
                  onChange={(event) => {
                    const text = event.target.value;
                    setRefs((current) => [
                      ...current.filter((ref) => ref.kind !== "snapshot"),
                      ...(text
                        ? [
                            {
                              kind: "snapshot" as const,
                              text,
                              sourceChatId: "task-saved-excerpt",
                              capturedAt: new Date().toISOString(),
                            },
                          ]
                        : []),
                    ]);
                  }}
                />
              </label>
              <div className="my-2 flex gap-2">
                <select
                  className={control}
                  value={kind}
                  onChange={(event) => {
                    sourceRead.current++;
                    setKind(event.target.value as "library" | "project_file");
                    setOptions([]);
                    setCursor(null);
                  }}
                >
                  <option value="library">Library text</option>
                  <option value="project_file">Project files</option>
                </select>
                <button type="button" className={button} onClick={() => void loadFiles()}>
                  Browse
                </button>
              </div>
              {options.length > 0 && (
                <SearchablePicker
                  aria-label="File to add"
                  className={control}
                  value=""
                  onValueChange={(value) => {
                    const option = options.find((item) => item.id === value);
                    if (option && refs.length < 8)
                      setRefs((current) => [
                        ...current,
                        kind === "library"
                          ? { kind: "library", id: option.id }
                          : { kind: "project_file", id: option.id, projectId: option.projectId! },
                      ]);
                  }}
                  placeholder="Choose a file to add"
                  searchLabel="Search files"
                  options={options.map((item) => ({ value: item.id, label: item.label }))}
                />
              )}
              {cursor && (
                <button type="button" className={button} onClick={() => void loadFiles(true)}>
                  Load more files
                </button>
              )}
              {refs
                .filter((ref) => ref.kind !== "snapshot")
                .map((ref, index) => (
                  <div className="my-2 flex justify-between text-sm" key={index}>
                    <span>
                      {ref.kind === "connected"
                        ? `${ref.provider} · ${ref.resource}`
                        : (options.find((option) => option.id === ref.id)?.label ??
                          "Saved " + ref.kind.replace("_", " "))}
                    </span>
                    <button
                      type="button"
                      className={button}
                      onClick={() => setRefs((current) => current.filter((item) => item !== ref))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
            </details>
            <details className="rounded-lg border border-border p-3" open={mode === "event"}>
              <summary>Connected sources and event filters</summary>
              <p className="my-2 text-xs text-muted-foreground">
                Choose a personal connected account and explicitly allow background reads.
                Workspace-bound accounts are unavailable until organization access is configured.
                Approval expires after 30 days and stops when the connection changes. Copies sent to
                someone else never include these approvals or context.
              </p>
              <SearchablePicker
                aria-label="Connected account"
                className={control}
                value={connectionId}
                onValueChange={(value) => {
                  setConnectionId(value);
                  setConnectionConsent(false);
                }}
                placeholder="Choose a connected account"
                searchLabel="Search connected accounts"
                options={connections.map((connection) => ({
                  value: connection.id,
                  label: `${connection.provider} · ${connection.label}`,
                }))}
              />
              <label className="my-2 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={connectionConsent}
                  onChange={(event) => setConnectionConsent(event.target.checked)}
                />
                Allow this account to read the sources I select for background tasks.
              </label>
              <button
                type="button"
                className={button}
                disabled={!connectionConsent || !connectionId}
                onClick={() => void authorizeConnection()}
              >
                Approve background reads
              </button>
              <div className="my-3 space-y-2">
                {grants.map((grant) => (
                  <div key={grant.id} className="flex justify-between gap-2 text-xs">
                    <span>
                      {grant.provider} ·{" "}
                      {connections.find((item) => item.id === grant.connection_ref)?.label ??
                        "Saved account"}{" "}
                      · expires {new Date(grant.expires_at).toLocaleDateString()}
                    </span>
                    <button type="button" className={button} onClick={() => void revoke(grant)}>
                      Revoke and pause affected tasks
                    </button>
                  </div>
                ))}
              </div>
              <SearchablePicker
                aria-label="Task background approval"
                className={control}
                value={grantId}
                onValueChange={(value) => {
                  resourceRead.current++;
                  setGrantId(value);
                  setResources([]);
                  setResource("");
                  setResourceCursor(null);
                }}
                placeholder="Choose a task approval"
                searchLabel="Search task approvals"
                options={grants.map((grant) => ({
                  value: grant.id,
                  label: `${grant.provider} · ${connections.find((item) => item.id === grant.connection_ref)?.label ?? "Saved account"}`,
                }))}
              />
              {mode === "event" && selectedGrant?.provider === "gmail" && (
                <TaskGmailEventSource
                  key={`${userKey}:${selectedGrant.id}`}
                  userId={userKey}
                  grantId={selectedGrant.id}
                />
              )}
              <button
                type="button"
                className={button}
                disabled={!grantId}
                onClick={() => void loadResources()}
              >
                Browse readable sources
              </button>
              {resources.length > 0 && (
                <SearchablePicker
                  aria-label="Connected source"
                  className={control}
                  value={resource}
                  onValueChange={setResource}
                  placeholder="Choose a source"
                  searchLabel="Search connected sources"
                  options={resources.map((item) => ({ value: item.id, label: item.label }))}
                />
              )}
              {resourceCursor && (
                <button type="button" className={button} onClick={() => void loadResources(true)}>
                  Load more sources
                </button>
              )}
              <button
                type="button"
                className={button}
                disabled={!resource || !selectedGrant || refs.length >= 8}
                onClick={() =>
                  selectedGrant &&
                  setRefs((current) => [
                    ...current,
                    {
                      kind: "connected",
                      grantId: selectedGrant.id,
                      provider: selectedGrant.provider,
                      resource,
                    },
                  ])
                }
              >
                Add source to saved context
              </button>
              {mode === "event" && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs">
                    A task can match up to three event filters. It cannot also use a time schedule.
                    Native provider registration must be active; choosing a filter does not register
                    a webhook.
                  </p>
                  <label className="block text-sm">
                    Sender or author (optional)
                    <input
                      className={control}
                      value={author}
                      maxLength={120}
                      onChange={(event) => setAuthor(event.target.value)}
                      placeholder={
                        selectedGrant?.provider === "gmail"
                          ? "sender@example.com"
                          : "Exact author account"
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    Subject or title contains (optional)
                    <input
                      className={control}
                      value={contains}
                      maxLength={120}
                      onChange={(event) => setContains(event.target.value)}
                    />
                  </label>
                  {selectedGrant?.provider === "github" && (
                    <>
                      <label className="block text-sm">
                        Label (optional)
                        <input
                          className={control}
                          value={label}
                          maxLength={120}
                          onChange={(event) => setLabel(event.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        Pull request activity
                        <select
                          className={control}
                          value={activity}
                          onChange={(event) => setActivity(event.target.value)}
                        >
                          {["opened", "synchronize", "closed", "review", "comment", "merged"].map(
                            (item) => (
                              <option key={item}>{item}</option>
                            ),
                          )}
                        </select>
                      </label>
                    </>
                  )}
                  {selectedGrant?.provider === "slack" && (
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={includeReplies}
                        onChange={(event) => setIncludeReplies(event.target.checked)}
                      />
                      Include replies in this channel
                    </label>
                  )}
                  <button
                    type="button"
                    className={button}
                    disabled={
                      !selectedGrant ||
                      triggers.length >= 3 ||
                      (selectedGrant.provider !== "gmail" && !resource)
                    }
                    onClick={() => {
                      if (selectedGrant)
                        setTriggers((current) => [
                          ...current,
                          {
                            provider: selectedGrant.provider as TaskProvider,
                            grantId: selectedGrant.id,
                            resource: selectedGrant.provider === "gmail" ? "inbox" : resource,
                            ...(author ? { author } : {}),
                            ...(contains ? { contains } : {}),
                            ...(label && selectedGrant.provider === "github" ? { label } : {}),
                            ...(selectedGrant.provider === "slack" ? { includeReplies } : {}),
                            ...(selectedGrant.provider === "github"
                              ? { activities: [activity] }
                              : {}),
                          },
                        ]);
                    }}
                  >
                    Add event filter
                  </button>
                  {triggers.map((trigger, index) => (
                    <div className="flex justify-between text-sm" key={index}>
                      <span>
                        {trigger.provider} · {trigger.resource}
                        {trigger.author ? ` · ${trigger.author}` : ""}
                        {trigger.contains ? ` · contains ${trigger.contains}` : ""}
                      </span>
                      <button
                        type="button"
                        className={button}
                        onClick={() =>
                          setTriggers((current) => current.filter((_, i) => i !== index))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </details>
            <h3 className="pt-3 text-base font-semibold">Review task</h3>
            <p className="spec400-supporting">
              {mode === "event"
                ? "Runs when the selected connected-event filters match."
                : `${repeat === "none" ? "Once" : repeat.charAt(0).toUpperCase() + repeat.slice(1)} at ${localClock.slice(0, 5) || "a time you choose"} (${timezone || "choose a timezone"}).`}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                {...validationProps("consent")}
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              {task
                ? "Save these settings in a paused state. I will review and resume the task separately."
                : "Run this prompt in the background using the selected context and my account usage allowance."}
            </label>
            {validationFeedback("consent")}
          </fieldset>
          {task?.status === "running" && (
            <p className="text-sm">Pause this task before editing its saved settings.</p>
          )}
          {task && (
            <>
              <details
                className="rounded-lg border border-border p-3"
                open={initialSection === "history" || undefined}
              >
                <summary ref={historySummaryRef}>Run history and results</summary>
                <button type="button" className={button} onClick={() => void loadHistory()}>
                  Load history
                </button>
                {historyLoaded && !runs.length && <p className="text-sm">No runs yet.</p>}
                {runs.map((run) => (
                  <article
                    className="my-2 rounded-lg border border-border p-2 text-sm"
                    key={String(run.id)}
                  >
                    <p>
                      {taskRunStatusLabel(run.status)} ·{" "}
                      {formatDisplayDateTime(String(run.scheduled_for), timeFormat)} ·{" "}
                      {taskRunDeliveryLabel(run.delivery_status)}
                    </p>
                    <p>
                      Actual start:{" "}
                      {run.started_at
                        ? formatDisplayDateTime(String(run.started_at), timeFormat)
                        : "Not started"}
                    </p>
                    <p className="whitespace-pre-wrap">{String(run.result_summary ?? "")}</p>
                    {Boolean(run.failure_type) && (
                      <p>{taskRunFailureLabel(run.failure_type, run.retry_eligible)}</p>
                    )}
                  </article>
                ))}
                {runCursor && (
                  <button type="button" className={button} onClick={() => void loadHistory(true)}>
                    Earlier runs
                  </button>
                )}
              </details>
              <details className="rounded-lg border border-border p-3">
                <summary>Offer an independent copy</summary>
                <p className="my-2 text-xs">
                  The recipient must already have a verified account. They receive this saved prompt
                  and time preferences, then explicitly accept a paused copy with their own context,
                  permissions, and usage allowance.
                </p>
                <label className="block text-sm">
                  Recipient email
                  <input
                    className={control}
                    type="email"
                    value={email}
                    maxLength={254}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={button}
                  disabled={busy || !email || Boolean(pending.current)}
                  onClick={() =>
                    void send({
                      kind: "share",
                      data: {
                        expectedUserId: userKey,
                        id: task.id,
                        mutationId: stableId("share:" + email),
                        expectedRevision: task.revision,
                        email,
                      },
                    })
                  }
                >
                  Offer copy
                </button>
              </details>
            </>
          )}
          <footer className="spec400-schedule-footer">
            <button className={button} type="button" onClick={() => closeEditor()} disabled={busy}>
              Cancel
            </button>
            <button
              className={`${button} spec400-primary`}
              type="submit"
              disabled={
                busy ||
                Boolean(pending.current) ||
                task?.status === "running" ||
                (!task && !executionAvailable) ||
                (mode === "event" && !triggers.length)
              }
            >
              {busy ? (
                <span className="spec400-loading-label">
                  <span className="spec400-loading-spinner" aria-hidden="true" />
                  Saving…
                </span>
              ) : task ? (
                "Save paused"
              ) : (
                "Save schedule"
              )}
            </button>
          </footer>
        </form>
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              keepEditingRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const discard = discardDecisionRef.current === "discard";
              const previous = discardReturnRef.current;
              discardDecisionRef.current = "closed";
              discardReturnRef.current = null;
              if (!active.current || !editorRef.current?.isConnected) return;
              if (discard) {
                // Finish the nested focus scope before the editor restores its page opener.
                closeEditor(true);
              } else {
                const target =
                  previous?.isConnected && !previous.matches(":disabled, [aria-disabled='true']")
                    ? previous
                    : headingRef.current;
                target?.focus({ preventScroll: true });
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Discard unsaved schedule changes?</AlertDialogTitle>
              <AlertDialogDescription>
                Your unsaved changes to “{title.trim() || "Untitled scheduled task"}” will be lost.
                {pending.current &&
                  " The earlier request is still unconfirmed. Closing this editor does not cancel it."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel ref={keepEditingRef} type="button">
                Keep editing
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={busy}
                onClick={(event) => {
                  if (busyRef.current || discardDecisionRef.current !== "pending") {
                    event.preventDefault();
                    return;
                  }
                  discardDecisionRef.current = "discard";
                }}
              >
                Discard changes
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
