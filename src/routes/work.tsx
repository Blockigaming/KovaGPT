import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BriefcaseBusiness, Check, Pause, Play, Plus, Square } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RelatedWorkspaceItems } from "@/components/WorkspaceIntelligence";
import { RealtimeReadiness } from "@/components/RealtimeReadiness";
import { AgentWorkspace } from "@/components/AgentWorkspace";
import { AgentTeamWorkspace } from "@/components/AgentTeamWorkspace";
import {
  createWorkTask,
  loadWorkTasks,
  loadWorkTemplates,
  saveWorkTasks,
  saveWorkTemplates,
  type WorkTask,
  type WorkTemplate,
} from "@/lib/work-store";
export const Route = createFileRoute("/work")({
  component: WorkPage,
  head: () => ({ meta: [{ title: "Work | KovaGPT" }, { name: "robots", content: "noindex" }] }),
});
function WorkPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<WorkTask[]>([]),
    [templates, setTemplates] = useState<WorkTemplate[]>([]),
    [objective, setObjective] = useState(""),
    [project, setProject] = useState(""),
    [context, setContext] = useState(""),
    [plan, setPlan] = useState(["Clarify the goal", "Complete the work", "Review the deliverable"]),
    [approvalSteps, setApprovalSteps] = useState<number[]>(() => {
      try {
        return JSON.parse(localStorage.getItem("kova-workspace-defaults-v1") ?? "{}").work ===
          "Approval gates"
          ? [1, 2]
          : [];
      } catch {
        return [];
      }
    }),
    [deliverableDrafts, setDeliverableDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    setTasks(loadWorkTasks());
    setTemplates(loadWorkTemplates());
    try {
      const raw = localStorage.getItem("kova-work-draft");
      if (raw) {
        const draft = JSON.parse(raw) as { objective: string; plan: string[]; context: string };
        setObjective(draft.objective);
        setPlan(draft.plan);
        setContext(draft.context);
        localStorage.removeItem("kova-work-draft");
      }
    } catch {
      localStorage.removeItem("kova-work-draft");
    }
  }, []);
  const persist = (next: WorkTask[]) => {
    setTasks(next);
    saveWorkTasks(next);
  };
  const create = () => {
    if (!objective.trim() || plan.some((step) => !step.trim())) return;
    const task = createWorkTask(objective, project, context, plan);
    task.steps = task.steps.map((step, index) => ({
      ...step,
      approval: approvalSteps.includes(index),
    }));
    persist([task, ...tasks]);
    setObjective("");
    setProject("");
    setContext("");
  };
  const update = (id: string, fn: (task: WorkTask) => WorkTask) =>
    persist(tasks.map((task) => (task.id === id ? { ...fn(task), updatedAt: Date.now() } : task)));
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6">
        <header>
          <div className="flex items-center gap-2">
            <BriefcaseBusiness className="h-5 w-5" />
            <h1 className="text-2xl font-semibold">Work</h1>
            <RealtimeReadiness resource="Work" />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Plan longer work, track approvals, and continue execution in chat. KovaGPT does not
            claim background execution.
          </p>
        </header>
        <AgentTeamWorkspace />
        <AgentWorkspace />
        <section className="my-6 rounded-2xl border p-4">
          <h2 className="font-semibold">Create a work task</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              aria-label="Load Work template"
              defaultValue=""
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (!template) return;
                setObjective(template.objective);
                setContext(template.context);
                setPlan(template.plan);
              }}
              className="h-10 min-w-48 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">Load template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button
              disabled={!objective.trim() || plan.some((step) => !step.trim())}
              onClick={() => {
                const template: WorkTemplate = {
                  id: crypto.randomUUID(),
                  name: objective.slice(0, 80),
                  objective,
                  context,
                  plan,
                  updatedAt: Date.now(),
                };
                const next = [template, ...templates].slice(0, 50);
                setTemplates(next);
                saveWorkTemplates(next);
              }}
              className="min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50"
            >
              Save as template
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="h-11 rounded-xl border bg-background px-3 sm:col-span-2"
              placeholder="Objective"
              aria-label="Work objective"
            />
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="h-11 rounded-xl border bg-background px-3"
              placeholder="Project context (optional)"
              aria-label="Project context"
            />
            <input
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="h-11 rounded-xl border bg-background px-3"
              placeholder="Files or app context notes"
              aria-label="Context notes"
            />
          </div>
          <div className="mt-3 space-y-2" aria-label="Execution plan">
            {plan.map((step, index) => (
              <div className="flex flex-wrap gap-2" key={index}>
                <input
                  value={step}
                  onChange={(e) =>
                    setPlan((all) => all.map((value, i) => (i === index ? e.target.value : value)))
                  }
                  className="h-10 flex-1 rounded-lg border bg-background px-3"
                  aria-label={`Plan step ${index + 1}`}
                />
                <button
                  onClick={() => setPlan((all) => all.filter((_, i) => i !== index))}
                  aria-label={`Remove step ${index + 1}`}
                  className="min-h-10 min-w-10 rounded-lg hover:bg-accent"
                >
                  ×
                </button>
                <label className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs">
                  <input
                    type="checkbox"
                    checked={approvalSteps.includes(index)}
                    onChange={() =>
                      setApprovalSteps((all) =>
                        all.includes(index)
                          ? all.filter((value) => value !== index)
                          : [...all, index],
                      )
                    }
                  />
                  Approval gate
                </label>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between">
            <button
              onClick={() => setPlan((all) => [...all, ""])}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
              Add step
            </button>
            <button
              disabled={!objective.trim() || plan.some((step) => !step.trim())}
              onClick={create}
              className="min-h-11 rounded-xl bg-foreground px-4 text-background disabled:opacity-50"
            >
              Create task
            </button>
          </div>
        </section>
        <section>
          <h2 className="font-semibold">Work history</h2>
          {tasks.length === 0 ? (
            <div className="mt-3 rounded-2xl border p-10 text-center">
              <BriefcaseBusiness className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 font-medium">No work tasks yet</p>
              <p className="text-sm text-muted-foreground">
                Create a plan above. Nothing runs until you explicitly continue it.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-4">
              {tasks.map((task) => (
                <li key={task.id} className="rounded-2xl border bg-card/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{task.objective}</h3>
                      <p className="text-xs capitalize text-muted-foreground">
                        {task.status} · Updated {new Date(task.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {task.status === "planning" ? (
                        <button
                          onClick={() => update(task.id, (t) => ({ ...t, status: "paused" }))}
                          className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 hover:bg-accent"
                        >
                          <Pause className="h-4 w-4" />
                          Pause
                        </button>
                      ) : task.status === "paused" ? (
                        <button
                          onClick={() => update(task.id, (t) => ({ ...t, status: "planning" }))}
                          className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 hover:bg-accent"
                        >
                          <Play className="h-4 w-4" />
                          Resume
                        </button>
                      ) : null}
                      <button
                        onClick={() => update(task.id, (t) => ({ ...t, status: "cancelled" }))}
                        className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-destructive hover:bg-destructive/10"
                      >
                        <Square className="h-4 w-4" />
                        Cancel
                      </button>
                    </div>
                  </div>
                  <ol className="mt-4 space-y-2">
                    {task.steps.map((step) => (
                      <li key={step.id} className="flex items-center gap-2">
                        <button
                          disabled={task.status !== "planning" || (step.approval && !step.approved)}
                          onClick={() =>
                            update(task.id, (t) => ({
                              ...t,
                              steps: t.steps.map((value) =>
                                value.id === step.id ? { ...value, done: !value.done } : value,
                              ),
                            }))
                          }
                          aria-label={`${step.done ? "Reopen" : "Complete"} ${step.text}`}
                          className="grid min-h-10 min-w-10 place-items-center rounded-lg border disabled:opacity-50"
                        >
                          {step.done && <Check className="h-4 w-4" />}
                        </button>
                        <span className={step.done ? "text-muted-foreground line-through" : ""}>
                          {step.text}
                        </span>
                        {step.approval && !step.approved && (
                          <button
                            onClick={() =>
                              update(task.id, (current) => ({
                                ...current,
                                steps: current.steps.map((value) =>
                                  value.id === step.id ? { ...value, approved: true } : value,
                                ),
                              }))
                            }
                            className="ml-auto min-h-10 rounded-lg border px-3 text-xs hover:bg-accent"
                          >
                            Approve step
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        localStorage.setItem("kova-work-context", JSON.stringify(task));
                        navigate({ to: "/" });
                      }}
                      className="min-h-10 rounded-lg bg-foreground px-3 text-sm text-background"
                    >
                      Continue in chat
                    </button>
                    <button
                      onClick={() => update(task.id, (t) => ({ ...t, status: "completed" }))}
                      className="min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
                    >
                      Mark complete
                    </button>
                    <button
                      onClick={() => {
                        localStorage.setItem(
                          "kova-automation-draft",
                          JSON.stringify({
                            title: task.objective.slice(0, 120),
                            prompt: `Continue this Work objective: ${task.objective}\n\n${task.context}`,
                            repeat: "none",
                          }),
                        );
                        navigate({ to: "/scheduled-tasks" });
                      }}
                      className="min-h-10 rounded-lg border px-3 text-sm hover:bg-accent"
                    >
                      Schedule follow-up
                    </button>
                  </div>
                  <div className="mt-4 border-t pt-4">
                    <h4 className="text-sm font-medium">Deliverables</h4>
                    {task.deliverables.length ? (
                      <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                        {task.deliverables.map((deliverable, index) => (
                          <li key={index}>{deliverable}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        No deliverables recorded.
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <input
                        value={deliverableDrafts[task.id] ?? ""}
                        onChange={(event) =>
                          setDeliverableDrafts((all) => ({
                            ...all,
                            [task.id]: event.target.value,
                          }))
                        }
                        className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
                        placeholder="Add a generated file, report, or artifact link"
                        aria-label={`Add deliverable to ${task.objective}`}
                      />
                      <button
                        disabled={!deliverableDrafts[task.id]?.trim()}
                        onClick={() => {
                          const text = deliverableDrafts[task.id]?.trim();
                          if (!text) return;
                          update(task.id, (current) => ({
                            ...current,
                            deliverables: [...current.deliverables, text],
                          }));
                          setDeliverableDrafts((all) => ({ ...all, [task.id]: "" }));
                        }}
                        className="min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <RelatedWorkspaceItems
          kinds={["project", "context_pack", "file", "artifact", "research", "memory"]}
          title="Recent context for Work"
        />
      </main>
    </AppShell>
  );
}
