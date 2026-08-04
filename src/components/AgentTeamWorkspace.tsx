import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Check, Circle, Loader2, Play, Square, Users } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { useTier } from "@/hooks/useTier";
import { AGENT_WORKFLOW_TEMPLATES, type AgentRole, type AgentTaskInput } from "@/agents/team";

type Run = {
  id: string;
  objective: string;
  status: string;
  entitlement: string;
  created_at: string;
};
type Task = {
  id: string;
  run_id: string;
  client_key: string;
  agent_role: AgentRole;
  title: string;
  dependencies: string[];
  checkpoint: boolean;
  status: string;
  progress: number;
  output_text?: string;
  attempt: number;
  max_attempts: number;
};
type Event = {
  run_id: string;
  kind: string;
  safe_payload: Record<string, unknown>;
  evidence_sha256?: string;
  created_at: string;
};
const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "Planner",
  research: "Research",
  browser: "Browser",
  file: "Files",
  coding: "Coding",
  writing: "Writing",
  review: "Review",
};
const CONTEXT = ["Projects", "Memory", "Files", "Context Packs", "Research", "Apps", "Library"];
const EXECUTION_DISABLED_MESSAGE =
  "Agent team execution is temporarily unavailable. Existing team history remains readable, but new teams cannot be queued until the runtime is restored.";

export function AgentTeamWorkspace() {
  const navigate = useNavigate();
  const { tier, loading } = useTier();
  const unlocked = tier === "plus" || tier === "pro";
  const [templateId, setTemplateId] = useState("research-report");
  const template = useMemo(
    () => AGENT_WORKFLOW_TEMPLATES.find((item) => item.id === templateId)!,
    [templateId],
  );
  const [objective, setObjective] = useState("");
  const [projectId, setProjectId] = useState("");
  const [tasks, setTasks] = useState<AgentTaskInput[]>(() =>
    template.tasks.map((item) => ({ ...item })),
  );
  const [context, setContext] = useState(CONTEXT);
  const [runs, setRuns] = useState<Run[]>([]),
    [serverTasks, setServerTasks] = useState<Task[]>([]),
    [events, setEvents] = useState<Event[]>([]);
  const [selectedRun, setSelectedRun] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  const load = async (runId?: string) => {
    const response = await authFetch(
      `/api/agents/teams${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`,
    );
    if (!response.ok) return;
    const data = (await response.json()) as { runs: Run[]; tasks: Task[]; events: Event[] };
    setRuns((current) =>
      runId
        ? current.map((item) => data.runs.find((run) => run.id === item.id) ?? item)
        : data.runs,
    );
    setServerTasks((current) =>
      runId ? [...current.filter((item) => item.run_id !== runId), ...data.tasks] : data.tasks,
    );
    setEvents((current) =>
      runId ? [...current.filter((item) => item.run_id !== runId), ...data.events] : data.events,
    );
  };
  useEffect(() => {
    if (unlocked) void load();
  }, [unlocked]);
  useEffect(() => {
    if (!selectedRun) return;
    const interval = window.setInterval(() => void load(selectedRun), 3000);
    return () => window.clearInterval(interval);
  }, [selectedRun]);
  const chooseTemplate = (id: string) => {
    const next = AGENT_WORKFLOW_TEMPLATES.find((item) => item.id === id)!;
    setTemplateId(id);
    setTasks(next.tasks.map((item) => ({ ...item })));
  };
  const create = async () => {
    if (!objective.trim() || !tasks.length) return;
    setBusy(true);
    setError("");
    const response = await authFetch("/api/agents/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objective,
        projectId: projectId || undefined,
        idempotencyKey: crypto.randomUUID(),
        tasks,
        context: context.map((item) => item.toLowerCase().replaceAll(" ", "_")),
      }),
    });
    const data = (await response.json().catch(() => null)) as {
      id?: string;
      error?: string;
    } | null;
    setBusy(false);
    if (!response.ok || !data?.id) {
      setError(data?.error ?? "The agent team could not be queued.");
      return;
    }
    setSelectedRun(data.id);
    await load();
  };
  const control = async (
    runId: string,
    command: "pause" | "resume" | "cancel" | "retry" | "approve" | "deny",
    taskId?: string,
  ) => {
    setBusy(true);
    const response = await authFetch("/api/agents/teams", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, command, taskId }),
    });
    setBusy(false);
    if (!response.ok) setError("The requested agent control could not be applied.");
    else await load(runId);
  };
  const downloadOutput = (task: Task) => {
    if (!task.output_text) return;
    const url = URL.createObjectURL(new Blob([task.output_text], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${
      task.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "agent-deliverable"
    }.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const activeRun = runs.find((run) => run.id === selectedRun) ?? runs[0];
  const activeTasks = serverTasks.filter((task) => task.run_id === activeRun?.id);
  const activeEvents = events.filter((event) => event.run_id === activeRun?.id);
  const progress = activeTasks.length
    ? Math.round(activeTasks.reduce((sum, item) => sum + item.progress, 0) / activeTasks.length)
    : 0;

  return (
    <section className="my-6 rounded-2xl border p-4" aria-labelledby="agent-team-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-team-title" className="flex items-center gap-2 font-semibold">
            <Users className="h-5 w-5" />
            Direct an agent team
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Assign a dependency graph to specialists. Historical timeline events and outputs are
            shown from stored server records while execution is disabled.
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs">Apollo</span>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Checking agent access…
        </p>
      ) : !unlocked ? (
        <div className="mt-4 rounded-xl bg-muted/50 p-4">
          <p className="font-medium">Agent teams require Plus or Pro</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Plus runs specialists sequentially. Pro can run independent specialists in parallel.
          </p>
        </div>
      ) : (
        <>
          <div
            className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            role="status"
          >
            {EXECUTION_DISABLED_MESSAGE}
          </div>
          <div className="mt-5 overflow-x-auto">
            <div className="flex min-w-max gap-2" role="list" aria-label="Agent workflow templates">
              {AGENT_WORKFLOW_TEMPLATES.map((item) => (
                <button
                  key={item.id}
                  disabled={busy}
                  onClick={() => chooseTemplate(item.id)}
                  className={`w-44 rounded-xl border p-3 text-left ${item.id === templateId ? "bg-accent" : ""}`}
                >
                  <span className="block text-sm font-medium">{item.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <textarea
              value={objective}
              disabled={busy}
              onChange={(event) => setObjective(event.target.value)}
              aria-label="Agent team objective"
              className="min-h-24 rounded-xl border bg-background p-3 sm:col-span-2"
              placeholder="What should your team accomplish?"
            />
            <input
              value={projectId}
              disabled={busy}
              onChange={(event) => setProjectId(event.target.value)}
              aria-label="Project ID"
              className="h-10 rounded-lg border bg-background px-3"
              placeholder="Project ID (optional)"
            />
            <div className="flex flex-wrap gap-1">
              {CONTEXT.map((item) => (
                <label
                  key={item}
                  className="flex min-h-10 items-center gap-2 rounded-lg border px-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={context.includes(item)}
                    disabled={busy}
                    onChange={() =>
                      setContext((all) =>
                        all.includes(item) ? all.filter((value) => value !== item) : [...all, item],
                      )
                    }
                  />
                  {item}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Task graph</h3>
              <button
                disabled
                onClick={() =>
                  setTasks((all) => [
                    ...all,
                    {
                      key: `task-${all.length + 1}`,
                      role: "research",
                      title: "New specialist task",
                      instructions: "Describe the expected evidence and output",
                      dependencies: all.length ? [all[all.length - 1].key] : [],
                    },
                  ])
                }
                className="min-h-10 rounded-lg border px-3 text-xs"
              >
                Add specialist
              </button>
            </div>
            <ul className="mt-2 grid gap-2 md:grid-cols-2">
              {tasks.map((item, index) => (
                <li key={item.key} className="rounded-xl border p-3">
                  <div className="flex gap-2">
                    <select
                      disabled={busy}
                      aria-label={`Role for ${item.title}`}
                      value={item.role}
                      onChange={(event) =>
                        setTasks((all) =>
                          all.map((value, i) =>
                            i === index
                              ? { ...value, role: event.target.value as AgentRole }
                              : value,
                          ),
                        )
                      }
                      className="h-9 rounded-lg border bg-background px-2 text-xs"
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      disabled={busy}
                      aria-label={`Title for task ${index + 1}`}
                      value={item.title}
                      onChange={(event) =>
                        setTasks((all) =>
                          all.map((value, i) =>
                            i === index
                              ? {
                                  ...value,
                                  title: event.target.value,
                                  instructions: event.target.value,
                                }
                              : value,
                          ),
                        )
                      }
                      className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
                    />
                    <button
                      disabled={busy}
                      aria-label={`Remove ${item.title}`}
                      onClick={() =>
                        setTasks((all) =>
                          all
                            .filter((_, i) => i !== index)
                            .map((value) => ({
                              ...value,
                              dependencies: value.dependencies.filter((key) => key !== item.key),
                            })),
                        )
                      }
                      className="min-h-9 min-w-9 rounded-lg hover:bg-accent"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      After:{" "}
                      {item.dependencies.length
                        ? item.dependencies.join(", ")
                        : "Starts immediately"}
                    </span>
                    <select
                      disabled={busy}
                      aria-label={`Add dependency for ${item.title}`}
                      value=""
                      onChange={(event) => {
                        const dependency = event.target.value;
                        if (!dependency) return;
                        setTasks((all) =>
                          all.map((value, i) =>
                            i === index && !value.dependencies.includes(dependency)
                              ? { ...value, dependencies: [...value.dependencies, dependency] }
                              : value,
                          ),
                        );
                      }}
                      className="h-8 rounded-lg border bg-background px-2"
                    >
                      <option value="">Add dependency</option>
                      {tasks
                        .filter(
                          (candidate) =>
                            candidate.key !== item.key &&
                            !item.dependencies.includes(candidate.key),
                        )
                        .map((candidate) => (
                          <option key={candidate.key} value={candidate.key}>
                            {candidate.key}
                          </option>
                        ))}
                    </select>
                    {item.dependencies.map((dependency) => (
                      <button
                        disabled={busy}
                        key={dependency}
                        onClick={() =>
                          setTasks((all) =>
                            all.map((value, i) =>
                              i === index
                                ? {
                                    ...value,
                                    dependencies: value.dependencies.filter(
                                      (key) => key !== dependency,
                                    ),
                                  }
                                : value,
                            ),
                          )
                        }
                        className="rounded border px-2 py-1"
                        aria-label={`Remove dependency ${dependency}`}
                      >
                        {dependency} ×
                      </button>
                    ))}
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      disabled={busy}
                      type="checkbox"
                      checked={item.checkpoint ?? false}
                      onChange={() =>
                        setTasks((all) =>
                          all.map((value, i) =>
                            i === index ? { ...value, checkpoint: !value.checkpoint } : value,
                          ),
                        )
                      }
                    />
                    Approval checkpoint
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              disabled
              onClick={create}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-4 text-sm text-background disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Agent teams unavailable
            </button>
            <p className="text-xs text-muted-foreground">
              New specialist teams are disabled until runtime support is restored.
            </p>
          </div>
        </>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {activeRun && (
        <div className="mt-6 border-t pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">{activeRun.objective}</h3>
              <p className="text-xs capitalize text-muted-foreground">
                {activeRun.status.replaceAll("_", " ")} · {progress}% estimated from completed task
                checkpoints
              </p>
            </div>
            <div className="flex gap-1">
              <button
                disabled={busy}
                onClick={() => control(activeRun.id, "cancel")}
                className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 text-xs text-destructive"
              >
                <Square className="h-3 w-3" />
                Cancel
              </button>
              <button
                onClick={() => {
                  localStorage.setItem(
                    "kova-automation-draft",
                    JSON.stringify({
                      title: activeRun.objective.slice(0, 120),
                      prompt: activeRun.objective,
                      repeat: "none",
                    }),
                  );
                  navigate({ to: "/scheduled-tasks" });
                }}
                className="min-h-10 rounded-lg border px-3 text-xs"
              >
                Schedule rerun
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
            <div>
              <h4 className="text-sm font-medium">Live specialist timeline</h4>
              <ol className="mt-2 space-y-2">
                {activeTasks.map((item) => (
                  <li key={item.id} className="rounded-xl border p-3">
                    <div className="flex items-center gap-2">
                      {item.status === "completed" ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : item.status === "running" || item.status === "leased" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-xs font-medium">{ROLE_LABELS[item.agent_role]}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                      <span className="text-xs capitalize text-muted-foreground">
                        {item.status.replaceAll("_", " ")} · {item.progress}%
                      </span>
                    </div>
                    {item.output_text && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs">Intermediate output</summary>
                        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                          {item.output_text}
                        </pre>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            onClick={() => downloadOutput(item)}
                            className="min-h-9 rounded-lg border px-3 text-xs"
                          >
                            Download deliverable
                          </button>
                          <button
                            onClick={() => {
                              localStorage.setItem(
                                "kova-work-context",
                                JSON.stringify({
                                  objective: `Continue ${activeRun.objective}`,
                                  project: projectId,
                                  context: `${item.title}\n\n${item.output_text}`,
                                  steps: [],
                                  tools: [],
                                }),
                              );
                              navigate({ to: "/" });
                            }}
                            className="min-h-9 rounded-lg border px-3 text-xs"
                          >
                            Continue in Chat
                          </button>
                        </div>
                      </details>
                    )}
                    {item.status === "approval_needed" && (
                      <div className="mt-3 flex gap-2">
                        <button
                          disabled
                          className="min-h-10 rounded-lg bg-foreground px-3 text-xs text-background disabled:opacity-50"
                        >
                          Approval disabled
                        </button>
                        <button
                          onClick={() => control(activeRun.id, "deny", item.id)}
                          className="min-h-10 rounded-lg border px-3 text-xs"
                        >
                          Deny and pause
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            <aside>
              <h4 className="text-sm font-medium">Evidence and deliverables</h4>
              {activeEvents.length ? (
                <ol className="mt-2 space-y-2">
                  {activeEvents
                    .slice(-12)
                    .reverse()
                    .map((event, index) => (
                      <li key={`${event.created_at}-${index}`} className="rounded-xl border p-3">
                        <p className="text-xs font-medium capitalize">{event.kind}</p>
                        <p className="mt-1 line-clamp-4 text-xs text-muted-foreground">
                          {String(
                            event.safe_payload.title ??
                              event.safe_payload.reason ??
                              event.safe_payload.status ??
                              event.safe_payload.code ??
                              "Execution event",
                          )}
                        </p>
                        {typeof event.safe_payload.screenshotUrl === "string" && (
                          <img
                            src={event.safe_payload.screenshotUrl}
                            alt="Browser evidence captured by the assigned specialist"
                            loading="lazy"
                            className="mt-2 aspect-video w-full rounded-lg border object-cover"
                          />
                        )}
                        {event.evidence_sha256 && (
                          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                            Evidence {event.evidence_sha256.slice(0, 16)}…
                          </p>
                        )}
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="mt-2 rounded-xl border p-4 text-xs text-muted-foreground">
                  No execution evidence yet. Events appear only after a worker performs work.
                </p>
              )}
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}
