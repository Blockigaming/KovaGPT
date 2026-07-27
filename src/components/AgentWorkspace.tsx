import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bot, CheckCircle2, Globe2, LockKeyhole, Play, RotateCcw } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { loadAgentRuns, saveAgentRuns, type AgentRun, type AgentRunStatus } from "@/lib/work-store";

const DEFAULT_STEPS = [
  "Review the objective and context",
  "Complete the requested work",
  "Request approval before external or destructive actions",
  "Prepare the deliverable",
];

export function AgentWorkspace() {
  const navigate = useNavigate();
  const { tier, loading } = useTier();
  const available = tier === "plus" || tier === "pro";
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [name, setName] = useState("Research and deliver");
  const [objective, setObjective] = useState("");
  const [instructions, setInstructions] = useState("");
  const [project, setProject] = useState("");
  const [context, setContext] = useState("");
  const [steps, setSteps] = useState(DEFAULT_STEPS);
  const [approvalSteps, setApprovalSteps] = useState([2]);
  const [tools, setTools] = useState<AgentRun["tools"]>(["web", "files"]);
  const [validation, setValidation] = useState<string[]>([]);

  useEffect(() => setRuns(loadAgentRuns()), []);
  const persist = (next: AgentRun[]) => {
    setRuns(next);
    saveAgentRuns(next);
  };
  const canSave = available && objective.trim().length > 4 && steps.every((step) => step.trim());
  const contextItems = useMemo(
    () =>
      context
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [context],
  );
  const validate = () => {
    const issues = [
      !objective.trim() ? "Add an objective." : "",
      steps.some((step) => !step.trim()) ? "Every plan step needs a description." : "",
      tools.includes("apps") && !contextItems.some((item) => item.toLowerCase().startsWith("app:"))
        ? "Add an ‘app:’ context reference or disable Apps."
        : "",
    ].filter(Boolean);
    setValidation(issues.length ? issues : ["Ready to hand off. No provider call was made."]);
  };
  const createRun = () => {
    if (!canSave) return;
    const now = Date.now();
    const run: AgentRun = {
      id: crypto.randomUUID(),
      name: name.trim() || "Agent run",
      objective: objective.trim(),
      instructions: instructions.trim(),
      project: project.trim(),
      context: contextItems,
      tools,
      steps: steps.map((step) => step.trim()),
      approvalSteps,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      log: [{ at: now, message: "Plan saved locally and ready for an explicit handoff." }],
    };
    persist([run, ...runs].slice(0, 100));
    setObjective("");
  };
  const update = (id: string, status: AgentRunStatus, message: string) => {
    const now = Date.now();
    persist(
      runs.map((run) =>
        run.id === id
          ? { ...run, status, updatedAt: now, log: [...run.log, { at: now, message }] }
          : run,
      ),
    );
  };
  const handoff = (run: AgentRun) => {
    localStorage.setItem(
      "kova-work-context",
      JSON.stringify({
        objective: run.objective,
        project: run.project,
        context: run.context.join("\n"),
        steps: run.steps.map((text, index) => ({
          text,
          approval: run.approvalSteps.includes(index),
        })),
        tools: run.tools,
        instructions: run.instructions,
      }),
    );
    update(run.id, "handed_off", "Opened in Chat for user-supervised execution.");
    navigate({ to: "/" });
  };

  return (
    <section className="my-6 rounded-2xl border p-4" aria-labelledby="agent-workspace-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-workspace-title" className="flex items-center gap-2 font-semibold">
            <Bot className="h-4 w-4" />
            Agent workspace
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Build reusable, approval-aware runs. Execution starts only when you hand the plan to
            Chat or Scheduling.
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs">Plus</span>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Checking plan access…
        </p>
      ) : !available ? (
        <div className="mt-4 rounded-xl bg-muted/50 p-4">
          <p className="flex items-center gap-2 font-medium">
            <LockKeyhole className="h-4 w-4" />
            Plus or Pro required
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Agent plans, reusable context, and execution history are available on paid plans.
          </p>
          <button
            onClick={() => navigate({ to: "/pricing" })}
            className="mt-3 min-h-10 rounded-lg border px-3 text-sm"
          >
            View plans
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              aria-label="Agent name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-lg border bg-background px-3"
              placeholder="Agent name"
            />
            <input
              aria-label="Agent project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="h-10 rounded-lg border bg-background px-3"
              placeholder="Project (optional)"
            />
            <textarea
              aria-label="Agent objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="min-h-24 rounded-lg border bg-background p-3 sm:col-span-2"
              placeholder="What should this agent accomplish?"
            />
            <textarea
              aria-label="Agent instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-24 rounded-lg border bg-background p-3"
              placeholder="Guardrails and output requirements"
            />
            <textarea
              aria-label="Agent context references"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="min-h-24 rounded-lg border bg-background p-3"
              placeholder={
                "One authorized reference per line\nfile: quarterly-plan.pdf\ncontext-pack: launch"
              }
            />
          </div>
          <fieldset className="mt-3">
            <legend className="text-sm font-medium">Allowed tools</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {(["web", "files", "apps"] as const).map((tool) => (
                <label
                  key={tool}
                  className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={tools.includes(tool)}
                    onChange={() =>
                      setTools((all) =>
                        all.includes(tool) ? all.filter((item) => item !== tool) : [...all, tool],
                      )
                    }
                  />
                  {tool === "web" && <Globe2 className="h-4 w-4" />}
                  {tool}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 space-y-2" aria-label="Agent execution plan">
            {steps.map((step, index) => (
              <div key={index} className="flex flex-wrap gap-2">
                <input
                  aria-label={`Agent step ${index + 1}`}
                  value={step}
                  onChange={(e) =>
                    setSteps((all) => all.map((value, i) => (i === index ? e.target.value : value)))
                  }
                  className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3"
                />
                <label className="flex min-h-10 items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={approvalSteps.includes(index)}
                    onChange={() =>
                      setApprovalSteps((all) =>
                        all.includes(index)
                          ? all.filter((item) => item !== index)
                          : [...all, index],
                      )
                    }
                  />
                  Approval
                </label>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={validate} className="min-h-10 rounded-lg border px-3 text-sm">
              Test configuration
            </button>
            <button
              disabled={!canSave}
              onClick={createRun}
              className="min-h-10 rounded-lg bg-foreground px-3 text-sm text-background disabled:opacity-50"
            >
              Save run
            </button>
          </div>
          {validation.length > 0 && (
            <ul className="mt-3 rounded-lg bg-muted/50 p-3 text-sm" role="status">
              {validation.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {available && (
        <div className="mt-6">
          <h3 className="font-medium">Execution history</h3>
          {runs.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No agent runs yet. Save a validated plan to begin.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {runs.map((run) => (
                <li key={run.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <p className="font-medium">{run.name}</p>
                      <p className="text-sm text-muted-foreground">{run.objective}</p>
                    </div>
                    <span className="text-xs capitalize">{run.status.replace("_", " ")}</span>
                  </div>
                  <ol className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {run.log.slice(-3).map((entry) => (
                      <li key={`${entry.at}-${entry.message}`}>
                        {new Date(entry.at).toLocaleString()} · {entry.message}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => handoff(run)}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-foreground px-3 text-sm text-background"
                    >
                      <Play className="h-3 w-3" />
                      Continue in Chat
                    </button>
                    {run.status === "failed" || run.status === "paused" ? (
                      <button
                        onClick={() => update(run.id, "ready", "Run reset to ready by the user.")}
                        className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 text-sm"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Retry
                      </button>
                    ) : null}
                    <button
                      onClick={() => {
                        localStorage.setItem(
                          "kova-automation-draft",
                          JSON.stringify({
                            title: run.name,
                            prompt: run.objective,
                            repeat: "none",
                          }),
                        );
                        navigate({ to: "/scheduled-tasks" });
                      }}
                      className="min-h-10 rounded-lg border px-3 text-sm"
                    >
                      Schedule
                    </button>
                    {run.status === "handed_off" && (
                      <button
                        onClick={() => update(run.id, "completed", "Marked complete by the user.")}
                        className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 text-sm"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Complete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
