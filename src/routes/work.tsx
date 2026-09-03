import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  Download,
  FileText,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/components/auth/ClerkSafe";
import { RealtimeReadiness } from "@/components/RealtimeReadiness";
import { EmptyState, ErrorState } from "@/components/states";
import { RelatedWorkspaceItems } from "@/components/WorkspaceIntelligence";
import {
  controlWorkRun,
  decideApproval,
  deleteDeliverable,
  downloadDeliverable,
  duplicateDeliverable,
  getWorkRun,
  listWorkRuns,
  listDeliverableVersions,
  renameDeliverable,
  restoreDeliverableRevision,
  type WorkDeliverable,
  type WorkDetail,
  type WorkRun,
} from "@/lib/work.functions";
import { calculateCriticalPath, dagLayout } from "@/lib/work-graph.mjs";
import { parseWorkRunList } from "@/lib/work-response.mjs";
import {
  browserStoragePrincipal,
  consumePrincipalHandoff,
  safeBrowserStorage,
  writePrincipalHandoff,
} from "@/lib/principal-browser-storage.mjs";

export const Route = createFileRoute("/work")({
  component: WorkRoute,
  head: () => ({
    meta: [{ title: "KovaGPT Work" }, { name: "robots", content: "noindex" }],
  }),
});
const terminal = new Set(["completed", "failed", "cancelled"]);
const statusTone: Record<string, string> = {
  completed: "bg-emerald-500",
  running: "bg-blue-500",
  leased: "bg-blue-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
  paused: "bg-amber-500",
  approval_required: "bg-violet-500",
  retrying: "bg-orange-500",
};

type PreparedWorkDraft = {
  objective: string;
  context: string;
  plan: string[];
};

function isPreparedWorkDraft(value: unknown): value is PreparedWorkDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PreparedWorkDraft>;
  return (
    typeof draft.objective === "string" &&
    draft.objective.trim().length > 0 &&
    typeof draft.context === "string" &&
    Array.isArray(draft.plan) &&
    draft.plan.length > 0 &&
    draft.plan.every((step) => typeof step === "string" && step.trim().length > 0)
  );
}
function factualStatus(run: WorkRun) {
  if (!terminal.has(run.status))
    return `Execution unavailable · stored status: ${run.status.replaceAll("_", " ")}`;
  return run.status.replaceAll("_", " ");
}

function WorkRoute() {
  const { isLoaded, user } = useUser();
  const userKey = user?.id ?? null;
  const principal = browserStoragePrincipal(isLoaded ? userKey : undefined);
  const fetchRuns = useServerFn(listWorkRuns),
    fetchDetail = useServerFn(getWorkRun),
    control = useServerFn(controlWorkRun);
  const [runs, setRuns] = useState<WorkRun[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<WorkDetail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [tab, setTab] = useState<"graph" | "timeline" | "evidence" | "deliverables" | "approvals">(
      "graph",
    );
  const [draftState, setDraftState] = useState<{
    principal: string | null;
    draft: PreparedWorkDraft | null;
  }>({ principal: null, draft: null });
  const runRequestId = useRef(0),
    detailRequestId = useRef(0),
    selectedRef = useRef<string | null>(null);
  const loadDetail = useCallback(
    async (id: string | null = selectedRef.current) => {
      const requestId = ++detailRequestId.current;
      if (!id) {
        setDetail(null);
        return;
      }
      try {
        const nextDetail = await fetchDetail({ data: { id } });
        if (requestId !== detailRequestId.current || selectedRef.current !== id) return;
        setDetail(nextDetail);
        setError(null);
      } catch {
        if (requestId !== detailRequestId.current || selectedRef.current !== id) return;
        setDetail(null);
        setError("The selected run could not be loaded.");
      }
    },
    [fetchDetail],
  );

  useEffect(() => {
    if (!isLoaded || !principal) {
      setDraftState({ principal: null, draft: null });
      return;
    }
    const result = consumePrincipalHandoff<PreparedWorkDraft>(
      safeBrowserStorage("sessionStorage"),
      "kova-work-draft",
      userKey,
    );
    if (result.ok && isPreparedWorkDraft(result.value)) {
      setDraftState({ principal, draft: result.value });
      return;
    }
    setDraftState({ principal, draft: null });
    if (!result.ok && result.reason !== "missing") {
      toast.error("Prepared Work context could not be loaded.");
    } else if (result.ok) {
      toast.error("Prepared Work context was invalid and was not opened.");
    }
  }, [isLoaded, principal, userKey]);

  const preparedDraft = draftState.principal === principal ? draftState.draft : null;

  function continuePreparedDraftInChat() {
    if (!preparedDraft || !isLoaded) return;
    const prompt = [
      "Continue this prepared work in chat without claiming background execution.",
      `Objective: ${preparedDraft.objective}`,
      `Context: ${preparedDraft.context || "None provided"}`,
      `Plan:\n${preparedDraft.plan.map((step) => `- ${step}`).join("\n")}`,
    ].join("\n\n");
    const result = writePrincipalHandoff(
      safeBrowserStorage("sessionStorage"),
      "kova-app-chat-context",
      userKey,
      prompt,
    );
    if (!result.ok) {
      toast.error("The prepared draft could not be moved to chat. Reload and try again.");
      return;
    }
    window.location.assign("/");
  }
  const selectRun = useCallback(
    (id: string) => {
      if (selectedRef.current === id) return;
      selectedRef.current = id;
      setSelected(id);
      setDetail(null);
      setError(null);
      void loadDetail(id);
    },
    [loadDetail],
  );
  const loadRuns = useCallback(async () => {
    const requestId = ++runRequestId.current;
    setLoading(true);
    try {
      const rows = parseWorkRunList(await fetchRuns());
      if (requestId !== runRequestId.current) return;
      const currentSelection = selectedRef.current;
      let nextSelection = rows[0]?.id ?? null;
      if (currentSelection && rows.some((run) => run.id === currentSelection))
        nextSelection = currentSelection;
      setRuns(rows);
      if (nextSelection !== currentSelection) {
        selectedRef.current = nextSelection;
        setSelected(nextSelection);
        setDetail(null);
      }
      setError(null);
      await loadDetail(nextSelection);
    } catch {
      if (requestId !== runRequestId.current) return;
      detailRequestId.current += 1;
      selectedRef.current = null;
      setRuns([]);
      setSelected(null);
      setDetail(null);
      setError("Work runs could not be loaded.");
    } finally {
      if (requestId === runRequestId.current) setLoading(false);
    }
  }, [fetchRuns, loadDetail]);
  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);
  async function cancelRun() {
    if (!selected) return;
    try {
      await control({ data: { id: selected, action: "cancel" } });
      await loadRuns();
    } catch {
      toast.error("The historical run could not be cancelled. Reload and try again.");
    }
  }
  return (
    <AppShell>
      <main
        className="mx-auto flex h-[calc(100dvh-1rem)] w-full max-w-[1600px] gap-3 p-3"
        aria-label="Work center"
      >
        <aside className="hidden w-72 shrink-0 overflow-y-auto rounded-3xl border bg-card p-3 md:block">
          <div className="mb-3 flex items-center justify-between px-2">
            <h1 className="text-xl font-semibold">Work</h1>
            <RealtimeReadiness resource="Work" />
            <button onClick={() => void loadRuns()} aria-label="Refresh runs">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          {runs.map((run) => (
            <button
              key={run.id}
              onClick={() => selectRun(run.id)}
              className={`mb-2 w-full rounded-2xl border p-3 text-left ${selected === run.id ? "border-primary bg-primary/5" : ""}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium capitalize">
                <i
                  className={`h-2 w-2 rounded-full ${statusTone[run.status] ?? "bg-muted-foreground"}`}
                />
                {run.kind} run
              </span>
              <span className="mt-1 block text-xs capitalize text-muted-foreground">
                {factualStatus(run)}
              </span>
              <time className="text-xs text-muted-foreground">
                {new Date(run.createdAt).toLocaleString()}
              </time>
            </button>
          ))}
        </aside>
        <section className="min-w-0 flex-1 overflow-hidden rounded-3xl border bg-card">
          {preparedDraft ? (
            <div className="h-full overflow-y-auto p-5 sm:p-8">
              <div className="mx-auto max-w-3xl">
                <p className="text-sm font-medium text-muted-foreground">Prepared Work draft</p>
                <h1 className="mt-2 text-2xl font-semibold">{preparedDraft.objective}</h1>
                <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  This draft was recovered, but no background run has started. Work execution is
                  unavailable; continue in chat to work through the plan now.
                </p>
                <section className="mt-6" aria-labelledby="prepared-plan-title">
                  <h2 id="prepared-plan-title" className="font-semibold">
                    Prepared plan
                  </h2>
                  <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                    {preparedDraft.plan.map((step, index) => (
                      <li key={`${index}-${step}`}>{step}</li>
                    ))}
                  </ol>
                </section>
                <details className="mt-6 rounded-xl border border-border p-4">
                  <summary className="cursor-pointer font-medium">Attached context</summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">
                    {preparedDraft.context || "No additional context was provided."}
                  </pre>
                </details>
                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={continuePreparedDraftInChat}
                    className="min-h-11 rounded-xl bg-foreground px-4 text-sm font-medium text-background"
                  >
                    Continue in chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftState({ principal, draft: null })}
                    className="min-h-11 rounded-xl border border-border px-4 text-sm font-medium"
                  >
                    View historical runs
                  </button>
                </div>
              </div>
            </div>
          ) : loading ? (
            <div className="grid h-full place-items-center" role="status">
              <Loader2 className="animate-spin" />
              <span className="sr-only">Loading Work</span>
            </div>
          ) : error && !detail ? (
            <ErrorState
              title="Work unavailable"
              description={error}
              onRetry={() => void loadRuns()}
            />
          ) : !detail ? (
            <EmptyState
              icon={Activity}
              title="No Work runs"
              description="Agent execution is unavailable. Historical records will appear here when present."
            />
          ) : (
            <>
              <header className="border-b p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <i
                        className={`h-2.5 w-2.5 rounded-full ${statusTone[detail.run.status] ?? "bg-muted-foreground"}`}
                      />
                      <h2 className="font-semibold capitalize">{detail.run.kind} run</h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
                      {factualStatus(detail.run)} · {detail.events.length} recorded events
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!terminal.has(detail.run.status) && (
                      <button
                        onClick={() => void cancelRun()}
                        className="work-action text-destructive"
                      >
                        <Square />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  Agent execution is unavailable. Historical records remain readable; active legacy
                  runs can only be cancelled.
                </p>
                <select
                  className="mt-3 min-h-11 w-full rounded-xl border bg-background px-3 md:hidden"
                  value={selected ?? ""}
                  onChange={(e) => selectRun(e.target.value)}
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.kind} · {factualStatus(r)}
                    </option>
                  ))}
                </select>
                <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="Work views">
                  {(["graph", "timeline", "evidence", "deliverables", "approvals"] as const).map(
                    (value) => (
                      <button
                        key={value}
                        onClick={() => setTab(value)}
                        className={`min-h-10 shrink-0 rounded-full px-4 text-sm capitalize ${tab === value ? "bg-foreground text-background" : "hover:bg-muted"}`}
                      >
                        {value}
                        {value === "approvals" &&
                        detail.approvals.some((a) => a.status === "pending")
                          ? " •"
                          : ""}
                      </button>
                    ),
                  )}
                </nav>
              </header>
              <div className="h-[calc(100%-10.5rem)] overflow-y-auto p-4">
                {tab === "graph" && <DependencyGraph detail={detail} />}{" "}
                {tab === "timeline" && <Timeline detail={detail} />}{" "}
                {tab === "evidence" && <Evidence detail={detail} />}{" "}
                {tab === "deliverables" && (
                  <Deliverables items={detail.deliverables} refresh={loadDetail} />
                )}{" "}
                {tab === "approvals" && <Approvals detail={detail} refresh={loadDetail} />}
              </div>
            </>
          )}
        </section>
        <aside className="hidden w-72 shrink-0 overflow-y-auto rounded-3xl border bg-card p-3 xl:block">
          <RelatedWorkspaceItems
            kinds={["project", "context_pack", "file", "artifact", "research", "memory"]}
            title="Recent context for Work"
          />
        </aside>
      </main>
    </AppShell>
  );
}

function DependencyGraph({ detail }: { detail: WorkDetail }) {
  const specialists = useMemo(
    () =>
      detail.tasks.map((task) => ({
        name: task.id,
        label: task.role,
        status: task.status,
        events: detail.events.filter((event) => event.payload.specialist_task_id === task.id)
          .length,
      })),
    [detail],
  );
  const graphNodes = useMemo(
    () =>
      detail.tasks.map((task) => ({
        id: task.id,
        status: task.status,
        durationMs:
          task.startedAt && task.completedAt
            ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
            : null,
      })),
    [detail.tasks],
  );
  const critical = useMemo(
    () => calculateCriticalPath(graphNodes, detail.edges),
    [graphNodes, detail.edges],
  );
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const fit = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setPositions(dagLayout(graphNodes, detail.edges));
  };
  const specialist = specialists.find((item) => item.name === selected);
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Dependency graph</h3>
          <p className="text-sm text-muted-foreground">
            Authoritative persisted task dependencies. No estimated percentage.
          </p>
        </div>
        <div className="flex gap-1" aria-label="Graph controls">
          <button className="work-icon" onClick={() => setScale((s) => Math.max(0.6, s - 0.1))}>
            −
          </button>
          <button className="work-icon" onClick={() => setScale((s) => Math.min(1.6, s + 0.1))}>
            +
          </button>
          <button className="work-small" onClick={fit}>
            Fit
          </button>
        </div>
      </div>
      <div
        className="relative h-[28rem] touch-none overflow-hidden rounded-2xl border bg-muted/20 p-8"
        onWheel={(event) => {
          event.preventDefault();
          setScale((value) => Math.min(1.8, Math.max(0.5, value - event.deltaY * 0.001)));
        }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            event.currentTarget.setPointerCapture(event.pointerId);
            setPanning({ x: event.clientX - offset.x, y: event.clientY - offset.y });
          }
        }}
        onPointerMove={(event) => {
          if (panning) setOffset({ x: event.clientX - panning.x, y: event.clientY - panning.y });
        }}
        onPointerUp={() => setPanning(null)}
        aria-label="Interactive dependency graph"
      >
        <div
          className="relative min-h-80 min-w-[48rem] transition-transform"
          style={{
            transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            aria-label="Persisted dependency edges"
          >
            {detail.edges.map((edge) => {
              const source = positions[edge.source] ?? {
                x: specialists.findIndex((item) => item.name === edge.source) * 260,
                y: 80,
              };
              const target = positions[edge.target] ?? {
                x: specialists.findIndex((item) => item.name === edge.target) * 260,
                y: 80,
              };
              const task = detail.tasks.find((item) => item.id === edge.source);
              const isCritical = critical.criticalEdges.includes(edge.id);
              return (
                <line
                  key={edge.id}
                  x1={source.x + 224}
                  y1={source.y + 55}
                  x2={target.x}
                  y2={target.y + 55}
                  strokeWidth={isCritical ? 4 : 2}
                  className={
                    isCritical
                      ? "stroke-red-500"
                      : task?.status === "completed"
                        ? "stroke-emerald-500"
                        : task?.status === "failed" || task?.status === "blocked"
                          ? "stroke-destructive"
                          : task?.status === "retrying"
                            ? "stroke-orange-500"
                            : task?.status === "approval_required"
                              ? "stroke-violet-500"
                              : "stroke-muted-foreground"
                  }
                />
              );
            })}
          </svg>
          {specialists.length ? (
            specialists.map((item, index) => (
              <div
                key={item.name}
                role="button"
                tabIndex={0}
                aria-label={`${item.label}, ${item.status}`}
                onClick={() => setSelected(item.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(item.name);
                  }
                  const step = 12;
                  if (event.key.startsWith("Arrow")) {
                    event.preventDefault();
                    setPositions((current) => ({
                      ...current,
                      [item.name]: {
                        x:
                          (current[item.name]?.x ?? index * 260) +
                          (event.key === "ArrowRight"
                            ? step
                            : event.key === "ArrowLeft"
                              ? -step
                              : 0),
                        y:
                          (current[item.name]?.y ?? 80) +
                          (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
                      },
                    }));
                  }
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const startX = event.clientX,
                    startY = event.clientY,
                    base = positions[item.name] ?? { x: index * 260, y: 80 };
                  const move = (next: PointerEvent) =>
                    setPositions((current) => ({
                      ...current,
                      [item.name]: {
                        x: base.x + (next.clientX - startX) / scale,
                        y: base.y + (next.clientY - startY) / scale,
                      },
                    }));
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
                className={`absolute w-56 cursor-grab rounded-2xl border bg-card p-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary ${item.status.includes("fail") || item.status.includes("block") ? "border-destructive" : item.status.includes("approval") ? "border-violet-500" : item.status.includes("retry") ? "border-orange-500" : item.status.includes("complete") ? "border-emerald-500" : ""}`}
                style={{
                  left: positions[item.name]?.x ?? index * 260,
                  top: positions[item.name]?.y ?? 80,
                }}
              >
                <span
                  className={`mb-3 block h-1 rounded-full ${statusTone[item.status] ?? (item.status.includes("fail") ? "bg-destructive" : "bg-primary")}`}
                />
                <h4 className="font-medium">{item.label}</h4>
                <p className="text-sm capitalize text-muted-foreground">
                  {item.status.replaceAll("_", " ")}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.events} recorded action{item.events === 1 ? "" : "s"}
                </p>
                {index < specialists.length - 1 && !positions[item.name] && (
                  <span className="absolute -right-8 top-1/2 w-8 border-t" />
                )}
              </div>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">
              Waiting for the first persisted specialist event.
            </div>
          )}
        </div>
        <div
          className="absolute bottom-3 right-3 h-20 w-32 rounded-lg border bg-card/90 p-2"
          aria-label="Graph minimap"
        >
          <div className="relative h-full w-full">
            {specialists.map((item, index) => (
              <i
                key={item.name}
                className={`absolute h-2 w-3 rounded-sm ${statusTone[item.status] ?? "bg-primary"}`}
                style={{
                  left: `${Math.min(90, ((positions[item.name]?.x ?? index * 260) / Math.max(1, specialists.length * 260)) * 100)}%`,
                  top: `${Math.min(85, ((positions[item.name]?.y ?? 80) / 320) * 100)}%`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      {specialist && (
        <aside
          className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-3xl border bg-card p-5 shadow-2xl md:inset-y-4 md:left-auto md:right-4 md:max-h-none md:w-[26rem] md:rounded-3xl"
          aria-label="Specialist inspector"
        >
          <button
            className="absolute right-4 top-4"
            onClick={() => setSelected(null)}
            aria-label="Close specialist inspector"
          >
            <X />
          </button>
          <h3 className="pr-8 text-lg font-semibold">{specialist.name}</h3>
          <p className="capitalize text-sm text-muted-foreground">
            {specialist.status} · {specialist.events} actions
          </p>
          <div className="mt-4 space-y-4">
            {[
              "objective",
              "inputs",
              "outputs",
              "browser",
              "tool",
              "provider",
              "log",
              "memory",
              "handoff",
              "deliverable",
              "screenshot",
              "approval",
            ].map((kind) => {
              const matching = detail.events.filter(
                (event) =>
                  event.type.includes(kind) ||
                  JSON.stringify(event.payload).toLowerCase().includes(kind),
              );
              return (
                <details key={kind} className="rounded-xl border p-3">
                  <summary className="cursor-pointer font-medium capitalize">
                    {kind} events ({matching.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {matching.map((event) => (
                      <pre
                        key={event.id}
                        className="overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground"
                      >
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </aside>
      )}
    </section>
  );
}
function Timeline({ detail }: { detail: WorkDetail }) {
  return (
    <section>
      <h3 className="mb-3 font-semibold">Specialist timeline</h3>
      <ol className="relative ml-2 border-l pl-6">
        {detail.events.map((event) => (
          <li key={event.id} className="mb-5">
            <Circle className="absolute -left-2 h-4 w-4 fill-card" />
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-medium capitalize">{event.type.replaceAll("_", " ")}</p>
              <time className="text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
function Evidence({ detail }: { detail: WorkDetail }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all"),
    [specialist, setSpecialist] = useState("all"),
    [cursor, setCursor] = useState(detail.events.length - 1);
  const specialists = [
    ...new Set(
      detail.events
        .map((item) => String(item.payload.specialist ?? item.payload.specialist_task_id ?? ""))
        .filter(Boolean),
    ),
  ];
  const evidence = detail.events.filter(
    (e) =>
      ["screenshot", "dom_snapshot", "evidence", "browser_event"].includes(e.type) &&
      JSON.stringify(e.payload).toLowerCase().includes(query.toLowerCase()) &&
      (type === "all" || e.type === type) &&
      (specialist === "all" ||
        String(e.payload.specialist ?? e.payload.specialist_task_id) === specialist) &&
      e.id <= Number(detail.events[Math.max(0, cursor)]?.id ?? Infinity),
  );
  return (
    <section>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold">Evidence center</h3>
        <div className="flex flex-wrap gap-2">
          <label className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4" />
            <input
              className="min-h-10 rounded-xl border pl-9 pr-3"
              placeholder="Search evidence"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Evidence type"
            className="min-h-10 rounded-xl border bg-background px-2"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">All types</option>
            <option value="screenshot">Screenshots</option>
            <option value="dom_snapshot">DOM</option>
            <option value="browser_event">Browser</option>
          </select>
          <select
            aria-label="Evidence specialist"
            className="min-h-10 rounded-xl border bg-background px-2"
            value={specialist}
            onChange={(e) => setSpecialist(e.target.value)}
          >
            <option value="all">All specialists</option>
            {specialists.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="mb-4 block text-xs text-muted-foreground">
        Timeline through{" "}
        {detail.events[Math.max(0, cursor)]
          ? new Date(detail.events[Math.max(0, cursor)].createdAt).toLocaleString()
          : "start"}
        <input
          className="mt-1 w-full"
          type="range"
          min="0"
          max={Math.max(0, detail.events.length - 1)}
          value={Math.max(0, cursor)}
          onChange={(e) => setCursor(Number(e.target.value))}
        />
      </label>
      <div className="grid gap-3 lg:grid-cols-2">
        {evidence.map((item) => (
          <article key={item.id} className="overflow-hidden rounded-2xl border">
            <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
              {item.previewUrl && item.type === "screenshot" ? (
                <img
                  src={item.previewUrl}
                  alt={String(item.payload.title ?? "Browser evidence screenshot")}
                  className="h-full w-full object-contain"
                />
              ) : item.type === "dom_snapshot" || item.payload.html ? (
                <iframe
                  title="Stored DOM snapshot"
                  sandbox=""
                  srcDoc={String(item.payload.html ?? item.payload.dom ?? "")}
                  className="h-full w-full bg-white"
                />
              ) : (
                <Globe className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="p-3">
              <p className="font-medium capitalize">{item.type.replaceAll("_", " ")}</p>
              <p className="truncate text-sm text-muted-foreground">
                {String(item.payload.title ?? item.payload.url ?? "Stored execution evidence")}
              </p>
              <dl className="mt-2 text-xs text-muted-foreground">
                <dt>SHA-256</dt>
                <dd className="break-all font-mono">
                  {String(item.payload.sha256 ?? "Not supplied")}
                </dd>
              </dl>
              {item.previewUrl && (
                <a
                  href={item.previewUrl}
                  download
                  className="mt-3 inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs"
                >
                  <Download className="h-4 w-4" />
                  Download
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      {!evidence.length && (
        <EmptyState
          icon={Globe}
          title="No matching evidence"
          description="Screenshots, DOM snapshots, URLs, and hashes appear only after the worker persists them."
        />
      )}
    </section>
  );
}
function Deliverables({
  items,
  refresh,
}: {
  items: WorkDeliverable[];
  refresh: () => Promise<void>;
}) {
  const rename = useServerFn(renameDeliverable),
    remove = useServerFn(deleteDeliverable),
    duplicate = useServerFn(duplicateDeliverable),
    download = useServerFn(downloadDeliverable),
    versions = useServerFn(listDeliverableVersions),
    restoreRevision = useServerFn(restoreDeliverableRevision);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<WorkDeliverable[] | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const shown = items.filter((i) =>
    `${i.title} ${i.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function action(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast.success(message);
      await refresh();
    } catch {
      toast.error("Deliverable action failed.");
    }
  }
  return (
    <section>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold">Deliverables</h3>
        <input
          className="min-h-10 rounded-xl border px-3"
          placeholder="Search deliverables"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((item) => (
          <article key={item.id} className="rounded-2xl border p-4">
            <div className="flex gap-3">
              <FileText className="h-5 w-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.title}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {item.type.replaceAll("_", " ")} · revision {item.revision}
                </p>
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {item.integrityHash}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {renamingId === item.id ? (
                <form
                  className="flex min-w-0 flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const title = renameValue.trim();
                    if (!title) return;
                    void action(() => rename({ data: { id: item.id, title } }), "Renamed").then(
                      () => setRenamingId(null),
                    );
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Deliverable title"
                    maxLength={160}
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => event.key === "Escape" && setRenamingId(null)}
                    className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
                  />
                  <button className="work-small" type="submit" disabled={!renameValue.trim()}>
                    Save
                  </button>
                  <button className="work-small" type="button" onClick={() => setRenamingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  className="work-small"
                  onClick={() => {
                    setRenameValue(item.title);
                    setRenamingId(item.id);
                  }}
                >
                  Rename
                </button>
              )}
              <button
                className="work-small"
                onClick={() =>
                  void action(() => duplicate({ data: { id: item.id } }), "Duplicated")
                }
              >
                Duplicate
              </button>
              <button
                className="work-small"
                onClick={() =>
                  void versions({ data: { id: item.id } })
                    .then(setHistory)
                    .catch(() => toast.error("Version history unavailable."))
                }
              >
                Versions
              </button>
              <button
                className="work-small"
                onClick={() =>
                  void action(async () => {
                    const result = await download({ data: { id: item.id } });
                    location.assign(result.url);
                  }, "Download ready")
                }
              >
                <Download />
                Download
              </button>
              <button
                className="work-small text-destructive"
                onClick={() =>
                  void action(() => remove({ data: { id: item.id } }), "Moved to deleted items")
                }
              >
                <Trash2 />
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {!shown.length && (
        <EmptyState
          icon={FileText}
          title="No deliverables"
          description="Generated Project, Library, Research, Context Pack, Markdown, JSON, and CSV outputs appear here."
        />
      )}
      {history && (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center sm:p-4"
          onClick={() => setHistory(null)}
        >
          <section
            className="max-h-[80dvh] w-full overflow-y-auto rounded-t-3xl bg-card p-5 sm:max-w-2xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
            aria-label="Version history"
          >
            <div className="flex justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold">Version history</h4>
                <p className="text-sm text-muted-foreground">
                  Compare integrity and metadata before restoring.
                </p>
              </div>
              <button onClick={() => setHistory(null)} aria-label="Close version history">
                <X />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {history.map((version, index) => (
                <article key={version.id} className="rounded-2xl border p-3">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        Revision {version.revision}: {version.title}
                      </p>
                      <time className="text-xs text-muted-foreground">
                        {new Date(version.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <button
                      className="work-small"
                      onClick={() =>
                        void action(
                          () => restoreRevision({ data: { id: version.id } }),
                          `Revision ${version.revision} restored`,
                        )
                      }
                    >
                      Restore
                    </button>
                  </div>
                  <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                    SHA-256 {version.integrityHash}
                  </p>
                  {history[index + 1] && (
                    <p className="mt-2 text-xs">
                      Compared with revision {history[index + 1].revision}:{" "}
                      {history[index + 1].integrityHash === version.integrityHash
                        ? "content hash unchanged"
                        : "content hash changed"}
                      ;{" "}
                      {history[index + 1].title === version.title
                        ? "title unchanged"
                        : "title changed"}
                      .
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
function Approvals({ detail, refresh }: { detail: WorkDetail; refresh: () => Promise<void> }) {
  const decide = useServerFn(decideApproval);
  async function deny(id: string) {
    try {
      await decide({ data: { id, decision: "denied" } });
      await refresh();
    } catch {
      toast.error("Approval is no longer pending.");
    }
  }
  return (
    <section>
      <h3 className="mb-3 font-semibold">Approval center</h3>
      <div className="space-y-3">
        {detail.approvals.map((a) => (
          <article key={a.id} className="rounded-2xl border p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle
                className={`h-5 w-5 ${a.risk === "high" ? "text-destructive" : "text-amber-500"}`}
              />
              <div className="flex-1">
                <div className="flex justify-between gap-2">
                  <h4 className="font-medium">{a.tool}</h4>
                  <span className="text-xs uppercase text-muted-foreground">
                    {a.risk} risk · {a.status}
                  </span>
                </div>
                <p className="mt-1 text-sm">{a.reason}</p>
                <p className="mt-1 text-sm text-muted-foreground">Destination: {a.destination}</p>
                {a.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <button className="work-small text-destructive" onClick={() => void deny(a.id)}>
                      <X />
                      Deny
                    </button>
                    <span className="self-center text-xs text-muted-foreground">
                      Approval is disabled while execution is unavailable.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!detail.approvals.length && (
        <EmptyState
          icon={Check}
          title="No approvals"
          description="Consequential actions appear here with their exact tool, destination, reason, and risk."
        />
      )}
    </section>
  );
}
