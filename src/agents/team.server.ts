import type { AuthedCaller } from "@/lib/api-auth.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import type { AgentTaskInput } from "./team";

// Tables in the Apollo migration are intentionally ahead of generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedClient = any;
const raw = (caller: AuthedCaller) => caller.supabaseAdmin as unknown as UntypedClient;
/**
 * The legacy agent-team queue has no compatible deployed worker. Keep this
 * internal boundary fail-closed even if a future route accidentally calls it.
 */
export async function createAgentTeamRun(
  caller: AuthedCaller,
  input: {
    objective: string;
    projectId?: string;
    idempotencyKey: string;
    tasks: AgentTaskInput[];
    context: string[];
  },
): Promise<never> {
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
  void input;
  throw new Error("agent_team_execution_unavailable");
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
  // With no compatible worker, only fail-safe termination remains legal.
  if (command !== "cancel" && command !== "deny") {
    throw new Error("agent_team_execution_unavailable");
  }
  const db = raw(caller);
  const { data: run, error: runError } = await db
    .from("agent_runs")
    .select("id,status")
    .eq("id", runId)
    .eq("owner_id", caller.userId)
    .maybeSingle();
  if (runError) throw new Error("agent_control_unavailable");
  if (!run) throw new Error("agent_run_not_found");
  const safeRun = run as unknown as { status: string };
  if (command === "cancel" && safeRun.status === "cancelled") {
    return { accepted: true, command, status: "cancelled" };
  }
  if (["completed", "failed", "cancelled"].includes(safeRun.status)) {
    throw new Error("invalid_agent_state_transition");
  }

  if (command === "deny") {
    if (!taskId) throw new Error("task_id_required");
    const { data: task, error: taskError } = await db
      .from("agent_run_tasks")
      .update({
        status: "cancelled",
        progress: 90,
        completed_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", taskId)
      .eq("run_id", runId)
      .eq("owner_id", caller.userId)
      .eq("status", "approval_needed")
      .select("id")
      .maybeSingle();
    if (taskError || !task) throw new Error("approval_not_pending");
  }

  const { error: taskCancelError } = await db
    .from("agent_run_tasks")
    .update({ status: "cancelled", lease_owner: null, lease_expires_at: null })
    .eq("run_id", runId)
    .eq("owner_id", caller.userId)
    .not("status", "in", "(completed,cancelled)");
  if (taskCancelError) throw new Error("agent_control_unavailable");

  const now = new Date().toISOString();
  const { data: transitioned, error: transitionError } = await db
    .from("agent_runs")
    .update({ status: "cancelled", cancelled_at: now, updated_at: now })
    .eq("id", runId)
    .eq("owner_id", caller.userId)
    .eq("status", safeRun.status)
    .select("id")
    .maybeSingle();
  if (transitionError || !transitioned) throw new Error("agent_run_state_changed");

  const { error: eventError } = await db.from("agent_run_events").insert({
    run_id: runId,
    owner_id: caller.userId,
    kind: command === "deny" ? "approval" : "log",
    safe_payload: { command, result: "cancelled", execution_enabled: false },
  } as never);
  if (eventError) throw new Error("agent_event_write_failed");
  return { accepted: true, command, status: "cancelled" };
}
