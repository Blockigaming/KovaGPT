import type { AuthedCaller } from "@/lib/api-auth.server";
import { createClient } from "@supabase/supabase-js";
import type { BrowserAction, BrowserPolicy } from "./policy";
import { validateBrowserAction } from "./policy";

export type AgentEntitlement = "plus" | "pro" | "business" | "enterprise";
type RunAgentDefinition = {
  id: string;
  version: number;
  project_id: string | null;
  allowed_tools: string[];
  archived_at: string | null;
};
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
  const { data } = await caller.supabaseAdmin
    .from("subscriptions")
    .select("price_id, status, current_period_end")
    .eq("user_id", caller.userId)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(10);
  const active = (data ?? []).find(
    (row) => !row.current_period_end || new Date(row.current_period_end).getTime() > Date.now(),
  );
  const price = active?.price_id?.toLowerCase() ?? "";
  if (price.includes("enterprise")) return "enterprise";
  if (price.includes("business")) return "business";
  if (price.includes("pro")) return "pro";
  if (price.includes("plus")) return "plus";
  return null;
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
    priorRunId?: string;
    retryCount?: number;
  },
) {
  const db = caller.supabaseAdmin as unknown as ReturnType<typeof createClient>;
  const entitlement = await getAgentEntitlement(caller);
  if (!entitlement) throw new Error("agent_plan_required");
  const limits = AGENT_LIMITS[entitlement];
  let definition: RunAgentDefinition | null = null;
  if (input.agentDefinitionId) {
    const { data } = await db
      .from("agent_definitions")
      .select("id,version,project_id,allowed_tools,archived_at")
      .eq("id", input.agentDefinitionId)
      .eq("owner_id", caller.userId)
      .maybeSingle();
    definition = data as unknown as RunAgentDefinition | null;
    if (!definition) throw new Error("agent_definition_not_found");
    if (input.expectedDefinitionVersion !== definition.version)
      throw new Error("agent_definition_version_conflict");
    if (definition.archived_at) throw new Error("archived_agent_cannot_run");
    if (definition.project_id && definition.project_id !== (input.projectId ?? null))
      throw new Error("agent_project_mismatch");
    if (input.actions.length && !definition.allowed_tools.includes("web"))
      throw new Error("agent_tool_not_allowed");
  }
  const { count } = await db
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", caller.userId)
    .in("status", [
      "queued",
      "leased",
      "planning",
      "running",
      "approval_needed",
      "paused",
      "retry_wait",
    ]);
  if ((count ?? 0) >= limits.concurrency) throw new Error("agent_concurrency_limit");
  if (!input.objective.trim() || input.objective.length > 4000)
    throw new Error("invalid_objective");
  if (!input.idempotencyKey || input.idempotencyKey.length > 120)
    throw new Error("invalid_idempotency_key");
  if (input.actions.length > limits.maxActions) throw new Error("agent_action_limit");
  const policy: BrowserPolicy = {
    allowedDomains: input.allowedDomains.map((v) => v.toLowerCase()),
    blockedDomains: ["localhost", "127.0.0.1", "0.0.0.0"],
    maxActions: limits.maxActions,
    maxRuntimeMs: limits.maxRuntimeMs,
    allowDownloads: true,
    allowUploads: false,
  };
  for (const action of input.actions) {
    const verdict = validateBrowserAction(action, policy);
    if (!verdict.allowed) throw new Error(verdict.reason);
  }
  const { data, error } = await db
    .from("agent_runs")
    .upsert(
      {
        owner_id: caller.userId,
        project_id: input.projectId ?? null,
        agent_definition_id: definition?.id ?? null,
        agent_definition_version: definition?.version ?? null,
        entitlement,
        idempotency_key: input.idempotencyKey,
        objective: input.objective.trim(),
        plan: input.actions,
        policy,
        status: "queued",
        prior_run_id: input.priorRunId ?? null,
        retry_count: input.retryCount ?? 0,
      } as never,
      { onConflict: "owner_id,idempotency_key", ignoreDuplicates: true },
    )
    .select("id, status, entitlement, agent_definition_id, agent_definition_version, created_at")
    .maybeSingle();
  if (error) throw new Error("agent_run_create_failed");
  const created = data as unknown as {
    id: string;
    status: string;
    entitlement: AgentEntitlement;
    created_at: string;
  } | null;
  if (created)
    await db.from("agent_run_events").insert({
      run_id: created.id,
      owner_id: caller.userId,
      kind: "plan",
      safe_payload: {
        actionCount: input.actions.length,
        allowedDomains: policy.allowedDomains,
        agentDefinitionId: definition?.id ?? null,
        agentDefinitionVersion: definition?.version ?? null,
      },
    } as never);
  return created;
}

export async function controlAgentRun(
  caller: AuthedCaller,
  runId: string,
  command: "pause" | "resume" | "cancel" | "delete" | "deny" | "retry",
  approvalId?: string,
  retryKey?: string,
) {
  const db = caller.supabaseAdmin as unknown as ReturnType<typeof createClient>;
  const { data: run } = await db
    .from("agent_runs")
    .select(
      "id,status,objective,project_id,agent_definition_id,agent_definition_version,plan,policy,retry_count",
    )
    .eq("id", runId)
    .eq("owner_id", caller.userId)
    .maybeSingle();
  if (!run) throw new Error("agent_run_not_found");
  const safeRun = run as unknown as {
    id: string;
    status: string;
    objective: string;
    project_id: string | null;
    agent_definition_id: string | null;
    agent_definition_version: number | null;
    plan: BrowserAction[];
    policy: { allowedDomains?: string[] };
    retry_count: number;
  };
  if (command === "delete") {
    if (!["completed", "failed", "cancelled"].includes(safeRun.status))
      throw new Error("active_run_cannot_be_deleted");
    await db.from("agent_runs").delete().eq("id", runId).eq("owner_id", caller.userId);
    return { deleted: true };
  }
  if (command === "deny") {
    if (!approvalId) throw new Error("approval_id_required");
    await db
      .from("integration_action_approvals")
      .update({ status: "denied", decided_at: new Date().toISOString() } as never)
      .eq("id", approvalId)
      .eq("owner_id", caller.userId)
      .eq("status", "pending");
  }
  if (command === "retry") {
    if (!["completed", "failed", "cancelled"].includes(safeRun.status))
      throw new Error("agent_run_not_retryable");
    if (!retryKey || retryKey.length > 80) throw new Error("retry_key_required");
    return createAgentRun(caller, {
      objective: safeRun.objective,
      projectId: safeRun.project_id ?? undefined,
      idempotencyKey: `retry:${runId}:${retryKey}`,
      actions: Array.isArray(safeRun.plan) ? safeRun.plan : [],
      allowedDomains: safeRun.policy?.allowedDomains ?? [],
      agentDefinitionId: safeRun.agent_definition_id ?? undefined,
      expectedDefinitionVersion: safeRun.agent_definition_version ?? undefined,
      priorRunId: runId,
      retryCount: (safeRun.retry_count ?? 0) + 1,
    });
  }
  if (command === "cancel" && safeRun.status === "cancelled") return { status: "cancelled" };
  if (
    command === "cancel" &&
    ![
      "queued",
      "leased",
      "planning",
      "running",
      "approval_needed",
      "paused",
      "retry_wait",
    ].includes(safeRun.status)
  )
    throw new Error("agent_run_not_cancellable");
  if (command === "pause" && !["queued", "leased", "planning", "running"].includes(safeRun.status))
    throw new Error("agent_run_not_pausable");
  if (command === "resume" && !["paused", "retry_wait"].includes(safeRun.status))
    throw new Error("agent_run_not_resumable");
  const status = command === "pause" ? "paused" : command === "resume" ? "queued" : "cancelled";
  const { data: transitioned, error: transitionError } = await db
    .from("agent_runs")
    .update({
      status,
      available_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      cancelled_at: command === "cancel" || command === "deny" ? new Date().toISOString() : null,
      cancellation_category:
        command === "deny" ? "approval_denied" : command === "cancel" ? "user_requested" : null,
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
  if (eventError) throw new Error("agent_run_event_failed");
  return { status };
}
