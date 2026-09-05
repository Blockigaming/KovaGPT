import { TaskGmailEventSource } from "@/components/TaskGmailEventSource";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
import type { TaskContextRef, TaskTrigger, TaskProvider } from "@/lib/scheduled-task-policy.mjs";

type Draft = {
  title: string;
  prompt: string;
  localTime?: string;
  run_at?: string;
  repeat: ScheduledTask["repeat"];
};
type Option = { id: string; label: string; projectId?: string };
const control = "w-full rounded-lg border border-border bg-background p-2 text-sm";
const button = "rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50";
type ScheduledTaskEditorProps = {
  task?: ScheduledTask;
  draft?: Draft;
  userKey: string;
  executionAvailable: boolean;
  onClose: () => void;
  onSaved: () => void;
};
export function ScheduledTaskEditor(props: ScheduledTaskEditorProps) {
  return <ScheduledTaskEditorBody key={props.userKey} {...props} />;
}
function ScheduledTaskEditorBody({
  task,
  draft,
  userKey,
  executionAvailable,
  onClose,
  onSaved,
}: ScheduledTaskEditorProps) {
  const [title, setTitle] = useState(task?.title ?? draft?.title ?? ""),
    [prompt, setPrompt] = useState(task?.prompt ?? draft?.prompt ?? "");
  const [timezone, setTimezone] = useState(
    task?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [localTime, setLocalTime] = useState(
    task?.schedule_local?.slice(0, 16) ??
      draft?.localTime ??
      (draft?.run_at
        ? new Date(Date.parse(draft.run_at) - new Date().getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : ""),
  );
  const [repeat, setRepeat] = useState<ScheduledTask["repeat"]>(
    task?.repeat ?? draft?.repeat ?? "none",
  );
  const [mode, setMode] = useState<"time" | "event">(task?.trigger_mode ?? "time");
  const [refs, setRefs] = useState<TaskContextRef[]>(task?.context_refs ?? []),
    [triggers, setTriggers] = useState<TaskTrigger[]>(task?.event_triggers ?? []);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    };
  }, [userKey]);
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
  const stableId = (key: string) => {
    const existing = operationIds.current.get(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    operationIds.current.set(key, id);
    return id;
  };
  async function send(operation: {
    kind: "create" | "update" | "share";
    data: Record<string, unknown>;
  }) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    pending.current = operation;
    try {
      if (operation.kind === "create")
        await create({ data: { ...operation.data, expectedUserId: userKey } });
      else if (operation.kind === "update")
        await update({ data: { ...operation.data, expectedUserId: userKey } });
      else await share({ data: { ...operation.data, expectedUserId: userKey } });
      if (!active.current) return;
      pending.current = null;
      onSaved();
      onClose();
    } catch (reason) {
      fail(reason);
    } finally {
      busyRef.current = false;
      if (active.current) setBusy(false);
    }
  }
  function save() {
    if (pending.current) {
      void send(pending.current);
      return;
    }
    if (!consent || (!task && !executionAvailable)) return;
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
    void send({
      kind: task ? "update" : "create",
      data: {
        expectedUserId: userKey,
        ...payload,
        id: task?.id ?? stableId("new-task"),
        mutationId: stableId("save"),
        ...(task ? { expectedRevision: task.revision } : {}),
      },
    });
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
        onClose();
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
  const selectedGrant = grants.find((value) => value.id === grantId);
  const snapshot = refs.find((ref) => ref.kind === "snapshot");
  return (
    <section
      aria-label={task ? "Edit task" : "Review new task"}
      className="my-5 rounded-xl border border-border bg-card p-4 space-y-4"
    >
      <div className="flex justify-between gap-3">
        <h2 className="font-semibold">
          {task ? "Task settings, history, and sharing" : "Review and schedule"}
        </h2>
        <button className={button} onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">
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
          className={button}
          disabled={busy}
          onClick={() => pending.current && void send(pending.current)}
        >
          Retry the same request
        </button>
      )}
      <fieldset
        disabled={busy || Boolean(pending.current) || task?.status === "running"}
        className="space-y-3"
      >
        <label className="block text-sm">
          Title
          <input
            className={control}
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Saved prompt
          <textarea
            className={control}
            value={prompt}
            maxLength={4000}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
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
              Local date and time
              <input
                className={control}
                type="datetime-local"
                value={localTime}
                onChange={(event) => setLocalTime(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              Time zone
              <input
                className={control}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="America/New_York"
              />
            </label>
            <label className="block text-sm">
              Repeat
              <select
                className={control}
                value={repeat}
                onChange={(event) => setRepeat(event.target.value as ScheduledTask["repeat"])}
              >
                {["none", "daily", "weekly", "monthly"].map((value) => (
                  <option key={value} value={value}>
                    {value === "none" ? "Once" : value}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              Recurrence keeps this local time. A missing spring clock time advances by the clock
              gap; a repeated autumn clock time uses the later occurrence. Monthly tasks use the
              original day, or the last day of a shorter month.
            </p>
          </>
        )}
        <details className="rounded-lg border border-border p-3">
          <summary>Saved chat or uploaded context ({refs.length}/8)</summary>
          <p className="my-2 text-xs text-muted-foreground">
            Paste an explicit saved conversation excerpt, or select indexed text from your Library
            and Projects. A saved excerpt is not synchronized with future chat messages. Source
            access is checked again for every run.
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
            <button className={button} onClick={() => void loadFiles()}>
              Browse
            </button>
          </div>
          {options.length > 0 && (
            <select
              className={control}
              value=""
              onChange={(event) => {
                const option = options.find((item) => item.id === event.target.value);
                if (option && refs.length < 8)
                  setRefs((current) => [
                    ...current,
                    kind === "library"
                      ? { kind: "library", id: option.id }
                      : { kind: "project_file", id: option.id, projectId: option.projectId! },
                  ]);
              }}
            >
              <option value="">Choose a file to add</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          {cursor && (
            <button className={button} onClick={() => void loadFiles(true)}>
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
          <select
            aria-label="Connected account"
            className={control}
            value={connectionId}
            onChange={(event) => {
              setConnectionId(event.target.value);
              setConnectionConsent(false);
            }}
          >
            <option value="">Choose a connected account</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.provider} · {connection.label}
              </option>
            ))}
          </select>
          <label className="my-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={connectionConsent}
              onChange={(event) => setConnectionConsent(event.target.checked)}
            />
            Allow this account to read the sources I select for background tasks.
          </label>
          <button
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
                <button className={button} onClick={() => void revoke(grant)}>
                  Revoke and pause affected tasks
                </button>
              </div>
            ))}
          </div>
          <select
            aria-label="Task background approval"
            className={control}
            value={grantId}
            onChange={(event) => {
              resourceRead.current++;
              setGrantId(event.target.value);
              setResources([]);
              setResource("");
              setResourceCursor(null);
            }}
          >
            <option value="">Choose a task approval</option>
            {grants.map((grant) => (
              <option key={grant.id} value={grant.id}>
                {grant.provider} ·{" "}
                {connections.find((item) => item.id === grant.connection_ref)?.label ??
                  "Saved account"}
              </option>
            ))}
          </select>
          {mode === "event" && selectedGrant?.provider === "gmail" && (
            <TaskGmailEventSource
              key={`${userKey}:${selectedGrant.id}`}
              userId={userKey}
              grantId={selectedGrant.id}
            />
          )}
          <button className={button} disabled={!grantId} onClick={() => void loadResources()}>
            Browse readable sources
          </button>
          {resources.length > 0 && (
            <select
              aria-label="Connected source"
              className={control}
              value={resource}
              onChange={(event) => setResource(event.target.value)}
            >
              <option value="">Choose a source</option>
              {resources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          {resourceCursor && (
            <button className={button} onClick={() => void loadResources(true)}>
              Load more sources
            </button>
          )}
          <button
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
                Native provider registration must be active; choosing a filter does not register a
                webhook.
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
                        ...(selectedGrant.provider === "github" ? { activities: [activity] } : {}),
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
                    className={button}
                    onClick={() => setTriggers((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          {task
            ? "Save these settings in a paused state. I will review and resume the task separately."
            : "Run this prompt in the background using the selected context and my account usage allowance."}
        </label>
        <button
          className={button}
          onClick={save}
          disabled={
            !consent ||
            !title.trim() ||
            !prompt.trim() ||
            (!task && !executionAvailable) ||
            (mode === "time" && !localTime) ||
            (mode === "event" && !triggers.length)
          }
        >
          {task ? "Save and pause" : "Schedule task"}
        </button>
      </fieldset>
      {task?.status === "running" && (
        <p className="text-sm">Pause this task before editing its saved settings.</p>
      )}
      {task && (
        <>
          <details className="rounded-lg border border-border p-3">
            <summary>Run history and results</summary>
            <button className={button} onClick={() => void loadHistory()}>
              Load history
            </button>
            {historyLoaded && !runs.length && <p className="text-sm">No runs yet.</p>}
            {runs.map((run) => (
              <article
                className="my-2 rounded-lg border border-border p-2 text-sm"
                key={String(run.id)}
              >
                <p>
                  {String(run.status)} · {new Date(String(run.scheduled_for)).toLocaleString()} ·
                  notification {String(run.delivery_status)}
                </p>
                <p className="whitespace-pre-wrap">{String(run.result_summary ?? "")}</p>
                {Boolean(run.failure_type) && (
                  <p>
                    {String(run.failure_type)}
                    {run.retry_eligible ? " · eligible for retry" : ""}
                  </p>
                )}
              </article>
            ))}
            {runCursor && (
              <button className={button} onClick={() => void loadHistory(true)}>
                Earlier runs
              </button>
            )}
          </details>
          <details className="rounded-lg border border-border p-3">
            <summary>Offer an independent copy</summary>
            <p className="my-2 text-xs">
              The recipient must already have a verified account. They receive this saved prompt and
              time preferences, then explicitly accept a paused copy with their own context,
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
    </section>
  );
}
