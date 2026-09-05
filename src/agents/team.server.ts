import type { AuthedCaller } from "@/lib/api-auth.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import type { AgentTaskInput } from "./team";

// Tables in the Apollo migration are intentionally ahead of generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedClient = any;
const raw = (caller: AuthedCaller) => caller.supabaseAdmin as unknown as UntypedClient;
const rawUser = (caller: AuthedCaller) => caller.supabaseUser as unknown as UntypedClient;
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
  // The user-scoped client supplies auth.uid() to the SECURITY DEFINER RPC.
  // Task closure, run transition, and the audit event commit in one transaction.
  const { data, error } = await rawUser(caller).rpc("control_disabled_agent_team_run", {
    p_run_id: runId,
    p_command: command,
    p_task_id: taskId ?? null,
  });
  if (error) {
    const publicErrors = new Set([
      "agent_run_not_found",
      "task_id_required",
      "approval_not_pending",
      "invalid_agent_state_transition",
      "agent_run_state_changed",
    ]);
    const message = typeof error.message === "string" ? error.message : "";
    throw new Error(publicErrors.has(message) ? message : "agent_control_unavailable");
  }
  if (!data) throw new Error("agent_control_unavailable");
  return data;
}
