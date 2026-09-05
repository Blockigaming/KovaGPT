import type {
  WorkModelMode,
  WorkModelOption,
  WorkReasoningEffort,
} from "@/lib/work-model-policy.mjs";
import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
const WorkBrowserPanel = lazy(() =>
  import("@/components/WorkBrowserPanel").then((module) => ({ default: module.WorkBrowserPanel })),
);
import { useServerFn } from "@tanstack/react-start";
import { listProjects, type ProjectSummary } from "@/lib/projects.functions";
import { requestWorkSync } from "@/lib/work-sync-client";
import { WORK_TERMINAL, type WorkRun } from "@/lib/work-execution-protocol.mjs";

type Snapshot = {
  readiness: { available: boolean; reason: string | null; modelOptions?: WorkModelOption[] };
  runs: WorkRun[];
  nextCursor: string | null;
};
export function WorkExecutionPanel({
  ownerId,
  initialObjective = "",
  source = "work",
  session = null,
}: {
  ownerId: string;
  initialObjective?: string;
  source?: "chat" | "work";
  session?: { id: string; revision: number } | null;
}) {
  const [cleared, setCleared] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [objective, setObjective] = useState(initialObjective);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<WorkModelMode>("normal");
  const [reasoningEffort, setReasoningEffort] = useState<WorkReasoningEffort | null>(null);
  const fetchProjects = useServerFn(listProjects);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const load = useCallback(
    async (before?: string) => {
      const signal = lifetime.current?.signal;
      if (!signal || signal.aborted) return;
      const version = ++requestVersion.current;
      try {
        const result = (await requestWorkSync(
          ownerId,
          `/api/work/execution${before ? `?before=${encodeURIComponent(before)}` : ""}`,
          signal,
        )) as Snapshot;
        if (signal.aborted || version !== requestVersion.current) return;
        if (
          !result.readiness ||
          !Array.isArray(result.runs) ||
          result.runs.some((run) => run.ownerId !== ownerId)
        )
          throw new Error("invalid_snapshot");
        setSnapshot((previous) =>
          before && previous
            ? {
                ...result,
                runs: [
                  ...previous.runs,
                  ...result.runs.filter((run) => !previous.runs.some((old) => old.id === run.id)),
                ],
              }
            : result,
        );
        setError(null);
      } catch {
        if (!signal.aborted && version === requestVersion.current)
          setError("Work history is temporarily unavailable. Your saved plans remain available.");
      }
    },
    [ownerId],
  );
  useEffect(() => {
    const view = createWorkViewLifetime(ownerId, () => {
      setCleared(true);
      setSnapshot(null);
      setObjective("");
      setProjects([]);
      setProjectId("");
      setMode("normal");
      setReasoningEffort(null);
      setSelected(null);
      setText("");
      setPending(null);
      setError(null);
      setBusy(false);
    });
    const controller = view.controller;
    lifetime.current = controller;
    void load();
    void fetchProjects()
      .then((items) => {
        if (!controller.signal.aborted)
          setProjects(
            items.filter(
              (item) => ["owner", "editor"].includes(item.role) && !item.deletion_requested_at,
            ),
          );
      })
      .catch(() => undefined);
    return () => {
      view.dispose();
    };
  }, [load, fetchProjects, ownerId, reloadVersion]);
  async function send(body: Record<string, unknown>) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    setBusy(true);
    setPending(body);
    setError(null);
    try {
      const result = (await requestWorkSync(ownerId, "/api/work/execution", signal, body)) as {
        state: WorkRun;
      };
      if (signal.aborted) return;
      if (result.state?.ownerId !== ownerId) throw new Error("invalid_snapshot");
      setPending(null);
      setSelected(result.state.id);
      setText("");
      await load();
    } catch (cause) {
      if (signal.aborted) return;
      const status = (cause as { status?: number }).status;
      if (status && [400, 403, 404, 409].includes(status)) {
        setPending(null);
        await load();
        setError("The action could not be applied. Review the current run before trying again.");
      } else setError("The action is not confirmed. Retry it to safely check the same request.");
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const run = snapshot?.runs.find((item) => item.id === selected);
  const modelOptions = snapshot?.readiness.modelOptions ?? [];
  const selectedModel = modelOptions.find((item) => item.mode === mode);
  const selectedSupported =
    selectedModel?.available === true &&
    (reasoningEffort === null || selectedModel.reasoningEfforts.includes(reasoningEffort));
  const available = snapshot?.readiness.available === true && selectedSupported;
  const locked = busy || Boolean(pending);
  const command = (value: Record<string, unknown>) =>
    run &&
    void send({
      operation: "control",
      runId: run.id,
      mutationId: crypto.randomUUID(),
      expectedRevision: run.revision,
      command: value,
    });
  if (cleared)
    return (
      <section className="mb-4 rounded-2xl border bg-card p-4" aria-label="Work execution">
        <p>Work controls were cleared on this device.</p>
        <button
          type="button"
          className="mt-2 text-sm underline"
          onClick={() => {
            setCleared(false);
            setReloadVersion((value) => value + 1);
          }}
        >
          Reload Work controls
        </button>
      </section>
    );
  return (
    <section className="mb-4 rounded-2xl border bg-card p-4" aria-label="Work execution">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Run prepared work</h2>
        <button className="text-sm underline" disabled={locked} onClick={() => void load()}>
          Refresh execution status
        </button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground" role="status">
        {available
          ? "A connected runner is available. Review each consequential action before it runs."
          : "Execution is unavailable. You can prepare, save, and continue work in Chat."}
      </p>
      <label className="mt-3 block text-sm">
        Objective
        <textarea
          className="mt-1 block min-h-20 w-full rounded-lg border bg-background p-2"
          maxLength={12000}
          value={objective}
          disabled={locked}
          onChange={(event) => setObjective(event.target.value)}
        />
      </label>
      <label className="mt-2 block text-sm">
        Save output files in Project
        <select
          className="ml-2 rounded border bg-background p-1"
          value={projectId}
          disabled={locked}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Choose a Project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <label className="text-sm">
          Work model mode
          <select
            className="ml-2 rounded border bg-background p-1"
            value={mode}
            disabled={locked || !modelOptions.length}
            onChange={(event) => {
              setMode(event.target.value as WorkModelMode);
              setReasoningEffort(null);
            }}
          >
            {!modelOptions.length && (
              <option value="normal">Normal · configuration unavailable</option>
            )}
            {modelOptions.map((option) => (
              <option key={option.mode} value={option.mode} disabled={!option.available}>
                {option.label} · {option.model ?? "unconfigured"}
                {option.reason ? ` · ${option.reason}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Reasoning effort
          <select
            className="ml-2 rounded border bg-background p-1"
            value={reasoningEffort ?? "default"}
            disabled={locked || !selectedModel?.available || !selectedModel.reasoningEfforts.length}
            onChange={(event) =>
              setReasoningEffort(
                event.target.value === "default"
                  ? null
                  : (event.target.value as WorkReasoningEffort),
              )
            }
          >
            <option value="default">Provider default</option>
            {selectedModel?.reasoningEfforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort === "none" ? "No reasoning" : effort}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Service: provider default. Reasoning effort affects response time and token use.
        {selectedModel?.reason ? ` ${selectedModel.reason}` : ""}
        {reasoningEffort !== null && !selectedSupported
          ? " This reasoning choice is no longer available. Review the current options."
          : ""}
      </p>
      <button
        className="mt-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
        disabled={!available || locked || !objective.trim() || !projectId}
        onClick={() =>
          void send({
            operation: "submit",
            input: {
              mutationId: crypto.randomUUID(),
              objective,
              mode,
              reasoningEffort,
              source,
              sessionId: session?.id ?? null,
              sessionRevision: session?.revision ?? null,
              projectId,
            },
          })
        }
      >
        Start work
      </button>
      {error && (
        <p className="mt-2 text-sm" role="alert">
          {error}
        </p>
      )}
      {pending && !busy && (
        <button className="mt-2 text-sm underline" onClick={() => void send(pending)}>
          Retry unconfirmed action
        </button>
      )}
      {Boolean(snapshot?.runs.length) && (
        <label className="mt-4 block text-sm">
          Execution history
          <select
            className="ml-2 rounded border bg-background p-1"
            value={selected ?? ""}
            onChange={(event) => {
              setSelected(event.target.value);
              setText("");
            }}
          >
            <option value="">Choose a run</option>
            {snapshot!.runs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.request.objective.slice(0, 70)} · {item.status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {snapshot?.nextCursor && (
        <button
          className="mt-2 text-sm underline"
          disabled={locked}
          onClick={() => void load(snapshot.nextCursor!)}
        >
          Load older executions
        </button>
      )}
      {run && (
        <div className="mt-4 space-y-3 border-t pt-3">
          {!WORK_TERMINAL.includes(run.status) && (
            <Suspense fallback={null}>
              <WorkBrowserPanel key={`${ownerId}:${run.id}`} ownerId={ownerId} run={run} />
            </Suspense>
          )}
          <p className="text-sm" aria-label="Execution model">
            Model: {run.model} · {run.modelSelection?.mode ?? "original routing"} · reasoning:{" "}
            {run.modelSelection?.reasoningEffort ?? "provider default"} · service: provider default
          </p>
          <p className="text-sm">
            Status: {run.status.replaceAll("_", " ")} · Revision {run.revision}
          </p>
          {(run.step || run.effect?.status === "started") && run.status !== "running" && (
            <p className="text-sm">
              An interrupted action needs verified reconciliation before it can resume.
            </p>
          )}
          {!WORK_TERMINAL.includes(run.status) && (
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded border px-2 py-1 text-sm"
                disabled={locked}
                onClick={() => command({ type: "cancel" })}
              >
                Cancel run
              </button>
              <button
                className="rounded border px-2 py-1 text-sm"
                disabled={locked || run.status === "paused"}
                onClick={() => command({ type: "pause" })}
              >
                Pause run
              </button>
              {run.status === "paused" && (
                <button
                  className="rounded border px-2 py-1 text-sm"
                  disabled={
                    !available ||
                    locked ||
                    Boolean(run.step) ||
                    run.effect?.status === "started" ||
                    run.outputRefs.length > 0
                  }
                  onClick={() => command({ type: "resume" })}
                >
                  Resume run
                </button>
              )}
            </div>
          )}
          {run.question && run.status === "waiting_for_user" && (
            <p className="whitespace-pre-wrap text-sm">{run.question.text}</p>
          )}
          {!WORK_TERMINAL.includes(run.status) && (
            <div>
              <label className="block text-sm">
                {run.status === "waiting_for_user" ? "Your answer" : "Direction for the next step"}
                <textarea
                  className="mt-1 w-full rounded border bg-background p-2"
                  maxLength={4000}
                  value={text}
                  disabled={locked}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <button
                className="rounded border px-2 py-1 text-sm"
                disabled={locked || !text.trim()}
                onClick={() =>
                  command(
                    run.status === "waiting_for_user"
                      ? { type: "answer", questionId: run.question?.id, text }
                      : { type: "direction", id: crypto.randomUUID(), text },
                  )
                }
              >
                {run.status === "waiting_for_user" ? "Answer question" : "Queue direction"}
              </button>
            </div>
          )}
          {run.directions.map((direction) => (
            <div key={direction.id} className="flex gap-3 text-sm">
              <p className="whitespace-pre-wrap">{direction.text}</p>
              <button
                disabled={locked}
                onClick={() => command({ type: "remove_direction", id: direction.id })}
              >
                Remove queued direction
              </button>
            </div>
          ))}
          {run.approval && run.status === "approval_required" && (
            <div className="rounded border p-3">
              <p className="font-medium">
                Review action: {run.approval.action.replaceAll("_", " ")}
              </p>
              <p className="text-sm">
                Approval applies once to the exact input below. It does not grant general
                permission.
              </p>
              <pre className="my-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                {run.approval.canonicalInput}
              </pre>
              <p className="break-all text-xs">Input SHA-256: {run.approval.inputHash}</p>
              <div className="mt-2 flex gap-2">
                {(["approve", "deny"] as const).map((type) => (
                  <button
                    key={type}
                    className="rounded border px-2 py-1 text-sm"
                    disabled={locked || Date.now() >= run.approval!.expiresAt}
                    onClick={() =>
                      command({
                        type,
                        approvalId: run.approval!.id,
                        actionRevision: run.approval!.revision,
                        inputHash: run.approval!.inputHash,
                        canonicalInput: run.approval!.canonicalInput,
                      })
                    }
                  >
                    {type === "approve" ? "Approve this action once" : "Deny action"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {run.outputRefs.length > 0 && (
            <p className="text-sm">
              {run.outputRefs.length} saved Library result{run.outputRefs.length === 1 ? "" : "s"}.{" "}
              <a className="underline" href="/library">
                Open Library
              </a>
            </p>
          )}
          {run.evidence.map((item, index) => (
            <p key={index} className="whitespace-pre-wrap text-sm">
              {item}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
