import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const functionsPath = "src/lib/work.functions.ts";
const routePath = "src/routes/work.tsx";

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  assert.notEqual(index, -1, `${label}: expected source was not found`);
  assert.equal(
    source.indexOf(before, index + before.length),
    -1,
    `${label}: expected source was not unique`,
  );
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchFunctions() {
  let source = readFileSync(functionsPath, "utf8");
  if (source.includes("export const createWorkRun = createServerFn")) {
    assert.match(source, /owner_create_work_job_v2/u);
    assert.match(source, /owner_control_work_job_v2/u);
    assert.match(source, /owner_decide_work_approval_v2/u);
    return false;
  }

  source = replaceOnce(
    source,
    "const db = (value: unknown) => value as Db;\n",
    `const db = (value: unknown) => value as Db;

// Source remains fail-closed. Operations may enable model-only Work only after
// the exact image, schema, worker heartbeat, and canary are independently proven.
export const workExecutionAvailable = false;
export function workExecutionRuntimeAvailable(): boolean {
  const runtimeValue =
    typeof process === "undefined" ? undefined : process.env.KOVA_WORK_EXECUTION_ENABLED;
  return workExecutionAvailable || runtimeValue === "1" || runtimeValue === "true";
}

function requireWorkRuntime(): void {
  if (!workExecutionRuntimeAvailable()) {
    throw new Error("Work execution is not available in this deployment.");
  }
}
`,
    "Work runtime source boundary",
  );

  source = replaceOnce(
    source,
    "export const listWorkRuns = createServerFn({ method: \"GET\" })",
    `const createWorkSchema = z.object({
  objective: z.string().trim().min(1).max(12000),
  projectId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export const getWorkExecutionAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{
    executionAvailable: boolean;
    mode: "model_only_v2" | "history_only";
  }> => {
    const executionAvailable = workExecutionRuntimeAvailable();
    return {
      executionAvailable,
      mode: executionAvailable ? "model_only_v2" : "history_only",
    };
  });

export const createWorkRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => createWorkSchema.parse(value))
  .handler(async ({ data, context }): Promise<WorkRun> => {
    requireWorkRuntime();
    const result = await db(context.supabase).rpc("owner_create_work_job_v2", {
      p_objective: data.objective,
      p_project_id: data.projectId ?? null,
      p_idempotency_key: data.idempotencyKey,
      p_allowed_domains: [],
      p_tool_policy: { allowed_tools: [] },
      p_token_budget: 12000,
    });
    if (result.error || !result.data) {
      console.error("[work] create failed", { code: result.error?.code ?? "unknown" });
      throw new Error("Work could not be started.");
    }
    return mapRun(result.data);
  });

export const listWorkRuns = createServerFn({ method: "GET" })`,
    "Work creation functions",
  );

  const oldControl = `export const controlWorkRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.literal("cancel"),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await db(context.supabase).rpc("control_agent_job", {
      p_job_id: data.id,
      p_action: data.action,
    });
    if (error || !row) throw new Error("Run state changed; reload and try again");
    return row;
  });`;
  const newControl = `export const controlWorkRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["pause", "resume", "cancel", "delete"]),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    if (workExecutionRuntimeAvailable()) {
      const result = await client.rpc("owner_control_work_job_v2", {
        p_job_id: data.id,
        p_action: data.action,
      });
      if (result.error || !result.data) {
        throw new Error("Run state changed; reload and try again");
      }
      return mapRun(result.data);
    }

    if (data.action !== "cancel") {
      throw new Error("Work execution is unavailable, so this action cannot be completed.");
    }
    const legacy = await client.rpc("control_agent_job", {
      p_job_id: data.id,
      p_action: data.action,
    });
    if (legacy.error || !legacy.data) {
      throw new Error("Run state changed; reload and try again");
    }
    return legacy.data;
  });`;
  source = replaceOnce(source, oldControl, newControl, "Work lifecycle controls");

  const oldApproval = `export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.literal("denied"),
        editedRequest: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase).rpc("decide_agent_approval", {
      p_approval_id: data.id,
      p_decision: data.decision,
      p_edited_request: data.editedRequest,
    });
    if (error) throw new Error("Approval is no longer pending");
    return { ok: true };
  });`;
  const newApproval = `export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "denied"]),
        editedRequest: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    if (workExecutionRuntimeAvailable()) {
      const result = await client.rpc("owner_decide_work_approval_v2", {
        p_approval_id: data.id,
        p_decision: data.decision,
        p_edited_request: data.editedRequest ?? null,
      });
      if (result.error || !result.data) throw new Error("Approval is no longer pending");
      return { ok: true };
    }

    if (data.decision !== "denied") {
      throw new Error("Approval is disabled while Work execution is unavailable.");
    }
    const legacy = await client.rpc("decide_agent_approval", {
      p_approval_id: data.id,
      p_decision: data.decision,
      p_edited_request: data.editedRequest,
    });
    if (legacy.error) throw new Error("Approval is no longer pending");
    return { ok: true };
  });`;
  source = replaceOnce(source, oldApproval, newApproval, "Work approval decisions");

  writeFileSync(functionsPath, source);
  return true;
}

function patchRoute() {
  let source = readFileSync(routePath, "utf8");
  if (source.includes("<WorkRunComposer")) {
    assert.match(source, /getWorkExecutionAvailability/u);
    assert.match(source, /executionAvailable=\{executionAvailable\}/u);
    return false;
  }

  source = replaceOnce(
    source,
    "  Loader2,\n  RefreshCw,",
    "  Loader2,\n  Pause,\n  Play,\n  RefreshCw,",
    "Work lifecycle icons",
  );
  source = replaceOnce(
    source,
    'import { AppShell } from "@/components/AppShell";\n',
    'import { AppShell } from "@/components/AppShell";\nimport { WorkRunComposer } from "@/components/WorkRunComposer";\n',
    "Work composer import",
  );
  source = replaceOnce(
    source,
    "  controlWorkRun,\n  decideApproval,",
    "  controlWorkRun,\n  decideApproval,\n  getWorkExecutionAvailability,",
    "Work availability import",
  );
  source = replaceOnce(
    source,
    `function factualStatus(run: WorkRun) {
  if (!terminal.has(run.status))
    return \`Execution unavailable · stored status: \${run.status.replaceAll("_", " ")}\`;
  return run.status.replaceAll("_", " ");
}`,
    `function factualStatus(run: WorkRun, executionAvailable: boolean) {
  if (!executionAvailable && !terminal.has(run.status))
    return \`Execution unavailable · stored status: \${run.status.replaceAll("_", " ")}\`;
  return run.status.replaceAll("_", " ");
}`,
    "factual Work status",
  );
  source = replaceOnce(
    source,
    `  const fetchRuns = useServerFn(listWorkRuns),
    fetchDetail = useServerFn(getWorkRun),
    control = useServerFn(controlWorkRun);`,
    `  const fetchRuns = useServerFn(listWorkRuns),
    fetchDetail = useServerFn(getWorkRun),
    control = useServerFn(controlWorkRun),
    getAvailability = useServerFn(getWorkExecutionAvailability);`,
    "Work server functions",
  );
  source = replaceOnce(
    source,
    `    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),`,
    `    [loading, setLoading] = useState(true),
    [executionAvailable, setExecutionAvailable] = useState(false),
    [error, setError] = useState<string | null>(null),`,
    "Work availability state",
  );
  source = replaceOnce(
    source,
    `  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);`,
    `  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);
  useEffect(() => {
    void getAvailability()
      .then((result) => setExecutionAvailable(result.executionAvailable === true))
      .catch(() => setExecutionAvailable(false));
  }, [getAvailability]);`,
    "Work availability load",
  );
  source = replaceOnce(
    source,
    `  async function cancelRun() {
    if (!selected) return;
    try {
      await control({ data: { id: selected, action: "cancel" } });
      await loadDetail();
      await loadRuns();
    } catch {
      toast.error("The historical run could not be cancelled. Reload and try again.");
    }
  }`,
    `  async function runAction(action: "pause" | "resume" | "cancel" | "delete") {
    if (!selected) return;
    try {
      await control({ data: { id: selected, action } });
      if (action === "delete") setSelected(null);
      await loadRuns();
      if (action !== "delete") await loadDetail();
    } catch {
      toast.error("The Work run changed or this action is unavailable. Reload and try again.");
    }
  }`,
    "Work lifecycle action",
  );

  source = source.replaceAll("factualStatus(run)", "factualStatus(run, executionAvailable)");
  source = source.replaceAll("factualStatus(r)", "factualStatus(r, executionAvailable)");

  source = replaceOnce(
    source,
    `        <section className="min-w-0 flex-1 overflow-hidden rounded-3xl border bg-card">
          {loading ? (`,
    `        <section className="min-w-0 flex-1 overflow-hidden rounded-3xl border bg-card">
          {executionAvailable ? (
            <div className="border-b p-4">
              <WorkRunComposer
                onCreated={(run) => {
                  setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
                  setSelected(run.id);
                }}
              />
            </div>
          ) : null}
          {loading ? (`,
    "Work composer surface",
  );
  source = replaceOnce(
    source,
    `              description="Agent execution is unavailable. Historical records will appear here when present."
`,
    `              description={
                executionAvailable
                  ? "Start model-only Work to create a durable reasoning or writing run."
                  : "Agent execution is unavailable. Historical records will appear here when present."
              }
`,
    "Work empty-state truthfulness",
  );

  const oldControls = `                  <div className="flex gap-2">
                    {!terminal.has(detail.run.status) && (
                      <button
                        onClick={() => void cancelRun()}
                        className="work-action text-destructive"
                      >
                        <Square />
                        Cancel
                      </button>
                    )}
                  </div>`;
  const newControls = `                  <div className="flex flex-wrap gap-2">
                    {executionAvailable &&
                    ["queued", "leased", "running", "retrying", "approval_required"].includes(
                      detail.run.status,
                    ) ? (
                      <button onClick={() => void runAction("pause")} className="work-action">
                        <Pause />
                        Pause
                      </button>
                    ) : null}
                    {executionAvailable && detail.run.status === "paused" ? (
                      <button onClick={() => void runAction("resume")} className="work-action">
                        <Play />
                        Resume
                      </button>
                    ) : null}
                    {!terminal.has(detail.run.status) ? (
                      <button
                        onClick={() => void runAction("cancel")}
                        className="work-action text-destructive"
                      >
                        <Square />
                        Cancel
                      </button>
                    ) : executionAvailable ? (
                      <button
                        onClick={() => void runAction("delete")}
                        className="work-action text-destructive"
                      >
                        <Trash2 />
                        Delete
                      </button>
                    ) : null}
                  </div>`;
  source = replaceOnce(source, oldControls, newControls, "Work lifecycle buttons");

  source = replaceOnce(
    source,
    `                <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  Agent execution is unavailable. Historical records remain readable; active legacy
                  runs can only be cancelled.
                </p>`,
    `                <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  {executionAvailable
                    ? "Model-only Work is enabled for durable reasoning and writing. Browser and external tool actions remain unavailable."
                    : "Agent execution is unavailable. Historical records remain readable; active legacy runs can only be cancelled."}
                </p>`,
    "Work runtime disclosure",
  );
  source = replaceOnce(
    source,
    `{tab === "approvals" && <Approvals detail={detail} refresh={loadDetail} />}`,
    `{tab === "approvals" && (
                  <Approvals
                    detail={detail}
                    refresh={loadDetail}
                    executionAvailable={executionAvailable}
                  />
                )}`,
    "Work approval availability",
  );

  const oldApprovals = `function Approvals({ detail, refresh }: { detail: WorkDetail; refresh: () => Promise<void> }) {
  const decide = useServerFn(decideApproval);
  async function deny(id: string) {
    try {
      await decide({ data: { id, decision: "denied" } });
      await refresh();
    } catch {
      toast.error("Approval is no longer pending.");
    }
  }`;
  const newApprovals = `function Approvals({
  detail,
  refresh,
  executionAvailable,
}: {
  detail: WorkDetail;
  refresh: () => Promise<void>;
  executionAvailable: boolean;
}) {
  const decide = useServerFn(decideApproval);
  async function decidePending(id: string, decision: "approved" | "denied") {
    try {
      await decide({ data: { id, decision } });
      await refresh();
    } catch {
      toast.error("Approval is no longer pending or execution is unavailable.");
    }
  }`;
  source = replaceOnce(source, oldApprovals, newApprovals, "Work approval handler");
  source = replaceOnce(
    source,
    `<button className="work-small text-destructive" onClick={() => void deny(a.id)}>
                      <X />
                      Deny
                    </button>
                    <span className="self-center text-xs text-muted-foreground">
                      Approval is disabled while execution is unavailable.
                    </span>`,
    `{executionAvailable ? (
                      <button
                        className="work-small"
                        onClick={() => void decidePending(a.id, "approved")}
                      >
                        <Check />
                        Approve
                      </button>
                    ) : null}
                    <button
                      className="work-small text-destructive"
                      onClick={() => void decidePending(a.id, "denied")}
                    >
                      <X />
                      Deny
                    </button>
                    {!executionAvailable ? (
                      <span className="self-center text-xs text-muted-foreground">
                        Approval is disabled while execution is unavailable.
                      </span>
                    ) : null}`,
    "Work approval buttons",
  );

  writeFileSync(routePath, source);
  return true;
}

const changed = [];
if (patchFunctions()) changed.push(functionsPath);
if (patchRoute()) changed.push(routePath);

console.log(`KOVAGPT_WORK_V2_PRODUCT_APPLIED=${changed.length}`);
for (const path of changed) console.log(path);
