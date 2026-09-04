import type { AuthedCaller } from "@/lib/api-auth.server";
import { resolveEffectiveBillingTier } from "@/lib/billing-entitlement.server";
import { createClient } from "@supabase/supabase-js";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";

import { resolveAgentEntitlement } from "./entitlement-policy.mjs";
import type { BrowserAction } from "./policy";

export type AgentEntitlement = "plus" | "pro" | "business" | "enterprise";
export const AGENT_LIMITS: Record<
  AgentEntitlement,
  { concurrency: number; maxRuntimeMs: number; maxActions: number }
> = {
  plus: { concurrency: 1, maxRuntimeMs: 15 * 60_000, maxActions: 50 },
  pro: { concurrency: 3, maxRuntimeMs: 60 * 60_000, maxActions: 200 },
  business: { concurrency: 5, maxRuntimeMs: 90 * 60_000, maxActions: 300 },
  enterprise: { concurrency: 10, maxRuntimeMs: 2 * 60 * 60_000, maxActions: 500 },
};

export async function getAgentEntitlement(caller: AuthedCaller): Promise<AgentEntitlement | null> {
  const tier = await resolveEffectiveBillingTier(caller.supabaseAdmin, caller.userId);
  return resolveAgentEntitlement(tier);
}

/** Browser automation remains intentionally unavailable until the isolated worker is deployed. */
export async function executeBrowserAgent(): Promise<never> {
  throw new Error("browser_agent_unavailable");
}

export async function createAgentRun(
  caller: AuthedCaller,
  input: {
    objective: string;
    projectId?: string;
    idempotencyKey: string;
    actions: BrowserAction[];
    allowedDomains: string[];
    agentDefinitionId?: string;
    expectedDefinitionVersion?: number;
    retryKey?: string;
    priorRunId?: string;
  },
) {
  await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
  const db = caller.supabaseAdmin as unknown as ReturnType<typeof createClient>;
  const entitlement = await getAgentEntitlement(caller);
  if (!entitlement) throw new Error("agent_entitlement_required");
  let definition:
    | { id: string; version: number; archived_at: string | null; allowed_tools: string[] | null }
    | undefined;
  if (input.agentDefinitionId) {
    const result = await db
      .from("agent_definitions")
      .select("id,version,archived_at,allowed_tools")
      .eq("id", input.agentDefinitionId)
      .eq("owner_id", caller.userId)
      .maybeSingle();
    if (result.error || !result.data) throw new Error("agent_definition_not_found");
    definition = result.data as NonNullable<typeof definition>;
    if (definition?.archived_at) throw new Error("archived_agent_cannot_run");
    if (
      input.expectedDefinitionVersion !== undefined &&
      input.expectedDefinitionVersion !== definition.version
    )
      throw new Error("agent_definition_version_conflict");
    const allowed = new Set(definition?.allowed_tools ?? []);
    if (input.actions.some((action) => !allowed.has(action.type)))
      throw new Error("agent_tool_not_allowed");
  }
  const idempotencyKey = input.retryKey
    ? `retry:${input.priorRunId}:${input.retryKey}`
    : input.idempotencyKey;
  const insertPayload = {
    owner_id: caller.userId,
    project_id: input.projectId ?? null,
    entitlement,
    objective: input.objective,
    status: "queued",
    idempotency_key: idempotencyKey,
    agent_definition_id: definition?.id ?? null,
    agent_definition_version: definition?.version ?? null,
    tool_ids: definition?.allowed_tools ?? [],
    safe_payload: { allowedDomains: input.allowedDomains, actionCount: input.actions.length },
  };
  const result = await db
    .from("agent_runs")
    .insert(insertPayload as never)
    .select("id,status,agent_definition_id,agent_definition_version")
    .maybeSingle();
  if (result.error || !result.data) throw new Error("agent_run_create_failed");
  return result.data;
}

export async function controlAgentRun(
  caller: AuthedCaller,
  runId: string,
  command: "pause" | "resume" | "cancel" | "delete" | "deny",
  approvalId?: string,
) {
  if (command === "resume") {
    await assertLockdownAllows(caller.supabaseAdmin, caller.userId, "agent");
  }
  const db = caller.supabaseAdmin as unknown as ReturnType<typeof createClient>;
  const { data: run, error: runError } = await db
    .from("agent_runs")
    .select("id,status")
    .eq("id", runId)
    .eq("owner_id", caller.userId)
    .maybeSingle();
  if (runError) throw new Error("agent_control_unavailable");
  if (!run) throw new Error("agent_run_not_found");
  const safeRun = run as unknown as { status: string };
  if (command === "resume") throw new Error("browser_agent_unavailable");
  if (command === "cancel" && safeRun.status === "cancelled") return { status: "cancelled" };
  if (command === "delete") {
    if (!["completed", "failed", "cancelled"].includes(safeRun.status))
      throw new Error("active_run_cannot_be_deleted");
    const { error } = await db
      .from("agent_runs")
      .delete()
      .eq("id", runId)
      .eq("owner_id", caller.userId);
    if (error) throw new Error("agent_run_delete_failed");
    return { deleted: true };
  }
  const allowedStatuses =
    command === "pause"
      ? ["queued", "leased", "planning", "running", "retry_wait"]
      : command === "deny"
        ? ["approval_needed"]
        : ["queued", "leased", "planning", "running", "approval_needed", "paused", "retry_wait"];
  if (!allowedStatuses.includes(safeRun.status)) throw new Error("agent_run_not_cancellable");
  if (command === "deny") {
    if (!approvalId) throw new Error("approval_id_required");
    const { data: approval, error } = await db
      .from("integration_action_approvals")
      .update({
        status: "denied",
        decided_at: new Date().toISOString(),
      } as never)
      .eq("id", approvalId)
      .eq("owner_id", caller.userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error || !approval) throw new Error("approval_not_pending");
  }
  const status = command === "pause" ? "paused" : "cancelled";
  const { data: transitioned, error: transitionError } = await db
    .from("agent_runs")
    .update({
      status,
      available_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      cancelled_at: command === "cancel" || command === "deny" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    } as never)
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
    safe_payload: { command, result: "accepted" },
  } as never);
  if (eventError) throw new Error("agent_event_write_failed");
  return { status, auditRecorded: true };
}

export async function retryAgentRun(
  caller: AuthedCaller,
  runId: string,
  retryKey: string,
  input: Omit<Parameters<typeof createAgentRun>[1], "idempotencyKey" | "priorRunId">,
) {
  return createAgentRun(caller, {
    ...input,
    idempotencyKey: `retry:${runId}:${retryKey}`,
    priorRunId: runId,
  });
}
