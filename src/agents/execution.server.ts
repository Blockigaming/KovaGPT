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
  // The caller-scoped RPC locks the run and commits approval decisions,
  // terminal child cleanup, and evidence atomically. Unbound legacy approvals
  // cannot be associated using caller-supplied metadata.
  const { data, error } = await caller.supabaseUser.rpc("control_disabled_browser_run", {
    p_run_id: runId,
    p_command: command,
    p_approval_id: approvalId ?? null,
  });
  if (error) {
    const safeErrors = new Set([
      "agent_run_not_found",
      "agent_run_not_cancellable",
      "approval_id_required",
      "approval_not_pending",
      "browser_agent_unavailable",
    ]);
    throw new Error(safeErrors.has(error.message) ? error.message : "agent_control_unavailable");
  }
  if (!data) throw new Error("agent_control_unavailable");
  return data;
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
