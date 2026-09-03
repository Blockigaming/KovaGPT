import type { AuthedCaller } from "@/lib/api-auth.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { AGENT_LIMITS, getAgentEntitlement } from "./execution.server";
import { validateTaskGraph, type AgentTaskInput } from "./team";

// Tables in the Apollo migration are intentionally ahead of generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedClient = any;
const raw = (caller: AuthedCaller) => caller.supabaseAdmin as unknown as UntypedClient;
export async function createAgentTeamRun(
  caller: AuthedCaller,
  input: {
    objective: string;
    projectId?: string;
    idempotencyKey: string;
    tasks: AgentTaskInput[];
    context: string[];
  },
) {
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
  const entitlement = await getAgentEntitlement(caller);
  if (!entitlement) throw new Error("agent_plan_required");
  const errors = validateTaskGraph(input.tasks);
  if (errors.length) throw new Error(errors[0]);
  const limits = AGENT_LIMITS[entitlement];
  const maxTeam =
    entitlement === "plus" ? 4 : entitlement === "pro" ? 12 : entitlement === "business" ? 20 : 40;
  if (input.tasks.length > maxTeam) throw new Error("agent_team_limit");
  if (!input.objective.trim() || input.objective.length > 4000)
    throw new Error("invalid_objective");
  const db = raw(caller);
  const { data: run, error } = await db
    .from("agent_runs")
    .upsert(
      {
        owner_id: caller.userId,
        project_id: input.projectId || null,
        entitlement,
        idempotency_key: input.idempotencyKey,
        objective: input.objective.trim(),
        plan: {
          type: "dependency_graph",
          taskCount: input.tasks.length,
          context: input.context.slice(0, 30),
        },
        policy: {
          parallelism: limits.concurrency,
          maxRuntimeMs: limits.maxRuntimeMs,
          contextSources: input.context.slice(0, 30),
        },
        status: "queued",
      },
      { onConflict: "owner_id,idempotency_key", ignoreDuplicates: true },
    )
    .select("id,status,entitlement,created_at")
    .maybeSingle();
  if (error || !run) throw new Error("agent_team_create_failed");
  const safeRun = run as unknown as {
    id: string;
    status: string;
    entitlement: string;
    created_at: string;
  };
  const rows = input.tasks.map((item) => ({
    run_id: safeRun.id,
    owner_id: caller.userId,
    client_key: item.key,
    agent_role: item.role,
    title: item.title.slice(0, 200),
    instructions: item.instructions.slice(0, 8000),
    dependencies: item.dependencies,
    checkpoint: item.checkpoint ?? false,
    reusable_subplan: item.reusableSubplan ?? null,
    status: item.dependencies.length ? "waiting" : "queued",
  }));
  const inserted = await db.from("agent_run_tasks").insert(rows as never);
  if (inserted.error) {
    await db.from("agent_runs").delete().eq("id", safeRun.id).eq("owner_id", caller.userId);
    throw new Error("agent_tasks_store_failed");
  }
  await db.from("agent_run_events").insert({
    run_id: safeRun.id,
    owner_id: caller.userId,
    kind: "plan",
    safe_payload: {
      type: "dependency_graph",
      agents: input.tasks.map((item) => ({
        key: item.key,
        role: item.role,
        dependencies: item.dependencies,
      })),
      contextSourceCount: input.context.length,
    },
  } as never);
  return safeRun;
}

export async function getAgentTeamRuns(caller: AuthedCaller, runId?: string) {
  const db = raw(caller);
  let runsQuery = db
    .from("agent_runs")
    .select(
      "id,project_id,entitlement,objective,status,current_step,attempt,max_attempts,usage,created_at,updated_at,cancelled_at",
    )
    .eq("owner_id", caller.userId)
    .order("created_at", { ascending: false })
    .limit(runId ? 1 : 20);
  if (runId) runsQuery = runsQuery.eq("id", runId);
  const { data: runs, error } = await runsQuery;
  if (error) throw new Error("agent_runs_unavailable");
  const ids = ((runs ?? []) as unknown as { id: string }[]).map((item) => item.id);
  if (!ids.length) return { runs: [], tasks: [], events: [] };
  const [{ data: tasks }, { data: events }] = await Promise.all([
    db
      .from("agent_run_tasks")
      .select(
        "id,run_id,parent_task_id,client_key,agent_role,title,dependencies,checkpoint,status,attempt,max_attempts,progress,output_text,output_metadata,started_at,completed_at,updated_at",
      )
      .eq("owner_id", caller.userId)
      .in("run_id", ids)
      .order("created_at"),
    db
      .from("agent_run_events")
      .select("run_id,kind,safe_payload,evidence_sha256,created_at")
      .eq("owner_id", caller.userId)
      .in("run_id", ids)
      .order("created_at"),
  ]);
  const safeEvents = [];
  for (const event of (events ?? []) as unknown as {
    run_id: string;
    kind: string;
    safe_payload: Record<string, unknown>;
    evidence_sha256?: string;
    created_at: string;
  }[]) {
    const storagePath =
      event.kind === "screenshot" && typeof event.safe_payload?.storagePath === "string"
        ? event.safe_payload.storagePath
        : null;
    if (!storagePath || !storagePath.startsWith(`${caller.userId}/`)) {
      safeEvents.push(event);
      continue;
    }
    const { data: signed } = await caller.supabaseAdmin.storage
      .from("agent-evidence")
      .createSignedUrl(storagePath, 300);
    const payload = { ...event.safe_payload };
    delete payload.storagePath;
    safeEvents.push({
      ...event,
      safe_payload: { ...payload, screenshotUrl: signed?.signedUrl ?? null },
    });
  }
  return { runs: runs ?? [], tasks: tasks ?? [], events: safeEvents };
}

export async function controlAgentTeamRun(
  caller: AuthedCaller,
  runId: string,
  command: "pause" | "resume" | "cancel" | "retry" | "approve" | "deny",
  taskId?: string,
) {
  if (["resume", "retry", "approve"].includes(command)) {
    await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
  }
  const db = raw(caller);
  const { data: run } = await db
    .from("agent_runs")
    .select("id,status")
    .eq("id", runId)
    .eq("owner_id", caller.userId)
    .maybeSingle();
  if (!run) throw new Error("agent_run_not_found");
  if (command === "pause") {
    await db
      .from("agent_runs")
      .update({ status: "paused" })
      .eq("id", runId)
      .eq("owner_id", caller.userId);
    await db
      .from("agent_run_tasks")
      .update({ status: "waiting", lease_owner: null, lease_expires_at: null })
      .eq("run_id", runId)
      .eq("owner_id", caller.userId)
      .in("status", ["queued", "leased"]);
  }
  if (command === "resume") {
    await db
      .from("agent_runs")
      .update({ status: "queued" })
      .eq("id", runId)
      .eq("owner_id", caller.userId);
    await releaseReadyTasks(db, caller.userId, runId);
  }
  if (command === "cancel") {
    await db
      .from("agent_runs")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("owner_id", caller.userId);
    await db
      .from("agent_run_tasks")
      .update({ status: "cancelled", lease_owner: null, lease_expires_at: null })
      .eq("run_id", runId)
      .eq("owner_id", caller.userId)
      .not("status", "in", "(completed,cancelled)");
  }
  if (command === "retry") {
    await db
      .from("agent_run_tasks")
      .update({
        status: "queued",
        available_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("run_id", runId)
      .eq("owner_id", caller.userId)
      .eq("status", "failed");
    await db
      .from("agent_runs")
      .update({ status: "queued" })
      .eq("id", runId)
      .eq("owner_id", caller.userId);
  }
  if (command === "approve" || command === "deny") {
    if (!taskId) throw new Error("task_id_required");
    const status = command === "approve" ? "completed" : "cancelled";
    const { data: task } = await db
      .from("agent_run_tasks")
      .update({
        status,
        progress: command === "approve" ? 100 : 90,
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId)
      .eq("run_id", runId)
      .eq("owner_id", caller.userId)
      .eq("status", "approval_needed")
      .select("id")
      .maybeSingle();
    if (!task) throw new Error("approval_not_pending");
    if (command === "deny")
      await db
        .from("agent_runs")
        .update({ status: "paused" })
        .eq("id", runId)
        .eq("owner_id", caller.userId);
    else {
      await db
        .from("agent_runs")
        .update({ status: "running" })
        .eq("id", runId)
        .eq("owner_id", caller.userId);
      await releaseReadyTasks(db, caller.userId, runId);
      const { count } = await db
        .from("agent_run_tasks")
        .select("id", { count: "exact", head: true })
        .eq("run_id", runId)
        .eq("owner_id", caller.userId)
        .not("status", "in", "(completed,cancelled)");
      if ((count ?? 0) === 0)
        await db
          .from("agent_runs")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", runId)
          .eq("owner_id", caller.userId);
    }
  }
  await db.from("agent_run_events").insert({
    run_id: runId,
    owner_id: caller.userId,
    kind: "log",
    safe_payload: { command, source: "user" },
  } as never);
  return { accepted: true, command };
}

async function releaseReadyTasks(db: UntypedClient, ownerId: string, runId: string) {
  const { data } = await db
    .from("agent_run_tasks")
    .select("id,client_key,dependencies,status")
    .eq("run_id", runId)
    .eq("owner_id", ownerId);
  const tasks = (data ?? []) as unknown as {
    id: string;
    client_key: string;
    dependencies: string[];
    status: string;
  }[];
  const done = new Set(
    tasks.filter((item) => item.status === "completed").map((item) => item.client_key),
  );
  for (const item of tasks)
    if (
      ["waiting", "blocked"].includes(item.status) &&
      item.dependencies.every((key) => done.has(key))
    )
      await db
        .from("agent_run_tasks")
        .update({ status: "queued", available_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("owner_id", ownerId);
}
